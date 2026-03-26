import { createWarehouse } from "@/lib/warehouse/warehouse";
import type { RunnerEvent, RunnerCommand, StartRunPayload } from "./bridge";

// wasm_exec.js helper for the Go Worker
import "./go/wasm_exec.js";

declare global {
    class Go {
        importObject: any;
        run(instance: WebAssembly.Instance): Promise<void>;
    }
    // Analyzer (LSP) exports
    function getDiagnostics(code: string): string;
    function getCompletions(code: string, line: number, column: number): string;
    function getHover(code: string, line: number, column: number): string;
    function getSignatureHelp(
        code: string,
        line: number,
        column: number,
    ): string;

    // Executor (Yaegi) exports
    function runGoSource(code: string): Promise<boolean>;
}

const postEvent = (event: RunnerEvent) => {
    self.postMessage(event);
};

// --- Analyzer (LSP) Initialization ---
let analyzerInitialized = false;
const goAnalyzer = new Go();

const initAnalyzerWasm = async () => {
    if (analyzerInitialized) return;

    try {
        const response = await fetch("/go-analyzer.wasm");
        if (!response.ok)
            throw new Error(
                `Failed to fetch go-analyzer.wasm: ${response.statusText}`,
            );
        const buffer = await response.arrayBuffer();
        const { instance } = await WebAssembly.instantiate(
            buffer,
            goAnalyzer.importObject,
        );

        // Start the Go analyzer in the background
        goAnalyzer.run(instance);
        analyzerInitialized = true;
    } catch (err) {
        console.error("Failed to initialize Go Analyzer WASM:", err);
        throw err;
    }
};

// --- Executor (Yaegi) Initialization ---
let executorInitialized = false;
let executorReadyResolver: (() => void) | null = null;
const executorReadyPromise = new Promise<void>((resolve) => {
    executorReadyResolver = resolve;
});

(self as any).signalExecutorReady = () => {
    if (executorReadyResolver) {
        executorReadyResolver();
    }
};

const goExecutor = new Go();

const initExecutorWasm = async () => {
    if (executorInitialized) return;

    try {
        const wasmResponse = await fetch("/go-executor.wasm");
        if (!wasmResponse.ok)
            throw new Error("Failed to fetch go-executor.wasm");

        const result = await WebAssembly.instantiateStreaming(
            wasmResponse,
            goExecutor.importObject,
        );

        // Start the Go executor in the background
        void goExecutor.run(result.instance);

        // Wait for the Go side to signal that runGoSource is registered
        await executorReadyPromise;
        executorInitialized = true;
    } catch (err) {
        console.error("Failed to initialize Go Executor WASM:", err);
        throw err;
    }
};

// --- Support Logic ---

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

const runGoCode = async (code: string) => {
    try {
        await initExecutorWasm();

        postEvent({
            type: "STDOUT",
            payload: "[System] Interpreting Go source via Yaegi WASM...",
        });

        // Call the exported Go function from main.go (Yaegi engine)
        // This will block until the student's code (including go routines) completes
        await self.runGoSource(code);

        postEvent({
            type: "STDOUT",
            payload: `\n[System] Run finished`,
        });

        postEvent({ type: "RUN_COMPLETE" });
    } catch (error) {
        postEvent({
            type: "RUN_ERROR",
            payload: error instanceof Error ? error.message : String(error),
        });
    }
};

// --- Message Handler ---

self.onmessage = async (e: MessageEvent<RunnerCommand>) => {
    const { type, payload } = e.data;

    try {
        switch (type) {
            case "START_RUN": {
                const { code, deck } = payload as StartRunPayload & {
                    deck?: unknown;
                };
                setupGoConsoleProxy();

                let warehouseUnsub: (() => void) | null = null;
                let warehouseInstance: any = null;
                try {
                    const runDeck = Array.isArray(deck) ? deck : undefined;
                    warehouseInstance = createWarehouse(runDeck);

                    // Expose to the Go WASM runtime via global self
                    (self as any).__warehouse = warehouseInstance;

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
                                try {
                                    if (ev && ev.type !== "HEARTBEAT") {
                                        const pid =
                                            ev.packageId !== undefined
                                                ? String(ev.packageId)
                                                : "-";
                                        const meta = ev.metadata
                                            ? ` ${JSON.stringify(ev.metadata)}`
                                            : "";
                                        const msg = `[Warehouse] ${ev.type} pkg=${pid} ${meta}`;
                                        if (ev.type === "ERROR") {
                                            postEvent({
                                                type: "STDERR",
                                                payload: msg,
                                            });
                                        } else {
                                            postEvent({
                                                type: "STDOUT",
                                                payload: msg,
                                            });
                                        }
                                    }
                                } catch {
                                    // ignore
                                }
                            },
                        ) as any;
                    }
                } catch {
                    // ignore
                }

                await runGoCode(code);

                // Cleanup
                try {
                    if (warehouseUnsub) warehouseUnsub();
                    delete (self as any).__warehouse;
                    if (warehouseInstance?.dispose) warehouseInstance.dispose();
                } catch {
                    // ignore
                }
                break;
            }
            case "GET_DIAGNOSTICS": {
                await initAnalyzerWasm();
                const { code, requestId } = payload as any;
                const json = self.getDiagnostics(code);
                const diagnostics = json ? JSON.parse(json) : [];
                self.postMessage({
                    type: "DIAGNOSTICS_RESULT",
                    payload: { diagnostics, requestId },
                });
                break;
            }
            case "GET_COMPLETIONS": {
                await initAnalyzerWasm();
                const { code, line, column, requestId } = payload as any;
                const json = self.getCompletions(code, line, column);
                const suggestions = json ? JSON.parse(json) : [];
                self.postMessage({
                    type: "COMPLETIONS_RESULT",
                    payload: { suggestions, requestId },
                });
                break;
            }
            case "GET_HOVER": {
                await initAnalyzerWasm();
                const { code, line, column, requestId } = payload as any;
                const json = self.getHover(code, line, column);
                const hover = json ? JSON.parse(json) : null;
                self.postMessage({
                    type: "HOVER_RESULT",
                    payload: { hover, requestId },
                });
                break;
            }
            case "GET_SIGNATURE_HELP": {
                await initAnalyzerWasm();
                const { code, line, column, requestId } = payload as any;
                const json = self.getSignatureHelp(code, line, column);
                const signatureHelp = json ? JSON.parse(json) : null;
                self.postMessage({
                    type: "SIGNATURE_HELP_RESULT",
                    payload: { signatureHelp, requestId },
                });
                break;
            }
        }
    } catch (err) {
        console.error("Go Worker Error:", err);
    }
};

// Signal readiness for execution
postEvent({ type: "RUNNER_READY" });
