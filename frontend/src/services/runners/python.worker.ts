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
let throughput = 0;
let activeTasks = 0;
let peakConcurrency = 0;

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

        // Register the bridge as a Python module: 'from arena import API'
        const arenaAPI = {
            process_task: async (_taskId: any) => {
                activeTasks++;
                if (activeTasks > peakConcurrency)
                    peakConcurrency = activeTasks;
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
        pyodide.registerJsModule("arena", { API: arenaAPI });
    } catch (err) {
        throw new Error(
            `Python (Pyodide) initialization failed: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
};

const runPythonCode = async (code: string, deck?: unknown) => {
    try {
        throughput = 0;
        activeTasks = 0;
        peakConcurrency = 0;

        await initPyodide();

        postEvent({
            type: "STDOUT",
            payload: "[System] Starting Python run...",
        });

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
                                    type:
                                        ev.type === "ERROR"
                                            ? "STDERR"
                                            : "STDOUT",
                                    payload: msg,
                                });
                            }
                        } catch {}
                    }) as any;
                }
                try {
                    pyodide!.registerJsModule("warehouse", warehouseInstance);
                } catch {}
            }
        } catch {}

        await pyodide!.runPythonAsync(code);
        postEvent({
            type: "STDOUT",
            payload: `\n[System] Python Run finished. Peak concurrency: ${peakConcurrency}`,
        });
        await new Promise((r) => setTimeout(r, 10));
        postEvent({ type: "RUN_COMPLETE" });

        try {
            if (warehouseUnsub) warehouseUnsub();
        } catch {}
        try {
            if (warehouseInstance?.dispose) warehouseInstance.dispose();
        } catch {}
    } catch (error) {
        postEvent({ type: "RUN_ERROR", payload: String(error) });
    }
};

self.onmessage = async (e: MessageEvent<RunnerCommand>) => {
    const { type, payload } = e.data;

    switch (type) {
        case "START_RUN": {
            const { code, deck } = payload as StartRunPayload;
            await runPythonCode(code, deck);
            break;
        }
        case "GET_COMPLETIONS": {
            const { code, line, column, requestId } =
                payload as GetCompletionsPayload;
            await initPyodide();

            // Inject the completions logic if not present
            if (!pyodide!.globals.has("get_completions")) {
                await pyodide!.runPythonAsync(completionsScript);
            }

            const results = await pyodide!.runPythonAsync(
                `get_completions(${JSON.stringify(code)}, ${line}, ${column}, ${JSON.stringify(warehouseStubs)})`,
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

            // Inject hover logic if not present
            if (!pyodide!.globals.has("get_hover")) {
                await pyodide!.runPythonAsync(hoverScript);
            }

            const results = await pyodide!.runPythonAsync(
                `get_hover(${JSON.stringify(code)}, ${line}, ${column}, ${JSON.stringify(warehouseStubs)})`,
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

            if (!pyodide!.globals.has("get_diagnostics")) {
                await pyodide!.runPythonAsync(diagnosticsScript);
            }

            const results = await pyodide!.runPythonAsync(
                `get_diagnostics(${JSON.stringify(code)}, ${JSON.stringify(warehouseStubs)})`,
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

            if (!pyodide!.globals.has("get_signatures")) {
                await pyodide!.runPythonAsync(signaturesScript);
            }

            const results = await pyodide!.runPythonAsync(
                `get_signatures(${JSON.stringify(code)}, ${line}, ${column}, ${JSON.stringify(warehouseStubs)})`,
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
