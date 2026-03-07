import type { RunnerEvent, RunnerCommand, StartRunPayload } from "./bridge";

/**
 * This Web Worker hosts the Go WASM runtime using Yaegi as an interpreter.
 * It loads the wasm_exec.js glue code and the compiled main.wasm engine.
 */

// Define global types for the Go WASM environment
interface GoInstance {
    importObject: WebAssembly.Imports;
    run(instance: WebAssembly.Instance): Promise<void>;
}

declare const Go: {
    new (): GoInstance;
};

// Web Worker global scope doesn't have all types by default in TS
declare const self: Worker & {
    importScripts(...urls: string[]): void;
    runGoSource(code: string): Promise<boolean>;
    runGoTask(_taskId: string): Promise<boolean>;
};

const postEvent = (event: RunnerEvent) => {
    self.postMessage(event);
};

// Intercept Go's stdout (fmt.Println) and stderr
const setupGoConsoleProxy = () => {
    const originalLog = console.log;
    const originalError = console.error;

    console.log = (...args: unknown[]) => {
        postEvent({
            type: "STDOUT",
            payload: args.map(String).join(" "),
        });
        originalLog(...args);
    };

    console.error = (...args: unknown[]) => {
        postEvent({
            type: "STDERR",
            payload: args.map(String).join(" "),
        });
        originalError(...args);
    };
};

let goInstance: GoInstance | null = null;
let throughput = 0;
let activeTasks = 0;
let peakConcurrency = 0;

const initGoWasm = async () => {
    if (goInstance) return;

    try {
        // Load the Go WASM glue code from the public folder
        const response = await fetch("/wasm_exec.js");
        if (!response.ok) throw new Error("Failed to fetch wasm_exec.js");
        const script = await response.text();

        // Evaluate the glue code to define the 'Go' global
        // eslint-disable-next-line no-eval
        (0, eval)(script);

        if (typeof Go === "undefined") {
            throw new Error(
                "Go constructor not found after loading wasm_exec.js",
            );
        }

        goInstance = new Go();
        const wasmResponse = await fetch("/main.wasm");
        if (!wasmResponse.ok) throw new Error("Failed to fetch main.wasm");

        const result = await WebAssembly.instantiateStreaming(
            wasmResponse,
            goInstance.importObject,
        );

        // Define runGoTask on self so the Go WASM engine can call back into JS
        // to update metrics and simulate I/O delay.
        self.runGoTask = async (_taskId: string) => {
            activeTasks++;
            if (activeTasks > peakConcurrency) peakConcurrency = activeTasks;

            // Simulate typical network/IO latency (e.g., 50ms)
            await new Promise((resolve) => setTimeout(resolve, 50));

            throughput++;
            activeTasks--;

            postEvent({
                type: "METRIC_UPDATE",
                payload: { throughput, collisions: 0 },
            });

            return true;
        };

        // Start the Go runtime in the background
        void goInstance.run(result.instance);

        // Small delay to ensure Go main() runs and registers runGoSource
        await new Promise((resolve) => setTimeout(resolve, 200));
    } catch (err) {
        throw new Error(
            `Go WASM initialization failed: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
};

const runGoCode = async (code: string) => {
    try {
        // Reset metrics for the new run
        throughput = 0;
        activeTasks = 0;
        peakConcurrency = 0;

        await initGoWasm();

        postEvent({
            type: "STDOUT",
            payload: "[System] Interpreting Go source via Yaegi WASM...",
        });

        // Call the exported Go function from main.go (Yaegi engine)
        // This will block until the student's code (including go routines) completes
        // or the interpreter finishes evaluating the main package.
        await self.runGoSource(code);

        postEvent({
            type: "STDOUT",
            payload: `\n[System] Run finished. Peak concurrency: ${peakConcurrency}`,
        });

        postEvent({ type: "RUN_COMPLETE" });
    } catch (error) {
        postEvent({
            type: "RUN_ERROR",
            payload: error instanceof Error ? error.message : String(error),
        });
    }
};

self.addEventListener("message", async (e: MessageEvent<RunnerCommand>) => {
    const { type, payload } = e.data;

    switch (type) {
        case "START_RUN": {
            const { code, deck } = payload as StartRunPayload & {
                deck?: unknown;
            };
            setupGoConsoleProxy();

            // Try to wire a JS Warehouse runtime if available and forward its events.
            // This is non-fatal: if the module isn't resolvable in this worker environment,
            // we simply proceed without the warehouse instrumentation.
            let warehouseUnsub: (() => void) | null = null;
            let warehouseInstance: any = null;
            try {
                // Use dynamic import so bundlers/workers that can't resolve the module won't crash here.
                // The path mirrors the project's source layout; if your bundler supports path aliases
                // (like @/lib/warehouse/warehouse), replace the string below accordingly.
                // Try importing the project's Warehouse module via the source alias.
                // Use the @ alias which the bundler/Vite resolves; falling back to a single
                // dynamic import keeps the code simpler and avoids absolute /src/... paths.
                const mod =
                    (await import("@/lib/warehouse/warehouse").catch(
                        () => null,
                    )) || null;
                if (mod && typeof mod.createWarehouse === "function") {
                    const createWarehouse = mod.createWarehouse;
                    const runDeck = Array.isArray(deck) ? deck : undefined;
                    warehouseInstance = createWarehouse(runDeck);
                    if (
                        warehouseInstance &&
                        typeof warehouseInstance.onEvent === "function"
                    ) {
                        warehouseUnsub = warehouseInstance.onEvent(
                            (ev: any) => {
                                postEvent({
                                    type: "WAREHOUSE_EVENT",
                                    payload: ev,
                                });
                            },
                        ) as any;
                    }
                }
            } catch (err) {
                // Non-fatal: continue without warehouse forwarding
            }

            // Execute the Go code as before
            await runGoCode(code);

            // Cleanup any created warehouse instance
            try {
                if (warehouseUnsub) warehouseUnsub();
            } catch (e) {
                // ignore
            }
            try {
                if (
                    warehouseInstance &&
                    typeof warehouseInstance.dispose === "function"
                ) {
                    warehouseInstance.dispose();
                }
            } catch (e) {
                // ignore
            }

            break;
        }
    }
});

// Signal to the main thread that the worker is ready
postEvent({ type: "RUNNER_READY" });
