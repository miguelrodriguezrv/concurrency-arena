import {
    TerminalSquare,
    Wifi,
    WifiOff,
    Code2,
    Play,
    Square,
    LogOut,
    RotateCcw,
    Sun,
    Moon,
    PanelRightOpen,
    PanelRightClose,
    BookOpen,
} from "lucide-react";
import RulesModal from "@/components/RulesModal";
import type { SupportedLanguage, RunnerState } from "@/hooks/useCodeRunner";
import { useStore } from "@/store";
import { useState } from "react";

interface ArenaHeaderProps {
    name: string;
    status: "disconnected" | "connecting" | "connected";
    language: SupportedLanguage;
    onLanguageChange: (lang: SupportedLanguage) => void;
    runnerState: RunnerState;
    onRun: () => void;
    onReset: () => void;
    onLogout: () => void;
    onToggleVisualizer: () => void;
    visualizerHidden: boolean;
}

export default function ArenaHeader({
    name,
    status,
    language,
    onLanguageChange,
    runnerState,
    onRun,
    onReset,
    onLogout,
    onToggleVisualizer,
    visualizerHidden,
}: ArenaHeaderProps) {
    const isRunning = runnerState.status === "running";

    // Use global store for theme
    const theme = useStore((s) => s.theme);
    const setTheme = useStore((s) => s.setTheme);

    const handleToggleTheme = () => {
        const next = theme === "vs-dark" ? "vs" : "vs-dark";
        setTheme(next);
    };

    const [rulesOpen, setRulesOpen] = useState(false);

    const openRules = () => setRulesOpen(true);
    const closeRules = () => setRulesOpen(false);

    return (
        <header className="h-14 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between px-4 lg:px-6 z-10 shrink-0">
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                    <TerminalSquare className="text-blue-400" size={20} />
                    <h1 className="font-semibold text-sm tracking-wide text-zinc-100 hidden sm:block font-sans">
                        Concurrency Arena
                    </h1>
                </div>

                <div className="h-4 w-px bg-zinc-800 hidden sm:block"></div>

                <div className="flex items-center gap-2 bg-zinc-900 py-1 px-2.5 rounded-md border border-zinc-800">
                    <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                    <span className="text-xs font-medium text-zinc-300 font-sans">
                        {name}
                    </span>
                </div>

                <div className="flex items-center gap-4">
                    <div title={`${status}`}>
                        {status === "connected" ? (
                            <Wifi size={16} className="text-emerald-500" />
                        ) : (
                            <WifiOff size={16} className="text-rose-500" />
                        )}
                    </div>

                    {/* Visualizer toggle moved into header (right of status icon) */}
                    <button
                        onClick={onToggleVisualizer}
                        className="p-1 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-800"
                        title={
                            visualizerHidden
                                ? "Show Visualizer"
                                : "Hide Visualizer"
                        }
                        aria-pressed={visualizerHidden}
                    >
                        {visualizerHidden ? (
                            <PanelRightClose
                                size={20}
                                className="text-zinc-300"
                            />
                        ) : (
                            <PanelRightOpen
                                size={20}
                                className="text-zinc-300"
                            />
                        )}
                    </button>
                </div>
            </div>

            <div className="flex items-center gap-3">
                {/* Rules button */}
                <button
                    onClick={openRules}
                    className="flex items-center gap-2 px-3 py-1 rounded-md bg-zinc-900 border border-zinc-800 hover:bg-zinc-800"
                    title="Rules"
                >
                    <BookOpen size={16} className="text-zinc-300" />
                    <span className="text-sm text-zinc-300 hidden sm:inline font-sans">Rules</span>
                </button>
                {/* Language Selector */}
                <div className="relative flex items-center bg-zinc-900 border border-zinc-800 rounded-md overflow-hidden hover:border-zinc-700 transition-colors">
                    <div className="pl-3 text-zinc-500">
                        <Code2 size={16} className="text-indigo-400" />
                    </div>
                    <select
                        value={language}
                        onChange={(e) =>
                            onLanguageChange(
                                e.target.value as SupportedLanguage,
                            )
                        }
                        className="bg-transparent text-sm font-medium text-zinc-300 py-1.5 pl-2 pr-8 appearance-none focus:outline-none cursor-pointer font-sans"
                    >
                        <option value="javascript">JavaScript (Workers)</option>
                        <option value="go">Go (WASM)</option>
                        <option value="python">Python (Pyodide)</option>
                    </select>
                </div>

                {/* Theme toggle (single icon) */}
                <div className="flex items-center">
                    <button
                        onClick={handleToggleTheme}
                        className="p-2 rounded-md bg-zinc-900 border border-zinc-800 hover:bg-zinc-800"
                        title="Toggle theme"
                    >
                        {theme === "vs-dark" ? (
                            <Moon size={16} className="text-zinc-200" />
                        ) : (
                            <Sun size={16} className="text-zinc-200" />
                        )}
                    </button>
                </div>

                {/* Local Run Button */}
                <button
                    onClick={onRun}
                    className={`flex items-center gap-2 ${
                        isRunning
                            ? "bg-rose-600 hover:bg-rose-500 border-rose-600"
                            : "bg-blue-600 hover:bg-blue-500 border-blue-600"
                    } text-white py-1.5 px-4 rounded-md text-sm font-medium transition-colors border font-sans`}
                >
                    {isRunning ? (
                        <>
                            <Square size={14} fill="currentColor" />
                            <span>Stop</span>
                        </>
                    ) : (
                        <>
                            <Play size={14} fill="currentColor" />
                            <span>Run Local</span>
                        </>
                    )}
                </button>

                {/* Reset Button */}
                <button
                    onClick={() => {
                        if (
                            confirm(
                                "Reset code to default? This will overwrite your current progress.",
                            )
                        ) {
                            onReset();
                        }
                    }}
                    className="flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 p-2 rounded-md transition-colors border border-zinc-700"
                    title="Reset to Default"
                >
                    <RotateCcw size={16} />
                </button>

                {/* Leave Button */}
                <button
                    onClick={onLogout}
                    className="flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 p-2 rounded-md transition-colors border border-zinc-700 ml-2"
                    title="Leave Arena"
                >
                    <LogOut size={16} />
                </button>
            </div>
            <RulesModal open={rulesOpen} onClose={closeRules} />
        </header>
    );
}
