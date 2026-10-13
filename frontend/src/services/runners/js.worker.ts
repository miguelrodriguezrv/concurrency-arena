import type { RunnerEvent, RunnerCommand, StartRunPayload } from "./bridge";
import { createWarehouse } from "@/lib/warehouse/warehouse";
import type { PackagePublic } from "@/lib/warehouse/types";
import { forwardWarehouseEvents, settleWarehouse } from "./warehouseBridge";
import { JS_LIBRARIES, JS_LIBRARY_GLOBALS, rewriteImports } from "./jsLibraries";

// Concurrency helpers (p-limit, async-mutex, p-queue) are also plain globals,
// so code without import lines works too. Globals (not function parameters)
// so an import of the same name can shadow them without a redeclaration error.
Object.assign(self, JS_LIBRARY_GLOBALS);

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
        // `import x from "p-limit"` etc. become `const x = __lib[...]`.
        let runnable: string;
        try {
            runnable = rewriteImports(code);
        } catch (err) {
            postEvent({
                type: "RUN_ERROR",
                payload: err instanceof Error ? err.message : String(err),
            });
            warehouse.dispose?.();
            return;
        }
        const runner = new AsyncFunction("API", "warehouse", "__lib", runnable);

        // Run student code with both arguments
        try {
            await runner(API, warehouse, JS_LIBRARIES);
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
