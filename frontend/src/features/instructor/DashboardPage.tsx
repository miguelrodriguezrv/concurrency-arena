import { useEffect, useState, useRef } from "react";
import { toast } from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { useStore } from "@/store";
import { useWebSocket } from "@/hooks/useWebSocket";
import CodeEditor from "@/components/editor/CodeEditor";
import {
    Users,
    Play,
    Send,
    Activity,
    MonitorPlay,
    LogOut,
    Code2,
    Wifi,
    WifiOff,
    RefreshCw,
} from "lucide-react";

export default function DashboardPage() {
    const navigate = useNavigate();
    const session = useStore((state) => state.session);
    const clearSession = useStore((state) => state.clearSession);

    const students = useStore((state) => state.students);
    const stagedStudentName = useStore((state) => state.stagedStudentName);
    const activeCodeOnStage = useStore((state) => state.activeCodeOnStage);
    const setStagedStudent = useStore((state) => state.setStagedStudent);
    const setActiveCodeOnStage = useStore(
        (state) => state.setActiveCodeOnStage,
    );

    const { status, sendMessage, subscribeToAdminCommands } = useWebSocket();

    const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
    const [isOutOfDate, setIsOutOfDate] = useState<boolean>(false);
    const [refreshing, setRefreshing] = useState<boolean>(false);
    const lastSyncedCodeRef = useRef<string | null>(null);

    // Protect route
    useEffect(() => {
        if (!session || session.role !== "Instructor") {
            navigate("/");
        }
    }, [session, navigate]);

    // Handle Admin Commands (e.g. Template Pushes to self)
    useEffect(() => {
        const unsubscribe = subscribeToAdminCommands((payload) => {
            if (payload.action === "PUSH_TEMPLATE" && payload.code) {
                setActiveCodeOnStage(payload.code);
            }
        });
        return () => {
            unsubscribe();
        };
    }, [subscribeToAdminCommands, setActiveCodeOnStage]);

    const handlePullToStage = (name: string) => {
        setStagedStudent(name);
        if (students[name]) {
            setActiveCodeOnStage(students[name].code);
            // record the last synced student code for this staged view
            lastSyncedCodeRef.current = students[name].code;
            // Defer local UI state updates to avoid synchronous setState inside event/effect flows
            setTimeout(() => setIsOutOfDate(false), 0);
        } else {
            lastSyncedCodeRef.current = null;
            setTimeout(() => setIsOutOfDate(false), 0);
        }
    };

    const handlePushTemplate = () => {
        if (!stagedStudentName) {
            toast.error(
                "Select a student to push the code to (stage someone first).",
            );
            return;
        }

        // Send targeted admin command to the server which will route it only to the target student
        const ok = sendMessage("ADMIN_COMMAND", {
            action: "PUSH_TEMPLATE",
            code: activeCodeOnStage,
            language: students[stagedStudentName]?.language || "javascript",
            target: stagedStudentName,
        });

        if (ok) {
            toast.success(`Template pushed to ${stagedStudentName}`);
        } else {
            toast.error("Failed to send PUSH_TEMPLATE (socket not connected).");
        }
    };

    const handleRunStaged = () => {
        // Stage 3/4 Implementation
        toast("Execution pipeline coming soon!");
    };

    const handleLogout = () => {
        clearSession();
        sessionStorage.clear();
        navigate("/");
    };

    const handleManualRefresh = () => {
        if (!stagedStudentName) return;
        // Prefer restoring the last-synced snapshot (the student's code when we last pulled).
        // If there's no last-synced snapshot available, fall back to the student's current store value.
        const latest =
            lastSyncedCodeRef.current ??
            (students[stagedStudentName]
                ? students[stagedStudentName].code
                : "") ??
            "";
        // Visual feedback: spin icon briefly
        setRefreshing(true);
        // stop spinning after a short animation interval
        setTimeout(() => setRefreshing(false), 600);
        // Restore the staged editor to the last-synced snapshot
        setActiveCodeOnStage(latest);
        lastSyncedCodeRef.current = latest;
        setIsOutOfDate(false);
    };

    useEffect(() => {
        if (!stagedStudentName) return;
        const student = students[stagedStudentName];
        if (!student) return;
        const latest = student.code || "";

        // If we don't yet have a last-synced snapshot, initialize it based on current stage vs student.
        if (lastSyncedCodeRef.current === null) {
            if (activeCodeOnStage === latest) {
                lastSyncedCodeRef.current = latest;
                setTimeout(() => setIsOutOfDate(false), 0);
            } else if (autoRefresh) {
                // Auto-refresh requested: pull the latest from the student.
                setTimeout(() => {
                    setActiveCodeOnStage(latest);
                    lastSyncedCodeRef.current = latest;
                    setIsOutOfDate(false);
                }, 0);
            } else {
                setTimeout(
                    () => setIsOutOfDate(activeCodeOnStage !== latest),
                    0,
                );
            }
            return;
        }

        // If the student's latest code differs from the last synced snapshot,
        // either auto-refresh (overwrite) or mark the stage as out-of-date.
        if (latest !== lastSyncedCodeRef.current) {
            if (autoRefresh) {
                setTimeout(() => {
                    setActiveCodeOnStage(latest);
                    lastSyncedCodeRef.current = latest;
                    setIsOutOfDate(false);
                }, 0);
            } else {
                setTimeout(() => setIsOutOfDate(true), 0);
            }
        }
    }, [
        students,
        stagedStudentName,
        autoRefresh,
        activeCodeOnStage,
        setActiveCodeOnStage,
    ]);

    if (!session) return null;

    const studentList = Object.values(students);

    return (
        <div className="flex h-screen w-full bg-zinc-950 text-zinc-100 font-sans overflow-hidden">
            {/* Sidebar: The Grid */}
            <div className="w-80 bg-zinc-900 border-r border-zinc-800 flex flex-col z-10">
                <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900">
                    <div className="flex items-center gap-2">
                        <MonitorPlay className="text-blue-400" size={20} />
                        <h2 className="font-bold text-sm tracking-wide uppercase text-zinc-300">
                            Command Center
                        </h2>
                    </div>
                    <div title={`Status: ${status}`}>
                        {status === "connected" ? (
                            <Wifi size={16} className="text-emerald-500" />
                        ) : (
                            <WifiOff size={16} className="text-rose-500" />
                        )}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                    <div className="flex items-center justify-between text-xs font-semibold text-zinc-500 uppercase px-1 mb-2">
                        <span>Connected Arena ({studentList.length})</span>
                        <Users size={14} />
                    </div>

                    {studentList.length === 0 ? (
                        <div className="text-center py-10 text-zinc-500 text-sm border border-dashed border-zinc-800 rounded-md">
                            Waiting for students...
                        </div>
                    ) : (
                        studentList.map((student) => (
                            <div
                                key={student.name}
                                onClick={() => handlePullToStage(student.name)}
                                className={`group p-3 rounded-md border transition-colors cursor-pointer flex flex-col gap-2 ${
                                    stagedStudentName === student.name
                                        ? "bg-blue-900/20 border-blue-500/30"
                                        : "bg-zinc-950 border-zinc-800 hover:border-zinc-700"
                                } ${!student.connected ? "opacity-60 grayscale-[0.5]" : ""}`}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div
                                            className={`w-2 h-2 rounded-full ${student.connected ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" : "bg-zinc-600"}`}
                                            title={
                                                student.connected
                                                    ? "Online"
                                                    : "Offline"
                                            }
                                        />
                                        <span className="font-medium text-zinc-200 text-sm">
                                            {student.name}
                                        </span>

                                        {/* Language badge: shows the student's active language */}
                                        <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">
                                            {student.language === "go"
                                                ? "Go"
                                                : student.language === "python"
                                                  ? "Python"
                                                  : "JS"}
                                        </span>
                                    </div>
                                    {stagedStudentName === student.name && (
                                        <span className="text-[10px] font-medium uppercase bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-sm">
                                            On Stage
                                        </span>
                                    )}
                                </div>

                                {/* Mini Metric Preview (if any) */}
                                <div className="flex items-center gap-3 text-xs text-zinc-500">
                                    <div className="flex items-center gap-1">
                                        <Activity
                                            size={12}
                                            className="text-sky-400"
                                        />
                                        <span>
                                            {String(
                                                student.metrics?.throughput ||
                                                    0,
                                            )}{" "}
                                            t/s
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Code2
                                            size={12}
                                            className="text-indigo-400"
                                        />
                                        <span className="capitalize">
                                            {student.code.split("\n").length}{" "}
                                            lines
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                <div className="p-4 border-t border-zinc-800 bg-zinc-900 flex gap-2">
                    <button
                        onClick={handlePushTemplate}
                        className="flex-1 flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 py-2 px-3 rounded-md text-sm font-medium transition-colors border border-zinc-700"
                    >
                        <Send size={16} />
                        Push Sync
                    </button>
                    <button
                        onClick={handleLogout}
                        className="flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 py-2 px-3 rounded-md transition-colors border border-zinc-700"
                        title="Leave Dashboard"
                    >
                        <LogOut size={16} />
                    </button>
                </div>
            </div>

            {/* Main Area: The Stage */}
            <div className="flex-1 flex flex-col bg-[#1e1e1e]">
                {stagedStudentName ? (
                    <>
                        {/* Stage Header */}
                        <div className="h-14 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between px-6">
                            <div className="flex items-center gap-3">
                                <span className="text-zinc-400 text-sm">
                                    Stage
                                </span>
                                <span className="font-medium text-blue-400 text-sm bg-blue-950/50 px-2 py-0.5 rounded border border-blue-900/50">
                                    {stagedStudentName}
                                </span>

                                {isOutOfDate && (
                                    <span
                                        title="Student updated — click Refresh or enable Auto-refresh"
                                        className="ml-2 inline-flex items-center gap-2 text-xs text-amber-400"
                                    >
                                        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                                        Updated
                                    </span>
                                )}
                            </div>

                            <div className="flex items-center gap-3">
                                {/* Manual refresh icon (rotates when clicked) */}
                                <button
                                    onClick={handleManualRefresh}
                                    className="p-2 rounded-2xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 flex items-center justify-center"
                                    title="Refresh staged code from student"
                                    aria-label="Refresh staged code"
                                >
                                    <RefreshCw
                                        className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`}
                                    />
                                </button>

                                {/* Auto-refresh toggle (styled switch) */}
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() =>
                                            setAutoRefresh(!autoRefresh)
                                        }
                                        className={`relative inline-flex items-center h-5 rounded-full w-10 transition-colors focus:outline-none ${autoRefresh ? "bg-emerald-500" : "bg-zinc-700"}`}
                                        title="Auto-refresh"
                                        aria-pressed={autoRefresh}
                                    >
                                        <span
                                            className={`inline-block transform bg-white w-3 h-3 rounded-full shadow transition-transform ${autoRefresh ? "translate-x-6" : "translate-x-1"}`}
                                        />
                                    </button>
                                    <span className="text-xs text-zinc-300 select-none">
                                        Auto
                                    </span>
                                </div>

                                <button
                                    onClick={handleRunStaged}
                                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white py-1.5 px-4 rounded-md text-sm font-medium transition-colors border border-transparent"
                                >
                                    <Play size={16} fill="currentColor" />
                                    Run on Floor
                                </button>
                            </div>
                        </div>

                        <CodeEditor
                            code={activeCodeOnStage}
                            language={
                                (stagedStudentName &&
                                    (students[
                                        stagedStudentName
                                    ]?.code?.includes("package main")
                                        ? "go"
                                        : students[
                                                stagedStudentName
                                            ]?.code?.includes("import asyncio")
                                          ? "python"
                                          : "javascript")) ||
                                "javascript"
                            }
                            onChange={(val) => {
                                const newVal = val || "";
                                // If the instructor starts typing while Auto-refresh is enabled,
                                // automatically disable Auto so their edits are not clobbered.
                                if (autoRefresh) {
                                    setAutoRefresh(false);
                                }
                                // Update only the staged editor. Do NOT write instructor edits
                                // back into the student store here — that prevents manual refresh
                                // from restoring the student's last-synced snapshot.
                                setActiveCodeOnStage(newVal);
                            }}
                        />
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 gap-4">
                        <div className="w-16 h-16 rounded-md bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-2">
                            <MonitorPlay size={32} className="text-zinc-600" />
                        </div>
                        <h3 className="text-lg font-medium text-zinc-300">
                            No code on stage
                        </h3>
                        <p className="max-w-sm text-center text-sm text-zinc-500">
                            Select a student from the sidebar to view their code
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
