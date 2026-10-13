import { useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import Modal from "./Modal";

export type RulesLanguage = "javascript" | "python" | "go";

interface RulesModalProps {
    open: boolean;
    onClose: () => void;
    /** Language selected in the editor; the modal opens on this tab. */
    language: RulesLanguage;
}

const TABS: { id: RulesLanguage; label: string; tag: string }[] = [
    { id: "javascript", label: "JavaScript", tag: "js" },
    { id: "python", label: "Python", tag: "python" },
    { id: "go", label: "Go", tag: "go" },
];

/** Per-language replacements for {{placeholders}} in RULES.md. */
const VOCAB: Record<RulesLanguage, Record<string, string>> = {
    javascript: {
        "c.unload": "`const pkg = await warehouse.unload()`",
        "c.push": "`await warehouse.pushToProcessingLine(id, line)`",
        "c.process": "`await warehouse.processPackage(id, line)`",
        "c.print": "`const lane = await warehouse.print(id, line)`",
        "c.ship": "`await warehouse.ship(id, lane)`",
        "n.unload": "`unload()`",
        "n.push": "`pushToProcessingLine()`",
        "n.process": "`processPackage()`",
        "n.print": "`print()`",
        "n.ship": "`ship()`",
        "n.queueLength": "`getShippingLaneQueueLength(lane)`",
        "n.processingTime": "`processingTime`",
        null: "`null`",
        rejects: "**throws an error**",
        sleep: "`setTimeout`",
    },
    python: {
        "c.unload": "`pkg = await w.unload()`",
        "c.push": "`await w.pushToProcessingLine(id, line)`",
        "c.process": "`await w.processPackage(id, line)`",
        "c.print": "`lane = await w.print(id, line)`",
        "c.ship": "`await w.ship(id, lane)`",
        "n.unload": "`unload()`",
        "n.push": "`pushToProcessingLine()`",
        "n.process": "`processPackage()`",
        "n.print": "`print()`",
        "n.ship": "`ship()`",
        "n.queueLength": "`getShippingLaneQueueLength(lane)`",
        "n.processingTime": "`processingTime`",
        null: "`None`",
        rejects: "**raises an exception**",
        sleep: "`asyncio.sleep`",
    },
    go: {
        "c.unload": "`pkg, err := w.Unload()`",
        "c.push": "`err := w.PushToProcessingLine(id, line)`",
        "c.process": "`err := w.ProcessPackage(id, line)`",
        "c.print": "`lane, err := w.Print(id, line)`",
        "c.ship": "`err := w.Ship(id, lane)`",
        "n.unload": "`Unload()`",
        "n.push": "`PushToProcessingLine()`",
        "n.process": "`ProcessPackage()`",
        "n.print": "`Print()`",
        "n.ship": "`Ship()`",
        "n.queueLength": "`GetShippingLaneQueueLength(lane)`",
        "n.processingTime": "`ProcessingTime`",
        null: "`nil`",
        rejects: "**returns an error**",
        sleep: "`time.Sleep`",
    },
};

interface Section {
    title?: string; // collapsible when set
    body: string;
}

/** Turn the shared RULES.md into the sections for one language. */
function renderRules(source: string, lang: RulesLanguage): Section[] {
    const tag = TABS.find((t) => t.id === lang)!.tag;
    const vocab = VOCAB[lang];

    const text = source
        // keep only this language's blocks
        .replace(
            /<!--\s*lang:(\w+)\s*-->([\s\S]*?)<!--\s*\/lang\s*-->/g,
            (_, l: string, body: string) => (l === tag ? body : ""),
        )
        // fill in placeholders
        .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, key: string) => vocab[key] ?? m);

    // split into plain and collapsible sections
    const sections: Section[] = [];
    const re = /<!--\s*details:\s*(.*?)\s*-->([\s\S]*?)<!--\s*\/details\s*-->/g;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
        sections.push({ body: text.slice(last, match.index) });
        sections.push({ title: match[1], body: match[2] });
        last = re.lastIndex;
    }
    sections.push({ body: text.slice(last) });

    // drop any remaining comments (file header) and empty sections
    return sections
        .map((s) => ({ ...s, body: s.body.replace(/<!--[\s\S]*?-->/g, "").trim() }))
        .filter((s) => s.body.length > 0);
}

const mdComponents: Components = {
    h1: ({ ...props }) => <h1 className="text-xl font-bold text-zinc-100 mt-4 mb-2" {...props} />,
    h2: ({ ...props }) => <h2 className="text-lg font-semibold text-zinc-100 mt-4 mb-2" {...props} />,
    h3: ({ ...props }) => (
        <h3 className="text-[15px] font-semibold text-zinc-100 mt-5 mb-2 first:mt-0" {...props} />
    ),
    p: ({ ...props }) => <p className="text-zinc-300 leading-relaxed mb-3" {...props} />,
    ul: ({ ...props }) => <ul className="list-disc pl-5 mb-3 space-y-1 text-zinc-300" {...props} />,
    ol: ({ ...props }) => <ol className="list-decimal pl-5 mb-3 space-y-1 text-zinc-300" {...props} />,
    li: ({ ...props }) => <li className="leading-relaxed" {...props} />,
    a: ({ ...props }) => <a className="text-sky-400 hover:underline" {...props} />,
    pre: ({ children }) => (
        <pre className="bg-zinc-950 border border-zinc-800 rounded-md p-3 mb-3 overflow-x-auto text-xs leading-relaxed text-zinc-200">
            {children}
        </pre>
    ),
    code: ({ className, children }) => {
        // Fenced blocks get a language-* class (or contain newlines)
        const text = Array.isArray(children) ? children.join("") : String(children);
        if (className || text.includes("\n")) {
            return <code className="font-mono">{text.replace(/\n$/, "")}</code>;
        }
        return (
            <code className="bg-zinc-800 text-zinc-100 px-1 py-px rounded text-[12px] font-mono whitespace-nowrap">
                {text}
            </code>
        );
    },
    table: ({ ...props }) => (
        <div className="overflow-x-auto mb-3">
            <table className="w-full text-left text-[13px] border-collapse" {...props} />
        </div>
    ),
    th: ({ ...props }) => (
        <th
            className="border-b border-zinc-700 py-1.5 pr-4 text-zinc-500 font-semibold text-[11px] uppercase tracking-wide"
            {...props}
        />
    ),
    td: ({ ...props }) => (
        <td className="border-b border-zinc-800 py-1.5 pr-4 text-zinc-300 align-top" {...props} />
    ),
    strong: ({ ...props }) => <strong className="text-zinc-50 font-semibold" {...props} />,
};

function Markdown({ children }: { children: string }) {
    return (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {children}
        </ReactMarkdown>
    );
}

export default function RulesModal({ open, onClose, language }: RulesModalProps) {
    const [source, setSource] = useState<string | null>(null);
    // null = follow the editor's language; reset on close so the modal
    // always opens on the language you're coding in.
    const [picked, setPicked] = useState<RulesLanguage | null>(null);
    const tab = picked ?? language;
    const setTab = setPicked;
    const handleClose = () => {
        setPicked(null);
        onClose();
    };

    useEffect(() => {
        if (!open || source) return;
        let mounted = true;
        fetch("/RULES.md")
            .then((r) => r.text())
            .then((t) => mounted && setSource(t))
            .catch(() => mounted && setSource("Failed to load rules."));
        return () => {
            mounted = false;
        };
    }, [open, source]);

    const sections = useMemo(() => (source ? renderRules(source, tab) : []), [source, tab]);

    const footer = (
        <div className="text-[10px] text-zinc-500 flex justify-start items-center font-bold uppercase tracking-wider">
            <span>Esc or click outside to close</span>
        </div>
    );

    return (
        <Modal
            open={open}
            onClose={handleClose}
            title="How to play"
            description="The Warehouse Challenge"
            icon={<BookOpen className="text-blue-400" size={24} />}
            footer={footer}
            maxWidth="max-w-3xl"
            maxHeight="max-h-[92vh]"
        >
            {/* Language tabs */}
            <div className="sticky top-0 z-10 bg-zinc-900 px-5 pt-3 border-b border-zinc-800 flex gap-1">
                {TABS.map((t) => (
                    <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        className={`px-3 py-1.5 text-sm font-medium rounded-t-md border-b-2 -mb-px transition-colors ${
                            tab === t.id
                                ? "border-blue-500 text-zinc-100"
                                : "border-transparent text-zinc-500 hover:text-zinc-300"
                        }`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            <div className="px-5 py-4 text-sm">
                {!source && <div className="text-zinc-400 italic">Loading rules…</div>}
                {sections.map((s, i) =>
                    s.title ? (
                        <details
                            key={`details-${i}`}
                            className="group mb-3 rounded-lg border border-zinc-800 bg-zinc-900/40"
                        >
                            <summary className="flex items-center gap-2 cursor-pointer select-none px-4 py-2.5 text-zinc-200 font-medium hover:bg-zinc-800/40 rounded-lg list-none [&::-webkit-details-marker]:hidden">
                                <ChevronRight
                                    size={16}
                                    className="text-zinc-500 transition-transform group-open:rotate-90"
                                />
                                {s.title}
                            </summary>
                            <div className="px-4 pb-2 pt-1">
                                <Markdown>{s.body}</Markdown>
                            </div>
                        </details>
                    ) : (
                        <div key={`${tab}-${i}`} className="mb-4">
                            <Markdown>{s.body}</Markdown>
                        </div>
                    ),
                )}
            </div>
        </Modal>
    );
}
