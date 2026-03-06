import { useEffect } from "react";
import { DiffEditor } from "@monaco-editor/react";

type Props = {
    open: boolean;
    original: string;
    modified: string;
    language?: string;
    theme?: string;
    onAccept: () => void;
    onClose: () => void;
};

/**
 * IncomingDiffModal
 *
 * A lightweight modal that shows a Monaco DiffEditor to compare the current
 * editor contents (`original`) with an incoming version (`modified`).
 *
 * Props:
 *  - open: whether the modal is visible
 *  - original: current editor text
 *  - modified: incoming editor text to compare
 *  - language: optional monaco language (defaults to "javascript")
 *  - onAccept: called when the user accepts the incoming changes
 *  - onClose: called when the user rejects / closes the modal
 *
 * Notes:
 *  - The DiffEditor is read-only; Accept will call `onAccept` and the caller
 *    should then update the editor state and persist as desired.
 *  - The modal supports Escape to close.
 */
export default function IncomingDiffModal({
    open,
    original,
    modified,
    language = "javascript",
    theme = "vs-dark",
    onAccept,
    onClose,
}: Props) {
    useEffect(() => {
        if (!open) return;

        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
            }
        };

        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* overlay */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
                aria-hidden
            />

            {/* modal panel */}
            <div
                role="dialog"
                aria-modal="true"
                className="relative w-[95%] max-w-6xl h-[85vh] bg-zinc-900 border border-zinc-800 rounded-md shadow-lg overflow-hidden flex flex-col"
            >
                {/* header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900">
                    <div>
                        <h3 className="text-sm font-semibold text-zinc-100">
                            Incoming changes
                        </h3>
                        <p className="text-xs text-zinc-400">
                            Review the diff below and accept to replace your
                            current code.
                        </p>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={onClose}
                            className="px-3 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm transition-colors border border-zinc-700"
                        >
                            Reject
                        </button>

                        <button
                            onClick={onAccept}
                            className="px-3 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-sm transition-colors border border-transparent"
                        >
                            Accept
                        </button>
                    </div>
                </div>

                {/* diff editor */}
                <div className="flex-1">
                    <DiffEditor
                        height="100%"
                        language={language}
                        theme={theme}
                        original={original}
                        modified={modified}
                        options={{
                            renderSideBySide: true,
                            readOnly: true,
                            automaticLayout: true,
                            minimap: { enabled: false },
                            overviewRulerLanes: 0,
                        }}
                    />
                </div>

                {/* footer hint */}
                <div className="px-4 py-2 border-t border-zinc-800 bg-zinc-900 text-xs text-zinc-400">
                    <div>
                        Tip: press{" "}
                        <span className="px-1 mx-1 rounded bg-zinc-800 text-zinc-300">
                            Esc
                        </span>{" "}
                        to dismiss. Accept will replace your current editor
                        contents.
                    </div>
                </div>
            </div>
        </div>
    );
}
