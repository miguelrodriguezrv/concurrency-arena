import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

interface RulesModalProps {
    open: boolean;
    onClose: () => void;
}

export default function RulesModal({ open, onClose }: RulesModalProps) {
    const [content, setContent] = useState<string | null>(null);

    const mdComponents: Components = {
        h1: ({ ...props }) => (
            <h1 className="text-2xl font-bold text-zinc-100 mt-4 mb-2" {...props} />
        ),
        h2: ({ ...props }) => (
            <h2 className="text-xl font-semibold text-zinc-100 mt-3 mb-1" {...props} />
        ),
        h3: ({ ...props }) => (
            <h3 className="text-lg font-medium text-zinc-100 mt-2 mb-1" {...props} />
        ),
        p: ({ ...props }) => (
            <p className="text-zinc-200 leading-relaxed mb-2" {...props} />
        ),
        ul: ({ ...props }) => (
            <ul className="list-disc list-inside ml-4 mb-2" {...props} />
        ),
        ol: ({ ...props }) => (
            <ol className="list-decimal list-inside ml-4 mb-2" {...props} />
        ),
        li: ({ ...props }) => (
            <li className="mb-1" {...props} />
        ),
        a: ({ ...props }) => (
            <a className="text-sky-400 hover:underline" {...props} />
        ),
        code: ({ children }) => {
            const text = Array.isArray(children) ? children.join("") : String(children);
                return (
                    <code className="inline bg-zinc-800 px-1 rounded text-xs align-baseline whitespace-normal">
                        {text}
                    </code>
                );
        },
    };

    useEffect(() => {
        if (!open) return;
        let mounted = true;
        fetch("/RULES.md")
            .then((r) => r.text())
            .then((t) => {
                if (mounted) setContent(t);
            })
            .catch(() => {
                if (mounted) setContent("Failed to load rules.");
            });
        return () => {
            mounted = false;
        };
    }, [open]);

    if (!open) return null;

    const modal = (
        <div className="fixed inset-0 z-99999 flex items-center justify-center">
            <div
                className="absolute inset-0 bg-black/60"
                onClick={onClose}
                aria-hidden={true}
            />

            <div className="relative w-full max-w-3xl max-h-[80vh] bg-zinc-900 border border-zinc-800 rounded-lg p-4 overflow-auto">
                <button
                    onClick={onClose}
                    className="p-1 rounded-md bg-zinc-800 hover:bg-zinc-700 absolute top-3 right-3"
                    aria-label="Close Rules"
                >
                    <X size={18} />
                </button>

                <div className="prose prose-invert text-sm">
                    {content ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                            {content}
                        </ReactMarkdown>
                    ) : (
                        <div className="text-zinc-400">Loading rules…</div>
                    )}
                </div>
            </div>
        </div>
    );

    if (typeof document !== "undefined") {
        return createPortal(modal, document.body);
    }

    return modal;
}
