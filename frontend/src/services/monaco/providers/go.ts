import type { Monaco } from "@monaco-editor/react";
import type { editor, Position } from "monaco-editor";

let goWorker: Worker | null = null;
const pendingRequests = new Map<string, (result: any) => void>();

function getGoWorker(): Worker {
    if (!goWorker) {
        goWorker = new Worker(
            new URL("../../runners/go.worker.ts", import.meta.url),
            { type: "module" }
        );

        goWorker.onmessage = (e) => {
            const { type, payload } = e.data;
            if (
                type === "COMPLETIONS_RESULT" ||
                type === "DIAGNOSTICS_RESULT" ||
                type === "HOVER_RESULT" ||
                type === "SIGNATURE_HELP_RESULT"
            ) {
                const { requestId } = payload as any;
                const resolve = pendingRequests.get(requestId);
                if (resolve) {
                    if (type === "COMPLETIONS_RESULT") {
                        resolve(payload.suggestions);
                    } else if (type === "DIAGNOSTICS_RESULT") {
                        resolve(payload.diagnostics);
                    } else if (type === "HOVER_RESULT") {
                        resolve(payload.hover);
                    } else if (type === "SIGNATURE_HELP_RESULT") {
                        resolve(payload.signatureHelp);
                    }
                    pendingRequests.delete(requestId);
                }
            }
        };
    }
    return goWorker;
}

/**
 * Preload the Go WASM Analyzer in the background.
 */
export function preloadGoProviders() {
    const worker = getGoWorker();
    worker.postMessage({ type: "PRELOAD" });
}

/**
 * Basic Go IntelliSense Provider using WASM Analyzer.
 */
export function registerGoProviders(monaco: Monaco) {
    monaco.languages.registerCompletionItemProvider("go", {
        triggerCharacters: ["."],
        provideCompletionItems: async (
            model: editor.ITextModel,
            position: Position,
        ) => {
            const worker = getGoWorker();
            const requestId = Math.random().toString(36).substring(7);
            const code = model.getValue();

            const promise = new Promise<any[]>((resolve) => {
                pendingRequests.set(requestId, resolve);
            });

            worker.postMessage({
                type: "GET_COMPLETIONS",
                payload: {
                    code,
                    line: position.lineNumber,
                    column: position.column,
                    requestId,
                }
            });

            // Timeout to prevent hanging UI
            const timeout = new Promise<any[]>((resolve) =>
                setTimeout(() => {
                    pendingRequests.delete(requestId);
                    resolve([]);
                }, 2000),
            );

            const suggestions = await Promise.race([promise, timeout]) || [];
            
            const wordInfo = model.getWordUntilPosition(position);
            const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: wordInfo.startColumn,
                endColumn: wordInfo.endColumn,
            };

            return {
                suggestions: suggestions.map((s: any) => ({
                    label: s.name,
                    kind: s.kind === "function" ? monaco.languages.CompletionItemKind.Function : monaco.languages.CompletionItemKind.Field,
                    detail: s.detail,
                    documentation: s.documentation,
                    insertText: s.kind === "function" && !s.name.includes("(") ? `${s.name}()` : s.name,
                    range,
                }))
            };
        },
    });

    // Register Go Hover Provider via WASM
    monaco.languages.registerHoverProvider("go", {
        provideHover: async (model: editor.ITextModel, position: Position) => {
            const word = model.getWordAtPosition(position);
            if (!word) return null;

            const worker = getGoWorker();
            const requestId = Math.random().toString(36).substring(7);
            const code = model.getValue();

            const promise = new Promise<any>((resolve) => {
                pendingRequests.set(requestId, resolve);
            });

            worker.postMessage({
                type: "GET_HOVER",
                payload: {
                    code,
                    line: position.lineNumber,
                    column: position.column,
                    requestId,
                },
            });

            const timeout = new Promise<null>((resolve) =>
                setTimeout(() => {
                    pendingRequests.delete(requestId);
                    resolve(null);
                }, 1000),
            );

            const data = await Promise.race([promise, timeout]);
            if (data) {
                return {
                    range: new monaco.Range(
                        position.lineNumber,
                        word.startColumn,
                        position.lineNumber,
                        word.endColumn,
                    ),
                    contents: [
                        { value: `\`\`\`go\n${data.detail}\n\`\`\`` },
                        { value: data.doc },
                    ],
                };
            }
            return null;
        },
    });

    // Case D: Register Go Signature Help Provider
    monaco.languages.registerSignatureHelpProvider("go", {
        signatureHelpTriggerCharacters: ["(", ","],
        provideSignatureHelp: async (
            model: editor.ITextModel,
            position: Position,
        ) => {
            const worker = getGoWorker();
            const requestId = Math.random().toString(36).substring(7);
            const code = model.getValue();

            const promise = new Promise<any>((resolve) => {
                pendingRequests.set(requestId, resolve);
            });

            worker.postMessage({
                type: "GET_SIGNATURE_HELP",
                payload: {
                    code,
                    line: position.lineNumber,
                    column: position.column,
                    requestId,
                },
            });

            const timeout = new Promise<null>((resolve) =>
                setTimeout(() => {
                    pendingRequests.delete(requestId);
                    resolve(null);
                }, 2000),
            );

            const signatureHelp = await Promise.race([promise, timeout]);
            if (signatureHelp) {
                return {
                    value: signatureHelp,
                    dispose: () => {},
                };
            }
            return null;
        },
    });

    // Implementation of a simple background linter using Monaco Markers
    let lintTimeout: ReturnType<typeof setTimeout> | null = null;
    const runLinter = (model: editor.ITextModel) => {
        if (model.getLanguageId() !== "go") return;
        if (lintTimeout) clearTimeout(lintTimeout);
        lintTimeout = setTimeout(async () => {
            const worker = getGoWorker();
            const requestId = Math.random().toString(36).substring(7);
            const code = model.getValue();

            const promise = new Promise<any[]>((resolve) => {
                pendingRequests.set(requestId, resolve);
            });

            worker.postMessage({
                type: "GET_DIAGNOSTICS",
                payload: { code, requestId },
            });

            const timeout = new Promise<any[]>((resolve) =>
                setTimeout(() => {
                    pendingRequests.delete(requestId);
                    resolve([]);
                }, 2000),
            );

            const diagnostics = await Promise.race([promise, timeout]) || [];

            const markers = diagnostics.map((d: any) => ({
                severity: monaco.MarkerSeverity.Error,
                message: d.message,
                startLineNumber: d.line,
                startColumn: d.column,
                endLineNumber: d.line,
                endColumn: d.column + (d.message.includes("undefined") ? 10 : 1),
            }));


            if (model.isDisposed()) return;
            monaco.editor.setModelMarkers(model, "go-wasm", markers);
        }, 1000);
    };

    const registeredModels = new Set<string>();
    const attachLinter = (model: editor.ITextModel) => {
        if (model.getLanguageId() === "go" && !registeredModels.has(model.id)) {
            registeredModels.add(model.id);
            runLinter(model);
            model.onDidChangeContent(() => {
                runLinter(model);
            });
            model.onWillDispose(() => {
                monaco.editor.setModelMarkers(model, "go-wasm", []);
                registeredModels.delete(model.id);
            });
        }
    };

    monaco.editor.onDidCreateModel(attachLinter);
    monaco.editor.getModels().forEach(attachLinter);
}
