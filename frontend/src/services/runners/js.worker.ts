import type { RunnerEvent, RunnerCommand, StartRunPayload } from "./bridge";
import { createWarehouse } from "@/lib/warehouse/warehouse";
import type { PackagePublic } from "@/lib/warehouse/types";

// This file is compiled as an isolated Web Worker by Vite.

const postEvent = (event: RunnerEvent) => {
    self.postMessage(event);
};

// Intercept console logs so we can pipe them to the UI
const setupConsoleProxy = () => {
    const originalLog = console.log;
    const originalError = console.error;

    console.log = (...args) => {
        postEvent({
            type: "STDOUT",
            payload: args
                .map((a) =>
                    typeof a === "object" ? JSON.stringify(a) : String(a),
                )
                .join(" "),
        });
        originalLog(...args);
    };

    console.error = (...args) => {
        postEvent({
            type: "STDERR",
            payload: args
                .map((a) =>
                    typeof a === "object" ? JSON.stringify(a) : String(a),
                )
                .join(" "),
        });
        originalError(...args);
    };
};

const executeCode = async (code: string, deck?: PackagePublic[]) => {
    try {
        // Internal metric state, completely hidden from the student.
        let throughput = 0;
        let activeTasks = 0;
        let peakConcurrency = 0;

        // The realistic API we expose to the student.
        // They just "do work", and we measure how efficiently they do it.
        const API = {
            // Simulates an async I/O operation like a database write or HTTP request
            processTask: async () => {
                activeTasks++;
                if (activeTasks > peakConcurrency) {
                    peakConcurrency = activeTasks;
                }

                // Simulate typical network/IO latency (e.g., 50ms)
                await new Promise((resolve) => setTimeout(resolve, 50));

                throughput++;
                activeTasks--;

                // Update the UI automatically under the hood
                postEvent({
                    type: "METRIC_UPDATE",
                    // We can re-introduce collisions later when we build the full challenge
                    payload: { throughput, collisions: 0 },
                });

                return true;
            },
        };

        const runDeck = deck;

        // Create the warehouse runtime and forward its events to the main thread
        const warehouse = createWarehouse(runDeck);
        warehouse.onEvent((ev) => {
            // Always forward raw event for visualization and metrics
            postEvent({
                type: "WAREHOUSE_EVENT",
                payload: ev,
            });

            // Also emit a human-readable STDOUT entry for non-heartbeat events so
            // the console output shows a succinct timeline of what's happening.
            // Skip heartbeat events because they are very frequent and noisy.
            try {
                if (ev && ev.type !== "HEARTBEAT") {
                    const pid =
                        ev.packageId !== undefined ? String(ev.packageId) : "-";
                    const meta = ev.metadata
                        ? ` ${JSON.stringify(ev.metadata)}`
                        : "";
                    const msg = `[Warehouse] ${ev.type} pkg=${pid} ${meta}`;
                    if (ev.type === "ERROR") {
                        postEvent({ type: "STDERR", payload: msg });
                    } else {
                        postEvent({ type: "STDOUT", payload: msg });
                    }
                }
            } catch {
                // Ignore formatting problems and avoid crashing the worker
            }
        });

        // Create an AsyncFunction so students can use top-level await.
        // We provide both the legacy API object and the `warehouse` runtime as arguments.
        const AsyncFunction = Object.getPrototypeOf(
            async function () {},
        ).constructor;

        // The student's code is injected here. We give them access to the `API` object and `warehouse`.
        const runner = new AsyncFunction("API", "warehouse", code);

        // Run student code with both arguments
        await runner(API, warehouse);

        postEvent({
            type: "STDOUT",
            payload: `\n[System] Run finished. Peak concurrent tasks: ${peakConcurrency}`,
        });

        // Give warehouse a moment to flush any final events (optional small delay)
        await new Promise((r) => setTimeout(r, 10));

        postEvent({ type: "RUN_COMPLETE" });

        // Best-effort cleanup if available
        try {
            warehouse.dispose?.();
        } catch {
            // swallow
        }
    } catch (error) {
        postEvent({
            type: "RUN_ERROR",
            payload: error instanceof Error ? error.message : String(error),
        });
    }
};

// Main message listener from the React thread
self.onmessage = async (e: MessageEvent<RunnerCommand>) => {
    const { type, payload } = e.data;

    switch (type) {
        case "START_RUN": {
            const { code, deck } = payload as StartRunPayload;
            setupConsoleProxy();
            await executeCode(code, deck as PackagePublic[] | undefined);
            break;
        }
        case "STOP_RUN":
            // The main thread terminates the worker directly, but we keep this case for completeness.
            break;
        default:
            console.warn("Unknown command sent to JS worker:", type);
    }
};

// Signal to the main thread that the worker script has parsed and is ready
postEvent({ type: "RUNNER_READY" });
