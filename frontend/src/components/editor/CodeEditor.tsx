import { useEffect } from "react";
import { Editor, type EditorProps } from "@monaco-editor/react";
import { toast } from "react-hot-toast";

/* Monaco initialization moved to runtime via initMonaco() in "@/services/monaco/initMonaco".
   Initialization is invoked from the component lifecycle to avoid module-level side-effects. */

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
    useEffect(() => {
        let mounted = true;

        (async () => {
            try {
                const m = await import("@/services/monaco/initMonaco");
                if (!mounted) return;
                await m.initMonaco();
            } catch (err) {
                console.error("Monaco initialization failed:", err);
                toast.error("Editor autocomplete failed to load.");
            }
        })();

        return () => {
            mounted = false;
        };
    }, []);

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
