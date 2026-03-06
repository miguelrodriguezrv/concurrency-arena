import { useState, useRef, useCallback } from "react";
import type {
    RunnerCommand,
    RunnerEvent,
    MetricUpdatePayload,
} from "@/lib/runners/bridge";
// Notice the `?worker` suffix. This tells Vite to bundle this file as a Web Worker
import JSWorker from "@/lib/runners/js.worker.ts?worker";

export type SupportedLanguage = "javascript" | "go" | "python";

export interface RunnerState {
    status: "idle" | "booting" | "running" | "error" | "complete";
    output: string[];
    error: string | null;
    metrics: MetricUpdatePayload;
    // Forwarded warehouse lifecycle events emitted by the Warehouse runtime
    warehouseEvents: unknown[];
}

export const useCodeRunner = () => {
    const [state, setState] = useState<RunnerState>({
        status: "idle",
        output: [],
        error: null,
        metrics: { throughput: 0, collisions: 0, correctness: 0 },
        warehouseEvents: [],
    });

    const workerRef = useRef<Worker | null>(null);

    const stopRun = useCallback(() => {
        if (workerRef.current) {
            // Hard terminate the worker to kill any infinite loops or long-running processes
            workerRef.current.terminate();
            workerRef.current = null;
            setState((s) => ({
                ...s,
                status: "idle",
                warehouseEvents: [
                    ...s.warehouseEvents,
                    {
                        type: "STOP_RUN",
                        timestamp:
                            typeof performance !== "undefined"
                                ? performance.now()
                                : Date.now(),
                    },
                ],
            }));
        }
    }, []);

    const executeCode = useCallback(
        (code: string, language: SupportedLanguage) => {
            // Clean up any existing run
            stopRun();

            setState({
                status: "booting",
                output: [],
                error: null,
                metrics: { throughput: 0, collisions: 0, correctness: 0 },
                warehouseEvents: [
                    { type: "RESET_WAREHOUSE" },
                    {
                        type: "START_RUN",
                        timestamp:
                            typeof performance !== "undefined"
                                ? performance.now()
                                : Date.now(),
                    },
                ],
            });

            let worker: Worker;

            switch (language) {
                case "javascript":
                    worker = new JSWorker();
                    break;
                case "go":
                    // Go WASM (Yaegi) bridge.
                    // Uses 'module' type to allow modern TS worker features.
                    worker = new Worker(
                        new URL("../lib/runners/go.worker.ts", import.meta.url),
                        { type: "module" },
                    );
                    break;
                case "python":
                    // Python (Pyodide) bridge.
                    // Uses 'module' type for Vite compatibility.
                    worker = new Worker(
                        new URL(
                            "../lib/runners/python.worker.ts",
                            import.meta.url,
                        ),
                        { type: "module" },
                    );
                    break;
                default:
                    return;
            }

            workerRef.current = worker;

            worker.onmessage = (e: MessageEvent<RunnerEvent>) => {
                const event = e.data;

                switch (event.type) {
                    case "RUNNER_READY": {
                        setState((s) => ({ ...s, status: "running" }));
                        const startCmd: RunnerCommand = {
                            type: "START_RUN",
                            payload: { code },
                        };
                        worker.postMessage(startCmd);
                        break;
                    }
                    case "STDOUT":
                        setState((s) => ({
                            ...s,
                            output: [...s.output, event.payload as string],
                        }));
                        break;
                    case "STDERR":
                        setState((s) => ({
                            ...s,
                            output: [...s.output, `ERROR: ${event.payload}`],
                        }));
                        break;
                    case "METRIC_UPDATE":
                        setState((s) => ({
                            ...s,
                            metrics: {
                                ...s.metrics,
                                ...(event.payload as MetricUpdatePayload),
                            },
                        }));
                        break;
                    case "WAREHOUSE_EVENT":
                        // Append the forwarded WarehouseEvent payload for the visualizer to consume.
                        setState((s) => ({
                            ...s,
                            warehouseEvents: [
                                ...s.warehouseEvents,
                                event.payload,
                            ],
                        }));
                        break;
                    case "RUN_COMPLETE":
                        setState((s) => ({ ...s, status: "complete" }));
                        // Clean up successfully completed worker
                        worker.terminate();
                        workerRef.current = null;
                        break;
                    case "RUN_ERROR":
                        setState((s) => ({
                            ...s,
                            status: "error",
                            error: event.payload as string,
                        }));
                        worker.terminate();
                        workerRef.current = null;
                        break;
                }
            };

            worker.onerror = (err) => {
                setState((s) => ({
                    ...s,
                    status: "error",
                    error: `Worker crashed: ${err.message}`,
                }));
                worker.terminate();
                workerRef.current = null;
            };
        },
        [stopRun],
    );

    return {
        runnerState: state,
        executeCode,
        stopRun,
    };
};
