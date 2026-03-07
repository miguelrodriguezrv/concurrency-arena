import type { RunnerEvent, RunnerCommand, StartRunPayload } from "./bridge";

/**
 * This Web Worker hosts the Pyodide (Python WASM) runtime.
 * It provides a bridge between student Python code and the JS metrics engine.
 */

// Define global types for Pyodide
interface PyodideInterface {
    loadPackage(packages: string[]): Promise<void>;
    runPythonAsync(code: string): Promise<any>;
    registerJsModule(name: string, module: any): void;
    setStdout(options: { batched: (str: string) => void }): void;
    setStderr(options: { batched: (str: string) => void }): void;
}

declare const loadPyodide: (options: {
    indexURL: string;
}) => Promise<PyodideInterface>;

const postEvent = (event: RunnerEvent) => {
    self.postMessage(event);
};

let pyodide: PyodideInterface | null = null;
let throughput = 0;
let activeTasks = 0;
let peakConcurrency = 0;

const initPyodide = async () => {
    if (pyodide) return;

    try {
        // In Module Workers (Vite's default), importScripts is disallowed.
        // We fetch the pyodide loader and eval it to initialize the global loadPyodide function.
        const pyodideUrl =
            "https://cdn.jsdelivr.net/pyodide/v0.29.3/full/pyodide.js";
        const response = await fetch(pyodideUrl);
        if (!response.ok) throw new Error("Failed to fetch pyodide.js");
        const script = await response.text();

        // eslint-disable-next-line no-eval
        (0, eval)(script);

        if (typeof loadPyodide === "undefined") {
            throw new Error("loadPyodide not found after loading script");
        }

        pyodide = await loadPyodide({
            indexURL: "https://cdn.jsdelivr.net/pyodide/v0.29.3/full/",
        });

        // Intercept Python's stdout/stderr and pipe them to our UI
        pyodide.setStdout({
            batched: (str: string) => {
                postEvent({ type: "STDOUT", payload: str });
            },
        });

        pyodide.setStderr({
            batched: (str: string) => {
                postEvent({ type: "STDERR", payload: str });
            },
        });

        // Define the Arena API bridge
        const arenaAPI = {
            process_task: async (_taskId: any) => {
                activeTasks++;
                if (activeTasks > peakConcurrency)
                    peakConcurrency = activeTasks;

                // Simulate I/O delay (50ms)
                await new Promise((resolve) => setTimeout(resolve, 50));

                throughput++;
                activeTasks--;

                postEvent({
                    type: "METRIC_UPDATE",
                    payload: { throughput, collisions: 0 },
                });

                return true;
            },
        };

        // Register the bridge as a Python module: 'from arena import API'
        pyodide.registerJsModule("arena", { API: arenaAPI });
    } catch (err) {
        throw new Error(
            `Python (Pyodide) initialization failed: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
};

const runPythonCode = async (code: string, deck?: unknown) => {
    try {
        // Reset metrics for the new run
        throughput = 0;
        activeTasks = 0;
        peakConcurrency = 0;

        await initPyodide();

        postEvent({
            type: "STDOUT",
            payload: "[System] Initializing Python (Pyodide) runtime...",
        });

        // Attempt to wire a JS Warehouse runtime if available in this worker environment.
        // This is optional and non-fatal: if resolution/import fails, we proceed.
        let warehouseInstance: any = null;
        let warehouseUnsub: (() => void) | null = null;
        try {
            const tryImport = async (p: string) =>
                await import(p).catch(() => null);
            const mod =
                (await tryImport("/src/lib/warehouse/warehouse.js")) ||
                (await tryImport("/src/lib/warehouse/warehouse"));
            if (mod && typeof mod.createWarehouse === "function") {
                const createWarehouse = mod.createWarehouse;
                const runDeck = Array.isArray(deck) ? (deck as any) : undefined;
                warehouseInstance = createWarehouse(runDeck);
                if (
                    warehouseInstance &&
                    typeof warehouseInstance.onEvent === "function"
                ) {
                    warehouseUnsub = warehouseInstance.onEvent(
                        (ev: unknown) => {
                            postEvent({ type: "WAREHOUSE_EVENT", payload: ev });
                        },
                    ) as any;
                }

                // If pyodide is available, register the warehouse instance as a JS module
                // so Python students can `import warehouse` (best-effort).
                try {
                    (pyodide as any).registerJsModule &&
                        (pyodide as any).registerJsModule(
                            "warehouse",
                            warehouseInstance,
                        );
                } catch (e) {
                    // ignore registration failures
                }
            }
        } catch (e) {
            // Non-fatal: continue without warehouse instrumentation
        }

        // Run the student's Python code (supports top-level await)
        await pyodide!.runPythonAsync(code);

        postEvent({
            type: "STDOUT",
            payload: `\n[System] Python Run finished. Peak concurrency: ${peakConcurrency}`,
        });

        // Give the runtime a short moment to flush warehouse events if any
        await new Promise((r) => setTimeout(r, 10));

        postEvent({ type: "RUN_COMPLETE" });

        // Cleanup any warehouse wiring
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
    } catch (error) {
        // Pyodide errors can be complex objects; we stringify them for the UI
        postEvent({
            type: "RUN_ERROR",
            payload: String(error),
        });
    }
};

self.onmessage = async (e: MessageEvent<RunnerCommand>) => {
    const { type, payload } = e.data;

    switch (type) {
        case "START_RUN": {
            const { code, deck } = payload as StartRunPayload & {
                deck?: unknown;
            };
            await runPythonCode(code, deck);
            break;
        }
    }
};

// Signal that the worker script is ready
postEvent({ type: "RUNNER_READY" });
