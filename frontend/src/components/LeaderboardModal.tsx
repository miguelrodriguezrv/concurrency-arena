import { Trophy, Clock, Timer } from "lucide-react";
import { useStore } from "@/store";
import Modal from "./Modal";

interface LeaderboardModalProps {
    open: boolean;
    onClose: () => void;
}

export default function LeaderboardModal({
    open,
    onClose,
}: LeaderboardModalProps) {
    const leaderboard = useStore((state) => state.leaderboard);

    const formatTime = (ts: number) => {
        return new Date(ts).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
    };

    const formatDuration = (ms?: number) => {
        if (!ms) return "N/A";
        const seconds = ms / 1000;
        return `${seconds.toFixed(1)}s`;
    };

    const getLangLabel = (lang: string) => {
        if (lang === "javascript") return "JS";
        if (lang === "go") return "Go";
        if (lang === "python") return "Py";
        return lang;
    };

    const footer = (
        <div className="text-[10px] text-zinc-500 flex justify-start items-center font-bold uppercase tracking-wider">
            <span>Click outside to close</span>
        </div>
    );

    return (
        <Modal
            open={open}
            onClose={onClose}
            title="Arena Leaderboard"
            description="Top throughput performers (Live Session)"
            icon={<Trophy className="text-yellow-500" size={24} />}
            footer={footer}
            maxWidth="max-w-3xl"
        >
            <div className="flex-1">
                {leaderboard.length === 0 ? (
                    <div className="p-12 flex flex-col items-center justify-center text-zinc-600 italic">
                        <Trophy size={48} className="mb-4 opacity-10" />
                        <p>No scores submitted yet this session.</p>
                        <p className="text-xs mt-1">
                            Complete a run to be the first!
                        </p>
                    </div>
                ) : (
                    <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 bg-zinc-900 shadow-sm z-10">
                            <tr className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold border-b border-zinc-800">
                                <th className="px-6 py-3 font-bold w-16 text-center">
                                    Rank
                                </th>
                                <th className="px-4 py-3 font-bold">Student</th>
                                <th className="px-4 py-3 font-bold text-center">
                                    Lang
                                </th>
                                <th className="px-4 py-3 font-bold text-center">
                                    Duration
                                </th>
                                <th className="px-4 py-3 font-bold text-right">
                                    Throughput
                                </th>
                                <th className="px-6 py-3 font-bold text-right">
                                    Time
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/50">
                            {leaderboard.map((entry, idx) => (
                                <tr
                                    key={`${entry.userName}-${entry.timestamp}`}
                                    className="hover:bg-zinc-800/30 transition-colors group"
                                >
                                    <td className="px-6 py-4">
                                        <div className="flex items-center justify-center">
                                            <div
                                                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
                                                ${
                                                    idx === 0
                                                        ? "bg-yellow-500/10 text-yellow-500 border border-yellow-500/20"
                                                        : idx === 1
                                                          ? "bg-zinc-300/10 text-zinc-300 border border-zinc-300/20"
                                                          : idx === 2
                                                            ? "bg-orange-500/10 text-orange-500 border border-orange-500/20"
                                                            : "bg-zinc-800 text-zinc-500"
                                                }
                                            `}
                                            >
                                                {idx + 1}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-4">
                                        <span className="text-sm font-semibold text-zinc-200">
                                            {entry.userName}
                                        </span>
                                    </td>
                                    <td className="px-4 py-4 text-center">
                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-zinc-800 text-zinc-400 border border-zinc-700">
                                            {getLangLabel(entry.language)}
                                        </span>
                                    </td>
                                    <td className="px-4 py-4 text-center">
                                        <div className="flex items-center justify-center gap-1 text-zinc-400">
                                            <Timer
                                                size={12}
                                                className="text-zinc-500"
                                            />
                                            <span className="text-sm font-medium">
                                                {formatDuration(entry.duration)}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-4 text-right">
                                        <div className="flex flex-col items-end">
                                            <span className="text-sm font-black text-emerald-400">
                                                {entry.upm.toFixed(1)}
                                            </span>
                                            <span className="text-[10px] text-zinc-500 font-bold uppercase">
                                                Pkg/Min
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex items-center justify-end gap-1 text-zinc-500">
                                            <span className="text-[11px] font-medium">
                                                {formatTime(entry.timestamp)}
                                            </span>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </Modal>
    );
}
