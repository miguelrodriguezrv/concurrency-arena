import { createWarehouse } from "@/lib/warehouse/warehouse";
import type {
    RunnerEvent,
    RunnerCommand,
    StartRunPayload,
    GetCompletionsPayload,
    CompletionsResultPayload,
    GetHoverPayload,
    HoverResultPayload,
    GetDiagnosticsPayload,
    DiagnosticsResultPayload,
    GetSignaturesPayload,
    SignaturesResultPayload,
} from "./bridge";

// Import Python assets as raw strings
import setupScript from "./python/setup.py?raw";
import warehouseStubs from "./python/warehouse.pyi?raw";
import completionsScript from "./python/completions.py?raw";
import hoverScript from "./python/hover.py?raw";
import diagnosticsScript from "./python/diagnostics.py?raw";
import signaturesScript from "./python/signatures.py?raw";
import warehouseScript from "./python/warehouse.py?raw";

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
    checkFeatures(): void;
    FS: any;
    globals: any;
}

declare const loadPyodide: (options: {
    indexURL: string;
}) => Promise<PyodideInterface>;

const postEvent = (event: RunnerEvent) => {
    self.postMessage(event);
};

let pyodide: PyodideInterface | null = null;

const initPyodide = async () => {
    if (pyodide) return;

    try {
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

        // Pre-load micropip and jedi for completions
        try {
            console.log("Loading jedi via loadPackage...");
            await pyodide.loadPackage(["micropip", "jedi"]);
            console.log("Jedi loaded successfully.");
        } catch (loadErr) {
            console.warn(
                "Failed to load jedi package via loadPackage, attempting micropip.install",
                loadErr,
            );
            await pyodide.runPythonAsync(`
                import micropip
                await micropip.install("jedi")
            `);
        }

        // Initial setup from external script
        await pyodide.runPythonAsync(setupScript);

        // Run setup functions
        // Since setup is an 'async def', we need to await it
        await pyodide.runPythonAsync("await setup()");

        // Ensure helper functions are globally available
        await pyodide.runPythonAsync(completionsScript);
        await pyodide.runPythonAsync(hoverScript);
        await pyodide.runPythonAsync(diagnosticsScript);
        await pyodide.runPythonAsync(signaturesScript);
    } catch (err) {
        throw new Error(
            `Python (Pyodide) initialization failed: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
};

const runPythonCode = async (code: string, deck?: unknown) => {
    try {
        await initPyodide();

        postEvent({
            type: "STDOUT",
            payload: "[System] Starting Python run...",
        });

        let warehouseInstance: any = null;
        let warehouseUnsub: (() => void) | null = null;
        try {
            warehouseInstance = createWarehouse(
                Array.isArray(deck) ? deck : undefined,
            );
            if (
                warehouseInstance &&
                typeof warehouseInstance.onEvent === "function"
            ) {
                warehouseUnsub = warehouseInstance.onEvent((ev: any) => {
                    postEvent({ type: "WAREHOUSE_EVENT", payload: ev });
                    try {
                        if (ev && ev.type !== "HEARTBEAT") {
                            const pid =
                                ev.packageId !== undefined
                                    ? String(ev.packageId)
                                    : "-";
                            const meta = ev.metadata
                                ? ` ${JSON.stringify(ev.metadata)}`
                                : "";
                            const msg = `[Warehouse] ${ev.type} pkg=${pid}${meta}`;
                            postEvent({
                                type: ev.type === "ERROR" ? "STDERR" : "STDOUT",
                                payload: msg,
                            });
                        }
                    } catch {
                        // ignore
                    }
                }) as any;
            }
            try {
                // Register the JS instance under a private name first
                // We'll then wrap it in a real Python module for better type support
                pyodide!.registerJsModule("_js_warehouse", warehouseInstance);

                // Create a real 'warehouse' module in the Python filesystem
                // This allows 'from warehouse import Warehouse' and ': warehouse.Warehouse' to work
                // and provides the module-level functions that students expect.
                await pyodide!.runPythonAsync(warehouseScript);
            } catch (e) {
                console.error("Failed to initialize warehouse module:", e);
            }
        } catch (e) {
            console.error("Warehouse setup error:", e);
        }

        // Set the user code in globals and execute it
        await pyodide!.runPythonAsync(code);

        // Call run(warehouse) if it exists, otherwise call main()
        // We use a separate string for the invocation to ensure warehouse is in the locals/globals
        await pyodide!.runPythonAsync(`
import inspect
import asyncio
import warehouse

async def invoke_entrypoint():
    # Find the warehouse instance (either the module or the injected bridge)
    wh_obj = warehouse

    # Check for run(w) first
    if "run" in globals() and callable(globals()["run"]):
        func = globals()["run"]
        params = inspect.signature(func).parameters
        if len(params) == 1:
            print("[System] Calling run(warehouse)...")
            res = func(wh_obj)
            if inspect.isawaitable(res):
                await res
            return

    # Fallback to main()
    if "main" in globals() and callable(globals()["main"]):
        print("[System] Calling main()...")
        res = globals()["main"]()
        if inspect.isawaitable(res):
            await res
        return

await invoke_entrypoint()
        `);

        postEvent({
            type: "STDOUT",
            payload: `\n[System] Python Run finished.`,
        });
        await new Promise((r) => setTimeout(r, 10));
        postEvent({ type: "RUN_COMPLETE" });

        try {
            if (warehouseUnsub) warehouseUnsub();
        } catch {
            // swallow
        }
        try {
            if (warehouseInstance?.dispose) warehouseInstance.dispose();
        } catch {
            // swallow
        }
    } catch (error) {
        postEvent({ type: "RUN_ERROR", payload: String(error) });
    }
};

self.onmessage = async (e: MessageEvent<RunnerCommand>) => {
    const { type, payload } = e.data;

    switch (type) {
        case "PRELOAD": {
            await initPyodide();
            break;
        }
        case "START_RUN": {
            const { code, deck } = payload as StartRunPayload;
            await runPythonCode(code, deck);
            break;
        }
        case "GET_COMPLETIONS": {
            const { code, line, column, requestId } =
                payload as GetCompletionsPayload;
            await initPyodide();

            const codeString = JSON.stringify(code);
            const stubsString = JSON.stringify(warehouseStubs);
            const results = await pyodide!.runPythonAsync(
                `get_completions(${codeString}, ${line}, ${column}, ${stubsString})`,
            );
            const suggestions = results.toJs();

            postEvent({
                type: "COMPLETIONS_RESULT",
                payload: { suggestions, requestId } as CompletionsResultPayload,
            });
            break;
        }
        case "GET_HOVER": {
            const { code, line, column, requestId } =
                payload as GetHoverPayload;
            await initPyodide();

            const codeString = JSON.stringify(code);
            const stubsString = JSON.stringify(warehouseStubs);
            const results = await pyodide!.runPythonAsync(
                `get_hover(${codeString}, ${line}, ${column}, ${stubsString})`,
            );
            const contents = results.toJs();

            postEvent({
                type: "HOVER_RESULT",
                payload: { contents, requestId } as HoverResultPayload,
            });
            break;
        }
        case "GET_DIAGNOSTICS": {
            const { code, requestId } = payload as GetDiagnosticsPayload;
            await initPyodide();

            const codeString = JSON.stringify(code);
            const stubsString = JSON.stringify(warehouseStubs);
            const results = await pyodide!.runPythonAsync(
                `get_diagnostics(${codeString}, ${stubsString})`,
            );
            const diagnostics = results.toJs();

            postEvent({
                type: "DIAGNOSTICS_RESULT",
                payload: { diagnostics, requestId } as DiagnosticsResultPayload,
            });
            break;
        }
        case "GET_SIGNATURES": {
            const { code, line, column, requestId } =
                payload as GetSignaturesPayload;
            await initPyodide();

            const codeString = JSON.stringify(code);
            const stubsString = JSON.stringify(warehouseStubs);
            const results = await pyodide!.runPythonAsync(
                `get_signatures(${codeString}, ${line}, ${column}, ${stubsString})`,
            );
            const signatures = results.toJs();

            postEvent({
                type: "SIGNATURES_RESULT",
                payload: { signatures, requestId } as SignaturesResultPayload,
            });
            break;
        }
    }
};

postEvent({ type: "RUNNER_READY" });
