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
    // Case C: Register Go Hover Provider
    monaco.languages.registerHoverProvider("go", {
        provideHover: (model, position) => {
            const word = model.getWordAtPosition(position);
            if (!word) return null;

            const hoverData: Record<string, { detail: string, documentation: string }> = {
                "Unload": {
                    detail: "func() (*Package, error)",
                    documentation: "Unloads the next package from the intake belt. It blocks if no package is available."
                },
                "PushToProcessingLine": {
                    detail: "func(packageId int, processingLineId int) error",
                    documentation: "Pushes a package onto a processing line queue (0, 1, or 2). Returns an error if the line is full."
                },
                "ProcessPackage": {
                    detail: "func(packageId int, processingLineId int) error",
                    documentation: "Processes a package at the head of a processing line. This operation is CPU-bound (simulated)."
                },
                "Print": {
                    detail: "func(packageId int, processingLineId int) (string, error)",
                    documentation: "Prints a label for a processed package and returns the assigned shipping lane ('laneA' or 'laneB')."
                },
                "Ship": {
                    detail: "func(packageId int, shippingLine string) error",
                    documentation: "Enqueues a package into the specified shipping lane. Errors if the lane doesn't exist."
                },
                "GetShippingLineQueueLength": {
                    detail: "func(shippingLine string) int",
                    documentation: "Returns the current number of packages waiting in the requested ShippingLine."
                },
                "Package": {
                    detail: "type Package struct",
                    documentation: "Represents a warehouse package with an ID and processing time requirements."
                },
                "ID": {
                    detail: "int (field)",
                    documentation: "Unique identifier for the package."
                },
                "ProcessingTime": {
                    detail: "int (field)",
                    documentation: "Duration in milliseconds required to process this package."
                }
            };

            const data = hoverData[word.word];
            if (data) {
                return {
                    range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
                    contents: [
                        { value: `\`\`\`go\n${data.detail}\n\`\`\`` },
                        { value: data.documentation }
                    ]
                };
            }
            return null;
        }
    });

    // Case D: Register Go Signature Help Provider
    monaco.languages.registerSignatureHelpProvider("go", {
        signatureHelpTriggerCharacters: ["(", ","],
        provideSignatureHelp: (model, position) => {
            const lineContent = model.getLineContent(position.lineNumber);
            const textUntilPosition = lineContent.substring(0, position.column - 1);
            
            // Very simple regex to find the function name being called
            const matches = textUntilPosition.match(/(\w+)\s*\([^()]*$/);
            if (!matches) return null;

            const funcName = matches[1];
            const signatures: Record<string, { label: string, parameters: { label: string }[] }> = {
                "PushToProcessingLine": {
                    label: "PushToProcessingLine(packageId int, processingLineId int) error",
                    parameters: [{ label: "packageId int" }, { label: "processingLineId int" }]
                },
                "ProcessPackage": {
                    label: "ProcessPackage(packageId int, processingLineId int) error",
                    parameters: [{ label: "packageId int" }, { label: "processingLineId int" }]
                },
                "Print": {
                    label: "Print(packageId int, processingLineId int) (string, error)",
                    parameters: [{ label: "packageId int" }, { label: "processingLineId int" }]
                },
                "Ship": {
                    label: "Ship(packageId int, shippingLine string) error",
                    parameters: [{ label: "packageId int" }, { label: "lane string" }]
                },
                "GetShippingLineQueueLength": {
                    label: "GetShippingLineQueueLength(shippingLine string) int",
                    parameters: [{ label: "lane string" }]
                }
            };

            const sig = signatures[funcName];
            if (!sig) return null;

            // Calculate active parameter by counting commas
            const paramPart = textUntilPosition.substring(textUntilPosition.lastIndexOf("(") + 1);
            const activeParameter = (paramPart.match(/,/g) || []).length;

            return {
                value: {
                    signatures: [{
                        label: sig.label,
                        parameters: sig.parameters,
                        activeParameter: activeParameter
                    }],
                    activeSignature: 0,
                    activeParameter: activeParameter
                },
                dispose: () => {}
            };
        }
    });
}
