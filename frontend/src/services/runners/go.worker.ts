// wasm_exec.js helper for the Go Worker
import "./go/wasm_exec.js";

declare global {
    class Go {
        importObject: any;
        run(instance: WebAssembly.Instance): Promise<void>;
    }
    function getDiagnostics(code: string): string;
    function getCompletions(code: string, line: number, column: number): string;
    function getHover(code: string, line: number, column: number): string;
    function getSignatureHelp(
        code: string,
        line: number,
        column: number,
    ): string;
}

const go = new Go();
let initialized = false;

const initWasm = async () => {
    if (initialized) return;

    try {
        const response = await fetch("/go-analyzer.wasm");
        if (!response.ok)
            throw new Error(
                `Failed to fetch go-analyzer.wasm: ${response.statusText}`,
            );
        const buffer = await response.arrayBuffer();
        const { instance } = await WebAssembly.instantiate(
            buffer,
            go.importObject,
        );

        // Start the Go program in the background
        go.run(instance);
        initialized = true;
    } catch (err) {
        console.error("Failed to initialize Go WASM:", err);
        throw err;
    }
};

self.onmessage = async (e: MessageEvent) => {
    const { type, payload } = e.data;

    try {
        await initWasm();

        switch (type) {
            case "GET_DIAGNOSTICS": {
                const { code, requestId } = payload;
                const json = self.getDiagnostics(code);
                if (!json) {
                    self.postMessage({
                        type: "DIAGNOSTICS_RESULT",
                        payload: { diagnostics: [], requestId },
                    });
                    break;
                }
                const diagnostics = JSON.parse(json);
                self.postMessage({
                    type: "DIAGNOSTICS_RESULT",
                    payload: { diagnostics, requestId },
                });
                break;
            }
            case "GET_COMPLETIONS": {
                const { code, line, column, requestId } = payload;
                const json = self.getCompletions(code, line, column);
                if (!json) {
                    self.postMessage({
                        type: "COMPLETIONS_RESULT",
                        payload: { suggestions: [], requestId },
                    });
                    break;
                }
                const suggestions = JSON.parse(json);
                self.postMessage({
                    type: "COMPLETIONS_RESULT",
                    payload: { suggestions, requestId },
                });
                break;
            }
            case "GET_HOVER": {
                const { code, line, column, requestId } = payload;
                const json = self.getHover(code, line, column);
                const hover = json ? JSON.parse(json) : null;
                self.postMessage({
                    type: "HOVER_RESULT",
                    payload: { hover, requestId },
                });
                break;
            }
            case "GET_SIGNATURE_HELP": {
                const { code, line, column, requestId } = payload;
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
        console.error("Go Analyzer Worker Error:", err);
    }
};
