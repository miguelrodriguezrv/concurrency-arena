import type { Monaco } from "@monaco-editor/react";
import type { editor, Position } from "monaco-editor";

/**
 * Basic Go IntelliSense Provider.
 * Provides Global API completions (warehouse package symbols)
 * and struct field completions for the 'Package' type.
 */
export function registerGoProviders(monaco: Monaco) {
    monaco.languages.registerCompletionItemProvider("go", {
        triggerCharacters: ["."],
        provideCompletionItems: (
            model: editor.ITextModel,
            position: Position,
        ) => {
            const word = model.getWordUntilPosition(position);
            const lineContent = model.getLineContent(position.lineNumber);
            const textUntilPosition = lineContent.substring(0, position.column - 1);
            
            const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn,
            };

            // CASE A: Member access (e.g., "pkg.")
            if (textUntilPosition.endsWith(".")) {
                const parts = textUntilPosition.split(/[ \t(]/);
                const lastPart = parts[parts.length - 1];
                const variableName = lastPart.substring(0, lastPart.length - 1);

                // Naive type inference: if variable name is 'pkg' or ends with 'package' or was declared with Unload
                const fullText = model.getValue();
                const isPackageType = 
                    variableName === "pkg" || 
                    variableName.toLowerCase().endsWith("package") ||
                    new RegExp(`\\b${variableName}\\s*:=\\s*Unload\\(`).test(fullText) ||
                    new RegExp(`var\\s+${variableName}\\s+\\*?Package`).test(fullText);

                if (isPackageType) {
                    return {
                        suggestions: [
                            {
                                label: "ID",
                                kind: monaco.languages.CompletionItemKind.Field,
                                detail: "int",
                                documentation: "The unique identifier of the package.",
                                insertText: "ID",
                                range,
                            },
                            {
                                label: "ProcessingTime",
                                kind: monaco.languages.CompletionItemKind.Field,
                                detail: "int",
                                documentation: "The time (in ms) it takes to process this package.",
                                insertText: "ProcessingTime",
                                range,
                            },
                        ],
                    };
                }
                return { suggestions: [] };
            }

            // CASE B: General completions
            const suggestions: any[] = [
                {
                    label: "go func",
                    kind: monaco.languages.CompletionItemKind.Snippet,
                    documentation: "Create and execute a new goroutine",
                    insertText: "go func($1) {\n\t$0\n}($2)",
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range,
                },
                {
                    label: "Unload",
                    kind: monaco.languages.CompletionItemKind.Function,
                    documentation: "Unloads the next package from the intake belt.",
                    detail: "func() (*Package, error)",
                    insertText: "Unload()",
                    range,
                },
                {
                    label: "PushToProcessingLine",
                    kind: monaco.languages.CompletionItemKind.Function,
                    documentation: "Pushes a package onto a processing line queue (0, 1, or 2).",
                    detail: "func(packageId int, processingLineId int) error",
                    insertText: "PushToProcessingLine(${1:packageId}, ${2:lineId})",
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range,
                },
                {
                    label: "ProcessPackage",
                    kind: monaco.languages.CompletionItemKind.Function,
                    documentation: "Processes a package at the head of a processing line.",
                    detail: "func(packageId int, processingLineId int) error",
                    insertText: "ProcessPackage(${1:packageId}, ${2:lineId})",
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range,
                },
                {
                    label: "Print",
                    kind: monaco.languages.CompletionItemKind.Function,
                    documentation: "Prints a label for a processed package and returns the assigned shipping lane.",
                    detail: "func(packageId int, processingLineId int) (string, error)",
                    insertText: "Print(${1:packageId}, ${2:lineId})",
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range,
                },
                {
                    label: "Ship",
                    kind: monaco.languages.CompletionItemKind.Function,
                    documentation: "Enqueues a package into the specified shipping lane.",
                    detail: "func(packageId int, shippingLine string) error",
                    insertText: "Ship(${1:packageId}, ${2:lane})",
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range,
                },
                {
                    label: "GetShippingLineQueueLength",
                    kind: monaco.languages.CompletionItemKind.Function,
                    documentation: "Returns the current queue length for the requested ShippingLine.",
                    detail: "func(shippingLine string) int",
                    insertText: "GetShippingLineQueueLength(${1:lane})",
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range,
                },
                {
                    label: "sync.WaitGroup",
                    kind: monaco.languages.CompletionItemKind.Struct,
                    documentation: "A WaitGroup waits for a collection of goroutines to finish.",
                    insertText: "var wg sync.WaitGroup",
                    range,
                },
            ];

            return { suggestions };
        },
    });
}
