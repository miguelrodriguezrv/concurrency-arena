import { Editor, type EditorProps, loader } from "@monaco-editor/react";

/**
 * High-quality Autocomplete Fallbacks.
 * This provides immediate and reliable suggestions for Go and Python
 * without the complexity of full browser-side LSP clients.
 */
loader.init().then((monaco) => {
    // --- Go Completion Provider ---
    monaco.languages.registerCompletionItemProvider("go", {
        // Use `any` here because the Monaco types are provided at runtime by the loader and
        // some environments in the test harness / build may not have the `monaco` namespace
        // available at type-check time. This keeps the completion provider simple and avoids
        // TS/ESLint failures in the repo while preserving runtime behavior.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        provideCompletionItems: (model: any, position: any) => {
            const word = model.getWordUntilPosition(position);
            const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn,
            };

            const suggestions = [
                {
                    label: "API_ProcessTask",
                    kind: monaco.languages.CompletionItemKind.Function,
                    documentation: {
                        value: "Simulates a concurrent task with I/O delay (50ms) and updates metrics (throughput/concurrency) in the UI.\n\n```go\nAPI_ProcessTask(id)\n```",
                    },
                    detail: "func(id interface{})",
                    insertText: "API_ProcessTask(${1:id})",
                    insertTextRules:
                        monaco.languages.CompletionItemInsertTextRule
                            .InsertAsSnippet,
                    range,
                },
                {
                    label: "go func",
                    kind: monaco.languages.CompletionItemKind.Snippet,
                    documentation: "Create and execute a new goroutine",
                    insertText: "go func($1) {\n\t$0\n}($2)",
                    insertTextRules:
                        monaco.languages.CompletionItemInsertTextRule
                            .InsertAsSnippet,
                    range,
                },
                {
                    label: "sync.WaitGroup",
                    kind: monaco.languages.CompletionItemKind.Struct,
                    documentation:
                        "A WaitGroup waits for a collection of goroutines to finish.",
                    insertText: "var wg sync.WaitGroup",
                    range,
                },
            ];

            return { suggestions };
        },
    });

    // --- Python Completion Provider ---
    monaco.languages.registerCompletionItemProvider("python", {
        // See note above for Go provider: relax types to `any` to avoid build-time type issues
        // while preserving runtime completion behavior. The lint disable is scoped to this line.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        provideCompletionItems: (model: any, position: any) => {
            const word = model.getWordUntilPosition(position);
            const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn,
            };

            const suggestions = [
                {
                    label: "API.process_task",
                    kind: monaco.languages.CompletionItemKind.Method,
                    documentation: {
                        value: "Simulates a concurrent task with I/O delay (50ms) and updates metrics in the UI.\n\n```python\nawait API.process_task(id)\n```",
                    },
                    detail: "coroutine process_task(id)",
                    insertText: "await API.process_task(${1:id})",
                    insertTextRules:
                        monaco.languages.CompletionItemInsertTextRule
                            .InsertAsSnippet,
                    range,
                },
                {
                    label: "import arena",
                    kind: monaco.languages.CompletionItemKind.Snippet,
                    documentation: "Import the Arena API bridge",
                    insertText: "from arena import API",
                    range,
                },
                {
                    label: "async def",
                    kind: monaco.languages.CompletionItemKind.Snippet,
                    documentation: "Define an asynchronous function",
                    insertText: "async def ${1:main}():\n\t$0",
                    insertTextRules:
                        monaco.languages.CompletionItemInsertTextRule
                            .InsertAsSnippet,
                    range,
                },
                {
                    label: "asyncio.gather",
                    kind: monaco.languages.CompletionItemKind.Function,
                    documentation:
                        "Run awaitable objects in the sequence concurrently.",
                    insertText: "await asyncio.gather(*${1:tasks})",
                    insertTextRules:
                        monaco.languages.CompletionItemInsertTextRule
                            .InsertAsSnippet,
                    range,
                },
                {
                    label: "asyncio.run",
                    kind: monaco.languages.CompletionItemKind.Function,
                    documentation:
                        "Execute the coroutine and return the result.",
                    insertText: "asyncio.run(${1:main()})",
                    insertTextRules:
                        monaco.languages.CompletionItemInsertTextRule
                            .InsertAsSnippet,
                    range,
                },
            ];

            return { suggestions };
        },
    });
});

interface CodeEditorProps {
    code: string;
    language: string;
    onChange: (value: string | undefined) => void;
    readOnly?: boolean;
    // Optional Monaco theme name (e.g. "vs-dark" or "vs")
    theme?: string;
}

export default function CodeEditor({
    code,
    language,
    onChange,
    readOnly = false,
    theme = "vs-dark",
}: CodeEditorProps) {
    const editorOptions: EditorProps["options"] = {
        minimap: { enabled: false },
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        padding: { top: 20 },
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        cursorBlinking: "smooth",
        cursorSmoothCaretAnimation: "on",
        formatOnPaste: true,
        readOnly,
        tabSize: language === "go" ? 4 : 2,
        insertSpaces: language !== "go",
        automaticLayout: true,
        wordWrap: "on",
        suggest: {
            preview: true,
            showClasses: true,
            showFunctions: true,
            showWords: true,
            showMethods: true,
            showSnippets: true,
        },
    };

    return (
        <div className="flex-1 flex flex-col bg-[#1e1e1e] relative w-full h-full">
            <Editor
                height="100%"
                theme={theme}
                language={language}
                value={code}
                onChange={onChange}
                options={editorOptions}
            />
        </div>
    );
}
