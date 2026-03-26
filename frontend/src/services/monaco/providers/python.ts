import type { Monaco } from "@monaco-editor/react";
import type { editor, Position } from "monaco-editor";
import type {
    RunnerCommand,
    RunnerEvent,
    GetCompletionsPayload,
    CompletionsResultPayload,
    GetHoverPayload,
    HoverResultPayload,
    GetDiagnosticsPayload,
    DiagnosticsResultPayload,
    GetSignaturesPayload,
    SignaturesResultPayload,
} from "../../runners/bridge";

let pythonWorker: Worker | null = null;
const pendingRequests = new Map<string, (result: any) => void>();

function getPythonWorker(): Worker {
    if (!pythonWorker) {
        // Separate worker instance for completions to avoid collision with run environment
        pythonWorker = new Worker(
            new URL("../../runners/python.worker.ts", import.meta.url),
            { type: "module" },
        );

        pythonWorker.onmessage = (e: MessageEvent<RunnerEvent>) => {
            const { type, payload } = e.data;
            const resTypes = [
                "COMPLETIONS_RESULT",
                "HOVER_RESULT",
                "DIAGNOSTICS_RESULT",
                "SIGNATURES_RESULT",
            ];
            if (resTypes.includes(type)) {
                const { requestId } = payload;
                const resolve = pendingRequests.get(requestId);
                if (resolve) {
                    if (type === "COMPLETIONS_RESULT") {
                        resolve(
                            (payload as CompletionsResultPayload).suggestions,
                        );
                    } else if (type === "HOVER_RESULT") {
                        resolve((payload as HoverResultPayload).contents);
                    } else if (type === "DIAGNOSTICS_RESULT") {
                        resolve(
                            (payload as DiagnosticsResultPayload).diagnostics,
                        );
                    } else if (type === "SIGNATURES_RESULT") {
                        resolve(
                            (payload as SignaturesResultPayload).signatures,
                        );
                    }
                    pendingRequests.delete(requestId);
                }
            }
        };
    }
    return pythonWorker;
}

const mapJediKindToMonaco = (kind: string, monaco: Monaco) => {
    switch (kind) {
        case "module":
            return monaco.languages.CompletionItemKind.Module;
        case "class":
            return monaco.languages.CompletionItemKind.Class;
        case "instance":
            return monaco.languages.CompletionItemKind.Variable;
        case "function":
            return monaco.languages.CompletionItemKind.Function;
        case "param":
            return monaco.languages.CompletionItemKind.Variable;
        case "path":
            return monaco.languages.CompletionItemKind.File;
        case "keyword":
            return monaco.languages.CompletionItemKind.Keyword;
        case "property":
            return monaco.languages.CompletionItemKind.Property;
        case "statement":
            return monaco.languages.CompletionItemKind.Variable;
        default:
            return monaco.languages.CompletionItemKind.Text;
    }
};

export function registerPythonJediProvider(monaco: Monaco) {
    // Register Completion Provider
    monaco.languages.registerCompletionItemProvider("python", {
        triggerCharacters: ["."],
        provideCompletionItems: async (
            model: editor.ITextModel,
            position: Position,
        ) => {
            const worker = getPythonWorker();
            const requestId = Math.random().toString(36).substring(7);
            const code = model.getValue();

            const promise = new Promise<any[]>((resolve) => {
                pendingRequests.set(requestId, resolve);
            });

            const completionPayload: GetCompletionsPayload = {
                code,
                line: position.lineNumber,
                column: position.column - 1,
                requestId,
            };

            worker.postMessage({
                type: "GET_COMPLETIONS",
                payload: completionPayload,
            } as RunnerCommand);

            // Timeout to prevent hanging UI
            const timeout = new Promise<any[]>((resolve) =>
                setTimeout(() => {
                    pendingRequests.delete(requestId);
                    resolve([]);
                }, 2000),
            );

            const results = await Promise.race([promise, timeout]);
            const suggestions = results || [];

            const wordInfo = model.getWordUntilPosition(position);
            const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: wordInfo.startColumn,
                endColumn: wordInfo.endColumn,
            };

            const monacoSuggestions = suggestions.map((s: any) => {
                let kind = mapJediKindToMonaco(s.kind, monaco);
                let insertText = s.insertText;

                // Simple generic logic: add () for functions if not already present
                if (
                    s.kind === "function" &&
                    !insertText.endsWith(")") &&
                    !code
                        .substring(model.getOffsetAt(position))
                        .trim()
                        .startsWith("(")
                ) {
                    insertText = `${s.insertText}()`;
                }

                return {
                    label: s.label,
                    kind: kind,
                    detail: s.detail,
                    documentation: s.doc,
                    insertText: insertText,
                    range: range,
                };
            });

            return { suggestions: monacoSuggestions };
        },
    });

    // Register Hover Provider
    monaco.languages.registerHoverProvider("python", {
        provideHover: async (model: editor.ITextModel, position: Position) => {
            const worker = getPythonWorker();
            const requestId = Math.random().toString(36).substring(7);
            const code = model.getValue();

            const promise = new Promise<any[]>((resolve) => {
                pendingRequests.set(requestId, resolve);
            });

            const hoverPayload: GetHoverPayload = {
                code,
                line: position.lineNumber,
                column: position.column - 1,
                requestId,
            };

            worker.postMessage({
                type: "GET_HOVER",
                payload: hoverPayload,
            } as RunnerCommand);

            // Timeout to prevent hanging UI
            const timeout = new Promise<any[]>((resolve) =>
                setTimeout(() => {
                    pendingRequests.delete(requestId);
                    resolve([]);
                }, 1000),
            );

            const results = await Promise.race([promise, timeout]);
            const contents = results || [];

            if (contents.length === 0) return null;

            return {
                contents: contents.map((c) => ({
                    value: c.value,
                    isTrusted: true,
                    supportHtml: true,
                })),
                range: model.getWordAtPosition(position)
                    ? {
                          startLineNumber: position.lineNumber,
                          startColumn:
                              model.getWordAtPosition(position)!.startColumn,
                          endLineNumber: position.lineNumber,
                          endColumn:
                              model.getWordAtPosition(position)!.endColumn,
                      }
                    : undefined,
            };
        },
    });

    // Register Signature Help Provider
    monaco.languages.registerSignatureHelpProvider("python", {
        signatureHelpTriggerCharacters: ["(", ","],
        provideSignatureHelp: async (
            model: editor.ITextModel,
            position: Position,
        ) => {
            const worker = getPythonWorker();
            const requestId = Math.random().toString(36).substring(7);
            const code = model.getValue();

            const promise = new Promise<any[]>((resolve) => {
                pendingRequests.set(requestId, resolve);
            });

            const sigPayload: GetSignaturesPayload = {
                code,
                line: position.lineNumber,
                column: position.column - 1,
                requestId,
            };

            worker.postMessage({
                type: "GET_SIGNATURES",
                payload: sigPayload,
            } as RunnerCommand);

            const timeout = new Promise<any[]>((resolve) =>
                setTimeout(() => {
                    pendingRequests.delete(requestId);
                    resolve([]);
                }, 1000),
            );

            const results = await Promise.race([promise, timeout]);
            const signatures = results || [];

            if (signatures.length === 0) return null;

            return {
                value: {
                    signatures: signatures.map((s) => ({
                        label: s.label,
                        documentation: {
                            value: s.documentation || "",
                            isTrusted: true,
                            supportHtml: true,
                        },
                        parameters: s.parameters.map((p: any) => ({
                            label: p.label,
                            documentation: {
                                value: p.documentation || "",
                                isTrusted: true,
                                supportHtml: true,
                            },
                        })),
                        activeParameter: s.activeParameter,
                    })),
                    activeSignature: 0,
                    activeParameter: signatures[0].activeParameter,
                },
                dispose: () => {},
            };
        },
    });

    // Implementation of a simple background linter using Monaco Markers
    let lintTimeout: ReturnType<typeof setTimeout> | null = null;
    const runLinter = (model: editor.ITextModel) => {
        if (model.getLanguageId() !== "python") return; // CRITICAL: Only run for Python files
        if (lintTimeout) clearTimeout(lintTimeout);
        lintTimeout = setTimeout(async () => {
            const worker = getPythonWorker();
            const requestId = Math.random().toString(36).substring(7);
            const code = model.getValue();

            const promise = new Promise<any[]>((resolve) => {
                pendingRequests.set(requestId, resolve);
            });

            const diagPayload: GetDiagnosticsPayload = {
                code,
                requestId,
            };

            worker.postMessage({
                type: "GET_DIAGNOSTICS",
                payload: diagPayload,
            } as RunnerCommand);

            const timeout = new Promise<any[]>((resolve) =>
                setTimeout(() => {
                    pendingRequests.delete(requestId);
                    resolve([]);
                }, 2000),
            );

            const results = await Promise.race([promise, timeout]);
            const diagnostics = (results || []).filter((d: any) => {
                // Filter out the common "await outside function" error for the top-level asyncio.run/await
                // because Pyodide allows top-level await in its execution context, but Jedi/compile() might flag it.
                const isTopLevelAwaitError =
                    d.message
                        ?.toLowerCase()
                        .includes("await' outside function") ||
                    d.message
                        ?.toLowerCase()
                        .includes("cannot use await at the top level");
                return !isTopLevelAwaitError;
            });

            const markers = diagnostics.map((d) => ({
                severity: monaco.MarkerSeverity.Error,
                message: d.message,
                startLineNumber: d.line,
                startColumn: d.column + 1,
                endLineNumber: d.until_line || d.line,
                endColumn:
                    d.until_column !== undefined
                        ? d.until_column + 1
                        : d.column + 2,
            }));

            if (model.isDisposed()) return;
            // Only set markers if the model is still python
            if (model.getLanguageId() === "python") {
                monaco.editor.setModelMarkers(model, "python-jedi", markers);
            }
        }, 1000);
    };

    // Trigger linter on model change
    const registeredModels = new Set<string>();
    const attachLinter = (model: editor.ITextModel) => {
        if (
            model.getLanguageId() === "python" &&
            !registeredModels.has(model.id)
        ) {
            registeredModels.add(model.id);
            runLinter(model);
            model.onDidChangeContent(() => runLinter(model));
            model.onWillDispose(() => {
                // Clear markers when the model is disposed
                monaco.editor.setModelMarkers(model, "python-jedi", []);
                registeredModels.delete(model.id);
            });
        }
    };

    monaco.editor.onDidCreateModel(attachLinter);
    monaco.editor.getModels().forEach(attachLinter);
}
