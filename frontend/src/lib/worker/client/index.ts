/**
 * concurrency-arena/frontend/src/lib/worker/client/index.ts
 *
 * Worker client helper to spawn runner workers and monitor heartbeats/watchdog.
 *
 * Responsibilities:
 *  - Spawn one of the runner workers (js/go/python).
 *  - Start and stop runs by sending START_RUN / STOP_RUN messages.
 *  - Forward runner events to local listeners.
 *  - Monitor heartbeats emitted by the Warehouse (WAREHOUSE_EVENT with type 'HEARTBEAT')
 *    and terminate the worker if heartbeats stop (deadlock/hang protection).
 *  - Enforce a configurable max wall-clock duration for runs.
 *
 * Usage:
 *   const client = new RunnerClient();
 *   client.on('warehouse_event', ev => console.log(ev));
 *   await client.startRun('js', codeString, deck);
 *   // client.stopRun() to request graceful stop, or client.terminate() to force kill.
 */

import type {
    RunnerEvent as _RunnerEvent,
    StartRunPayload,
} from "../../runners/bridge";

type RunnerType = "js" | "go" | "python";

type Listener = (payload?: any) => void;

interface ClientOptions {
    heartbeatTimeoutMs?: number; // if no heartbeat within this ms -> terminate
    maxRuntimeMs?: number; // max wall-clock run duration
    runnerType?: RunnerType; // default runner to spawn
}

/**
 * Small typed wrapper for the runner event shape from the worker.
 * We avoid importing concrete runtime event shapes here beyond the bridge.
 */
type RunnerEvent = _RunnerEvent;

/**
 * Public events emitted by RunnerClient
 * - ready: worker signaled RUNNER_READY
 * - stdout, stderr: worker console output
 * - metric: METRIC_UPDATE
 * - run_complete, run_error: run lifecycle
 * - warehouse_event: forwarded WarehouseEvent payload
 * - dead: worker terminated due to heartbeat timeout or maxRuntime
 * - terminated: worker was terminated (manual or forced)
 */
type PublicEvent =
    | "ready"
    | "stdout"
    | "stderr"
    | "metric"
    | "run_complete"
    | "run_error"
    | "warehouse_event"
    | "dead"
    | "terminated"
    | "log";

/**
 * RunnerClient: manage worker lifecycle, run orchestration, heartbeat/watchdog.
 */
export class RunnerClient {
    private worker: Worker | null = null;
    private listeners: Map<PublicEvent, Set<Listener>> = new Map();
    private heartbeatTimer: number | null = null;
    private maxRuntimeTimer: number | null = null;
    private options: Required<ClientOptions>;
    private lastHeartbeatTs: number | null = null;
    private isRunning = false;

    // Map runner type -> worker script URL (module). This uses import.meta.url so bundlers (Vite) can resolve.
    private static RUNNER_SCRIPTS: Record<
        RunnerType,
        { url: URL; type: "module" | "classic" }
    > = {
        js: { url: new URL("../../runners/js.worker.ts", import.meta.url), type: "module" },
        go: { url: new URL("../../runners/go.worker.ts", import.meta.url), type: "module" },
        python: { url: new URL("../../runners/python.worker.ts", import.meta.url), type: "module" },
    };

    constructor(opts?: ClientOptions) {
        this.options = {
            heartbeatTimeoutMs: opts?.heartbeatTimeoutMs ?? 1500,
            maxRuntimeMs: opts?.maxRuntimeMs ?? 60_000,
            runnerType: opts?.runnerType ?? "js",
        };

        // initialize listener sets
        [
            "ready",
            "stdout",
            "stderr",
            "metric",
            "run_complete",
            "run_error",
            "warehouse_event",
            "dead",
            "terminated",
            "log",
        ].forEach((e) => this.listeners.set(e as PublicEvent, new Set()));
    }

    /**
     * Add an event listener for public events.
     */
    on(event: PublicEvent, cb: Listener) {
        this.listeners.get(event)!.add(cb);
        return () => this.off(event, cb);
    }

    off(event: PublicEvent, cb: Listener) {
        this.listeners.get(event)!.delete(cb);
    }

    private emit(event: PublicEvent, payload?: any) {
        const set = this.listeners.get(event);
        if (!set) return;
        for (const cb of Array.from(set)) {
            try {
                cb(payload);
            } catch (err) {
                // swallow listener errors
                // eslint-disable-next-line no-console
                console.error("RunnerClient listener error", err);
            }
        }
    }

    /**
     * Spawn a worker for the given runnerType (or the default configured one).
     * If a worker is already present, it will be terminated first.
     */
    private spawnWorker(runnerType?: RunnerType) {
        this.terminate(); // ensure any existing worker is gone

        const type = runnerType ?? this.options.runnerType;
        const entry = RunnerClient.RUNNER_SCRIPTS[type];
        // Create a module worker so ESM imports work inside the worker file
        this.worker = new Worker(entry.url.toString(), { type: entry.type });

        this.worker.onmessage = (ev: MessageEvent<RunnerEvent>) => {
            this.handleWorkerMessage(ev.data);
        };
        this.worker.onerror = (err) => {
            this.emit("log", { level: "error", err });
        };
    }

    /**
     * Start a run with the provided code and optional deterministic deck payload.
     * Will spawn a worker (JS by default) if none exists.
     */
    async startRun(runnerType: RunnerType, code: string, deck?: unknown) {
        if (!this.worker) {
            this.spawnWorker(runnerType);
        }

        if (!this.worker) {
            throw new Error("Failed to spawn worker");
        }

        this.isRunning = true;
        this.lastHeartbeatTs = null;
        // start max runtime timer
        this.clearTimers();
        this.maxRuntimeTimer = window.setTimeout(() => {
            this.emit("log", { level: "warn", message: "Max runtime exceeded; terminating worker." });
            this.killWorker("max_runtime");
        }, this.options.maxRuntimeMs);

        // Send start command
        const payload: StartRunPayload & { deck?: unknown } = {
            code,
            deck,
        };
        this.worker.postMessage({ type: "START_RUN", payload });

        // guard: if no RUNNER_READY or any event in short time, we'll still rely on heartbeat watchdog to kill
        this.emit("log", { level: "info", message: "START_RUN sent" });
    }

    /**
     * Request the worker to stop the current run gracefully.
     * If the worker doesn't stop, caller should call terminate() to force kill.
     */
    stopRun() {
        if (!this.worker) return;
        try {
            this.worker.postMessage({ type: "STOP_RUN" });
            // Give it a short grace period then force kill
            window.setTimeout(() => {
                if (this.worker) {
                    this.emit("log", { level: "warn", message: "STOP_RUN grace elapsed; terminating worker." });
                    this.terminate();
                }
            }, 250);
        } catch (e) {
            this.emit("log", { level: "error", err: e });
            this.terminate();
        }
    }

    /**
     * Force-terminate the worker immediately. Emits 'terminated' event.
     */
    terminate() {
        if (!this.worker) return;
        try {
            this.worker.terminate();
        } catch (e) {
            // swallow
        } finally {
            this.worker = null;
            this.isRunning = false;
            this.clearTimers();
            this.emit("terminated", {});
        }
    }

    /**
     * Internal: handle a message posted by the worker.
     */
    private handleWorkerMessage(ev: RunnerEvent) {
        const { type, payload } = ev;
        switch (type) {
            case "RUNNER_READY":
                this.emit("ready", payload);
                break;
            case "STDOUT":
                this.emit("stdout", payload);
                break;
            case "STDERR":
                this.emit("stderr", payload);
                break;
            case "METRIC_UPDATE":
                this.emit("metric", payload);
                break;
            case "RUN_COMPLETE":
                this.isRunning = false;
                this.clearTimers();
                this.emit("run_complete", payload);
                break;
            case "RUN_ERROR":
                this.isRunning = false;
                this.clearTimers();
                this.emit("run_error", payload);
                break;
            case "WAREHOUSE_EVENT":
                this.handleWarehouseEvent(payload);
                break;
            default:
                // Unknown events are forwarded as logs
                this.emit("log", { level: "debug", type, payload });
                break;
        }
    }

    /**
     * Handle forwarded WarehouseEvent emitted by the Warehouse runtime inside the worker.
     * We look for HEARTBEAT lifecycle events and reset the heartbeat timer on them.
     */
    private handleWarehouseEvent(payload: any) {
        // Forward to listeners
        this.emit("warehouse_event", payload);

        // If payload looks like a heartbeat, touch watchdog
        try {
            if (payload && payload.type === "HEARTBEAT") {
                this.touchHeartbeat();
            }
        } catch (e) {
            // ignore parsing errors of payload
        }
    }

    private touchHeartbeat() {
        this.lastHeartbeatTs = Date.now();
        // Reset heartbeat timer: if we don't get a heartbeat within heartbeatTimeoutMs, kill
        if (this.heartbeatTimer) {
            window.clearTimeout(this.heartbeatTimer);
        }
        this.heartbeatTimer = window.setTimeout(() => {
            this.emit("log", { level: "error", message: "No heartbeat detected; terminating worker." });
            this.killWorker("heartbeat_timeout");
        }, this.options.heartbeatTimeoutMs);
    }

    private clearTimers() {
        if (this.heartbeatTimer) {
            window.clearTimeout(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        if (this.maxRuntimeTimer) {
            window.clearTimeout(this.maxRuntimeTimer);
            this.maxRuntimeTimer = null;
        }
    }

    /**
     * Kill the worker and emit a 'dead' event with a reason.
     */
    private killWorker(reason: string) {
        try {
            if (this.worker) {
                // best-effort graceful stop first
                try {
                    this.worker.postMessage({ type: "STOP_RUN" });
                } catch (e) {
                    // ignore
                }
                // then terminate
                this.worker.terminate();
                this.worker = null;
            }
        } finally {
            this.isRunning = false;
            this.clearTimers();
            this.emit("dead", { reason });
        }
    }

    /**
     * Dispose the client and ensure the worker is terminated.
     */
    dispose() {
        this.terminate();
        this.listeners.forEach((set) => set.clear());
    }
}

export default RunnerClient;
