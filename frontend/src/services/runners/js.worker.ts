import type { RunnerEvent, RunnerCommand, StartRunPayload } from "./bridge";
import { createWarehouse } from "@/lib/warehouse/warehouse";
import type { PackagePublic } from "@/lib/warehouse/types";
import { forwardWarehouseEvents, settleWarehouse } from "./warehouseBridge";

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

const executeCode = async (code: string, deck?: PackagePublic[], speed = 1) => {
    try {
        // Legacy API object kept for backwards compatibility with old snippets.
        const API = {
            processTask: async () => {
                await new Promise((resolve) => setTimeout(resolve, 50));
                return true;
            },
        };

        // Create the warehouse runtime and forward its events to the main thread
        const warehouse = createWarehouse(deck, { speed });
        forwardWarehouseEvents(warehouse, postEvent);

        // Create an AsyncFunction so students can use top-level await.
        const AsyncFunction = Object.getPrototypeOf(
            async function () {},
        ).constructor;

        // The student's code is injected here. We give them access to the `API` object and `warehouse`.
        const runner = new AsyncFunction("API", "warehouse", code);

        // Run student code with both arguments
        try {
            await runner(API, warehouse);
        } catch (error) {
            postEvent({
                type: "RUN_ERROR",
                payload: error instanceof Error ? error.message : String(error),
            });
            warehouse.dispose?.();
            return;
        }

        // Student code returned: let in-flight work (shipping lanes) finish.
        await settleWarehouse(warehouse, postEvent);

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
            const { code, deck, speed } = payload as StartRunPayload;
            setupConsoleProxy();
            await executeCode(code, deck as PackagePublic[] | undefined, speed);
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
