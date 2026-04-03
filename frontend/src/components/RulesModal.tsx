import { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import Modal from "./Modal";

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

    const footer = (
        <div className="text-[10px] text-zinc-500 flex justify-start items-center font-bold uppercase tracking-wider">
            <span>Click outside to close</span>
        </div>
    );

    return (
        <Modal
            open={open}
            onClose={onClose}
            title="Warehouse Rules"
            description="Guidelines for high-performance concurrency"
            icon={<BookOpen className="text-blue-400" size={24} />}
            footer={footer}
            maxWidth="max-w-3xl"
        >
            <div className="p-4 pt-0 prose prose-invert text-sm max-w-none">
                {content ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                        {content}
                    </ReactMarkdown>
                ) : (
                    <div className="text-zinc-400 italic">Loading rules…</div>
                )}
            </div>
        </Modal>
    );
}
