import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Trophy,
    CheckCircle2,
    AlertTriangle,
    XCircle,
    X,
    RotateCcw,
    Clock,
    Gauge,
    Package,
    Printer,
    Ban,
} from "lucide-react";
import type { RunOutcome } from "./useWarehouseMetrics";

export interface RunResultCardProps {
    open: boolean;
    outcome: RunOutcome;
    elapsedMs: number;
    upm: number;
    shipped: number;
    total: number;
    errors: number;
    printerEfficiency: number;
    stuck: number[];
    notUnloaded: number;
    message?: string;
    previousBest: number;
    speed: number;
    onClose: () => void;
    onRunAgain: () => void;
}

function Stat({
    icon,
    label,
    value,
    tone = "text-zinc-100",
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
    tone?: string;
}) {
    return (
        <div className="flex flex-col gap-1 rounded-lg bg-zinc-950/60 border border-zinc-800 px-3 py-2 min-w-0">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                {icon}
                {label}
            </div>
            <div className={`font-mono text-lg font-bold leading-none tabular-nums ${tone}`}>
                {value}
            </div>
        </div>
    );
}

const HEADINGS: Record<
    string,
    { title: string; icon: React.ReactNode; accent: string; ring: string }
> = {
    complete: {
        title: "All packages shipped!",
        icon: <CheckCircle2 className="text-emerald-400" size={22} />,
        accent: "text-emerald-400",
        ring: "border-emerald-500/40",
    },
    incomplete: {
        title: "Your code finished, but packages were left behind",
        icon: <AlertTriangle className="text-amber-400" size={22} />,
        accent: "text-amber-400",
        ring: "border-amber-500/40",
    },
    fatal: {
        title: "Warehouse shut down",
        icon: <Ban className="text-rose-400" size={22} />,
        accent: "text-rose-400",
        ring: "border-rose-500/40",
    },
    crashed: {
        title: "Your code crashed",
        icon: <XCircle className="text-rose-400" size={22} />,
        accent: "text-rose-400",
        ring: "border-rose-500/40",
    },
};

export default function RunResultCard(props: RunResultCardProps) {
    const {
        open,
        outcome,
        elapsedMs,
        upm,
        shipped,
        total,
        errors,
        printerEfficiency,
        stuck,
        notUnloaded,
        message,
        previousBest,
        speed,
        onClose,
        onRunAgain,
    } = props;

    const heading = HEADINGS[outcome];
    const show = open && !!heading;

    useEffect(() => {
        if (!show) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [show, onClose]);
    const isComplete = outcome === "complete";
    const newBest = isComplete && upm > previousBest;

    let detail: React.ReactNode = null;
    if (outcome === "incomplete") {
        const ids = stuck.slice(0, 24).join(", ");
        detail = (
            <>
                <ul className="list-disc pl-5 space-y-0.5">
                    {notUnloaded > 0 && (
                        <li>
                            <span className="text-zinc-200 font-semibold">{notUnloaded}</span>{" "}
                            still in the trucks (never unloaded)
                        </li>
                    )}
                    {stuck.length > 0 && (
                        <li>
                            <span className="text-zinc-200 font-semibold">{stuck.length}</span>{" "}
                            stuck inside the warehouse
                            {ids && (
                                <span className="block font-mono text-[11px] text-zinc-500 break-words">
                                    ids: {ids}
                                    {stuck.length > 24 ? ", …" : ""}
                                </span>
                            )}
                        </li>
                    )}
                </ul>
                <p className="mt-2">
                    Did a worker stop early, or did an error get swallowed?
                </p>
            </>
        );
    } else if (outcome === "fatal") {
        detail = (
            <p>
                Too many calls were rejected, so the warehouse stopped. Wait for
                resources instead of retrying in a tight loop.
            </p>
        );
    } else if (outcome === "crashed") {
        detail = (
            <>
                <p>An uncaught error ended the run.</p>
                {message && (
                    <p className="mt-1 font-mono text-[11px] text-rose-300/90 break-words line-clamp-3">
                        {message}
                    </p>
                )}
            </>
        );
    }

    return (
        <AnimatePresence>
            {show && (
                <motion.div
                    className="absolute inset-0 z-50 flex items-center justify-center bg-zinc-950/60 backdrop-blur-[2px] p-4"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={onClose}
                >
                    <motion.div
                        className={`relative w-full max-w-md rounded-xl border ${heading.ring} bg-zinc-900 shadow-2xl p-5`}
                        initial={{ scale: 0.92, y: 12 }}
                        animate={{ scale: 1, y: 0 }}
                        exit={{ scale: 0.95, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 260, damping: 22 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            onClick={onClose}
                            className="absolute top-3 right-3 text-zinc-500 hover:text-zinc-200"
                            aria-label="Close"
                        >
                            <X size={16} />
                        </button>

                        <div className="flex items-center gap-2 pr-6">
                            {heading.icon}
                            <h2 className={`text-base font-semibold ${heading.accent}`}>
                                {heading.title}
                            </h2>
                            {speed !== 1 && (
                                <span className="ml-1 shrink-0 rounded bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 text-[10px] font-mono text-zinc-400">
                                    {speed}× speed
                                </span>
                            )}
                        </div>

                        {newBest && (
                            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-amber-400/10 border border-amber-400/40 px-2.5 py-1 text-xs font-semibold text-amber-300">
                                <Trophy size={13} />
                                New personal best
                                {previousBest > 0 && (
                                    <span className="font-mono text-amber-200/70">
                                        (was {previousBest.toFixed(1)})
                                    </span>
                                )}
                            </div>
                        )}

                        <div className="mt-4 grid grid-cols-2 gap-2">
                            {isComplete ? (
                                <Stat
                                    icon={<Gauge size={11} />}
                                    label="Score (UPM)"
                                    value={upm.toFixed(1)}
                                    tone="text-indigo-300"
                                />
                            ) : (
                                <Stat
                                    icon={<Package size={11} />}
                                    label="Shipped"
                                    value={`${shipped}/${total}`}
                                    tone="text-amber-300"
                                />
                            )}
                            <Stat
                                icon={<Clock size={11} />}
                                label="Time"
                                value={`${(elapsedMs / 1000).toFixed(1)}s`}
                            />
                            <Stat
                                icon={<Printer size={11} />}
                                label="Printer efficiency"
                                value={printerEfficiency > 0 ? `${Math.round(printerEfficiency)}%` : "—"}
                            />
                            <Stat
                                icon={<AlertTriangle size={11} />}
                                label="Rejected calls"
                                value={String(errors)}
                                tone={errors > 0 ? "text-rose-300" : "text-zinc-100"}
                            />
                        </div>

                        {detail && (
                            <div className="mt-3 text-sm text-zinc-400 leading-relaxed">
                                {detail}
                            </div>
                        )}

                        {isComplete && (
                            <p className="mt-3 text-xs text-zinc-500">
                                Score = packages per minute of warehouse time, from the first
                                unload to the last package shipped (the same at any speed).
                                Printer efficiency is time printing vs. time travelling.
                            </p>
                        )}

                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                onClick={onClose}
                                className="px-3 py-1.5 rounded-md text-sm text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700"
                            >
                                Close
                            </button>
                            <button
                                onClick={onRunAgain}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-500"
                            >
                                <RotateCcw size={14} />
                                Run again
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
