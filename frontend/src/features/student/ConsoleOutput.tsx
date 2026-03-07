import { useEffect, useRef, useState } from "react";
import { Terminal } from "lucide-react";
import type { RunnerState } from "@/hooks/useCodeRunner";

interface ConsoleOutputProps {
    runnerState: RunnerState;
}

export default function ConsoleOutput({ runnerState }: ConsoleOutputProps) {
    const consoleRef = useRef<HTMLDivElement | null>(null);
    const endRef = useRef<HTMLDivElement | null>(null);
    const isProgrammaticScrollRef = useRef(false);

    const [autoScroll, setAutoScroll] = useState(true);
    const [userScrolledUp, setUserScrolledUp] = useState(false);

    // Keep the console pinned to the bottom when autoScroll is enabled.
    useEffect(() => {
        const el = consoleRef.current;
        if (!el) return;
        if (!autoScroll) return;

        isProgrammaticScrollRef.current = true;
        // schedule after render so content is present
        requestAnimationFrame(() => {
            const end = endRef.current;
            if (end && typeof end.scrollIntoView === "function") {
                end.scrollIntoView({ block: "end", behavior: "auto" });
            } else {
                el.scrollTop = el.scrollHeight;
            }
            // clear the programmatic flag on the next frame
            requestAnimationFrame(() => {
                isProgrammaticScrollRef.current = false;
            });
        });
    }, [runnerState.output.length, runnerState.error, autoScroll]);

    return (
        <div className="h-full min-h-0 flex flex-col bg-zinc-950 text-zinc-100 font-sans border-l border-zinc-800">
            {/* Header */}
            <div className="p-3 border-b border-zinc-800 flex items-center justify-between bg-zinc-900 shrink-0">
                <div className="flex items-center gap-2">
                    <Terminal size={16} className="text-zinc-500" />
                    <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                        CONSOLE OUTPUT
                    </h3>
                </div>
                <div className="text-[10px] font-bold text-zinc-500 uppercase">
                    {runnerState.status}
                </div>
            </div>

            {/* Scrollable console area */}
            <div
                ref={consoleRef}
                role="log"
                aria-live="polite"
                tabIndex={0}
                onScroll={(e) => {
                    if (isProgrammaticScrollRef.current) return;
                    const el = e.currentTarget as HTMLDivElement;
                    const distanceFromBottom =
                        el.scrollHeight - (el.scrollTop + el.clientHeight);
                    const atBottom = distanceFromBottom < 24;
                    setAutoScroll(atBottom);
                    setUserScrolledUp(!atBottom);
                }}
                // ensure this flex child can shrink so it scrolls internally
                className="flex-1 overflow-y-scroll overflow-x-hidden p-3 pb-4 text-xs font-mono text-zinc-300 whitespace-pre-wrap text-left w-full min-h-0 scrollbar-thin scrollbar-thumb-zinc-700 relative"
            >
                {runnerState.output.length === 0 && !runnerState.error ? (
                    <pre className="text-zinc-600 italic p-0 m-0 whitespace-pre-wrap wrap-break-word">
                        No output...
                    </pre>
                ) : (
                    <div className="flex flex-col gap-0">
                        {runnerState.output.map((line, i) => (
                            <pre
                                key={i}
                                className={`p-0 m-0 whitespace-pre-wrap wrap-break-word max-w-full ${
                                    line.startsWith("ERROR:")
                                        ? "text-rose-400 font-bold"
                                        : "text-zinc-300"
                                }`}
                            >
                                {line}
                            </pre>
                        ))}
                        {runnerState.error && (
                            <pre className="p-0 m-0 whitespace-pre-wrap wrap-break-word max-w-full text-rose-500 font-bold">
                                {runnerState.error}
                            </pre>
                        )}
                    </div>
                )}

                {/* Sentinel to scroll to */}
                <div ref={endRef} />

                {/* Jump-to-latest button */}
                {userScrolledUp && (
                    <div className="absolute right-3 bottom-3 z-10">
                        <button
                            onClick={() => {
                                setAutoScroll(true);
                                isProgrammaticScrollRef.current = true;
                                const el = consoleRef.current;
                                if (el) el.scrollTop = el.scrollHeight;
                                setTimeout(() => {
                                    isProgrammaticScrollRef.current = false;
                                }, 120);
                            }}
                            className="bg-zinc-800/80 text-zinc-200 px-2 py-1 rounded text-xs border border-zinc-700 hover:bg-zinc-700/90"
                        >
                            Jump to latest
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
