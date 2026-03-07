import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "@/store";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useCodeRunner, type SupportedLanguage } from "@/hooks/useCodeRunner";
import CodeEditor from "@/components/editor/CodeEditor";
import ArenaHeader from "./ArenaHeader";
import ConsoleOutput from "./ConsoleOutput";
import IncomingDiffModal from "@/components/editor/IncomingDiffModal";
import {
    DEFAULT_JS_CODE,
    DEFAULT_GO_CODE,
    DEFAULT_PYTHON_CODE,
} from "@/lib/constants/boilerplate";
import {
    getCodeForLanguage,
    setCodeForLanguage,
    getCurrentLanguage,
    setCurrentLanguage,
} from "@/lib/storage";
import { ArenaVisualizer } from "@/components/warehouse/ArenaVisualizer";

export default function ArenaPage() {
    const navigate = useNavigate();
    const session = useStore((state) => state.session);
    const clearSession = useStore((state) => state.clearSession);
    const theme = useStore((state) => state.theme);

    // Restore subscribeToAdminCommands so admin PUSH_TEMPLATE commands are handled
    const { status, sendMessage, subscribeToAdminCommands } = useWebSocket();
    const { runnerState, executeCode, stopRun } = useCodeRunner();

    const initialLanguage = (() => {
        try {
            const persisted = getCurrentLanguage();
            if (persisted) return persisted;
        } catch {
            // ignore storage errors
        }
        return "javascript" as SupportedLanguage;
    })();

    const [language, setLanguage] =
        useState<SupportedLanguage>(initialLanguage);
    const [code, setCode] = useState<string>(() => {
        const local = getCodeForLanguage(initialLanguage);
        if (local) return local;
        if (initialLanguage === "go") return DEFAULT_GO_CODE;
        if (initialLanguage === "python") return DEFAULT_PYTHON_CODE;
        return DEFAULT_JS_CODE;
    });

    const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const initialSyncRef = useRef(false);
    // Keep a mutable ref for the current editor contents so effects can read the
    // latest value without needing `code` in their dependency arrays (which causes
    // effects to re-run on every keystroke and can overwrite in-progress edits).
    const codeRef = useRef<string>(code);

    useEffect(() => {
        try {
            setCurrentLanguage(language);
        } catch {
            // ignore storage errors
        }
    }, [language]);

    // Incoming diff modal state: when an admin pushes a template targeted to this student,
    // we show a diff modal rather than immediately replacing their code.
    const [incomingCode, setIncomingCode] = useState<string | null>(null);
    const [diffOpen, setDiffOpen] = useState(false);

    const handleAcceptIncoming = () => {
        const incoming = incomingCode || "";
        setCode(incoming);
        codeRef.current = incoming;
        setCodeForLanguage(language, incoming);
        try {
            sendMessage("CODE_SYNC", { code: incoming, language });
        } catch (err) {
            console.error(
                "Failed to send CODE_SYNC after accepting incoming:",
                err,
            );
        }
        setDiffOpen(false);
        setIncomingCode(null);
    };

    const handleCloseIncoming = () => {
        setDiffOpen(false);
        setIncomingCode(null);
    };

    const handleEditorChange = useCallback(
        (value: string | undefined) => {
            const newCode = value || "";
            setCode(newCode);
            // keep ref in sync so other effects can read latest editor value without
            // depending on `code` (this avoids re-running those effects on every keystroke)
            codeRef.current = newCode;
            setCodeForLanguage(language, newCode);

            // Debounce the sync to avoid flooding the WebSocket
            if (syncTimerRef.current) {
                clearTimeout(syncTimerRef.current);
                syncTimerRef.current = null;
            }

            syncTimerRef.current = window.setTimeout(() => {
                syncTimerRef.current = null;
                if (status !== "connected") return;
                try {
                    sendMessage("CODE_SYNC", { code: newCode, language });
                } catch (err) {
                    console.error("Failed to send CODE_SYNC:", err);
                }
            }, 500);
        },
        [language, sendMessage, status],
    );

    // Cleanup pending timer on unmount to avoid calling sendMessage after unmount
    useEffect(() => {
        return () => {
            if (syncTimerRef.current) {
                clearTimeout(syncTimerRef.current);
                syncTimerRef.current = null;
            }
        };
    }, [language]);

    // Protect route
    useEffect(() => {
        if (!session || session.role !== "Student") {
            navigate("/");
        }
    }, [session, navigate]);

    // Initial Sync on mount (send once when we establish connection)
    useEffect(() => {
        if (status === "connected" && !initialSyncRef.current) {
            try {
                sendMessage("CODE_SYNC", { code, language });
                initialSyncRef.current = true;
            } catch (err) {
                console.error("Failed initial CODE_SYNC:", err);
            }
        } else if (status !== "connected") {
            // Reset the flag when disconnected so we will attempt to sync again
            // on the next connection. This handles reconnect scenarios.
            initialSyncRef.current = false;
        }
    }, [status, code, language, sendMessage]);

    // Listen for server-side state restoration
    const students = useStore((state) => state.students);

    useEffect(() => {
        if (!session?.name) return;
        const student = students[session.name];
        if (!student) return;

        // Prefer a language-specific code from the server if available, otherwise fall back to
        // the student's primary `code` field.
        const serverCode = student.codes?.[language] ?? student.code;
        if (serverCode === undefined || serverCode === null) return;

        // If it's identical to the current editor contents, do nothing.
        // Read the current editor contents from the ref so we don't have to include
        // `code` in the dependency array (which would trigger on every keystroke).
        if (String(serverCode) === String(codeRef.current)) return;

        // Defer the state update to avoid a synchronous setState inside an effect,
        // which can cause cascading renders. Using setTimeout(0) schedules the
        // update after the current render/commit cycle.
        const timeoutId = window.setTimeout(() => {
            try {
                setCodeForLanguage(language, String(serverCode));
            } catch {
                // ignore storage errors
            }
            setCode(String(serverCode));
            // keep the ref in sync with the updated state
            codeRef.current = String(serverCode);
        }, 0);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [students, session?.name, language]);

    /**
     * Handle Admin Commands
     *
     * Only show the incoming diff modal when the incoming template's declared language
     * matches the student's current editor language. If the incoming ADMIN_COMMAND
     * is missing a language or the language differs from the currently selected editor
     * language, log a clear message and do not open the modal.
     */
    useEffect(() => {
        if (!session) return;
        const unsubscribe = subscribeToAdminCommands?.((payload) => {
            if (payload.action === "PUSH_TEMPLATE" && payload.code) {
                const incomingLang = (payload as Record<string, unknown>)[
                    "language"
                ];
                if (typeof incomingLang !== "string") {
                    console.error(
                        "[ADMIN_COMMAND] PUSH_TEMPLATE received without a valid 'language' field:",
                        payload,
                    );
                    return;
                }

                if (incomingLang !== language) {
                    console.info(
                        `[ADMIN_COMMAND] PUSH_TEMPLATE language mismatch: incoming='${incomingLang}' editor='${language}' — ignoring push.`,
                    );
                    return;
                }

                // Languages match: open diff modal for student review
                setIncomingCode(payload.code as string);
                setDiffOpen(true);
            }
        });

        return () => {
            if (typeof unsubscribe === "function") unsubscribe();
        };
    }, [subscribeToAdminCommands, session, language]);

    // Sync metrics to instructor when running
    useEffect(() => {
        if (
            runnerState.status === "running" ||
            runnerState.status === "complete"
        ) {
            sendMessage("METRIC_PULSE", runnerState.metrics);
        }
    }, [runnerState.metrics, runnerState.status, sendMessage]);

    if (!session) return null;

    const handleRunLocal = () => {
        if (runnerState.status === "running") {
            stopRun();
        } else {
            executeCode(code, language);
        }
    };

    const handleReset = () => {
        let defaultCode = DEFAULT_JS_CODE;
        if (language === "go") defaultCode = DEFAULT_GO_CODE;
        if (language === "python") defaultCode = DEFAULT_PYTHON_CODE;

        setCode(defaultCode);
        // keep ref in sync with the reset
        codeRef.current = defaultCode;
        setCodeForLanguage(language, defaultCode);
        sendMessage("CODE_SYNC", { code: defaultCode, language });
    };

    const handleLogout = () => {
        clearSession();
        sessionStorage.clear();
        navigate("/");
    };

    return (
        <div className="relative flex flex-col h-screen w-full bg-zinc-950 text-zinc-100 font-sans overflow-hidden">
            <ArenaHeader
                name={session.name}
                status={status}
                language={language}
                onLanguageChange={(newLang) => {
                    setCurrentLanguage(newLang);
                    setLanguage(newLang);

                    // Load saved code for the new language, or use boilerplate
                    const savedCode = getCodeForLanguage(newLang);
                    let targetCode = savedCode;

                    if (!targetCode) {
                        if (newLang === "javascript")
                            targetCode = DEFAULT_JS_CODE;
                        if (newLang === "go") targetCode = DEFAULT_GO_CODE;
                        if (newLang === "python")
                            targetCode = DEFAULT_PYTHON_CODE;
                    }

                    const finalCode = targetCode || "";
                    setCode(finalCode);
                    // keep ref in sync with the programmatic language switch
                    codeRef.current = finalCode;
                    sendMessage("CODE_SYNC", {
                        code: finalCode,
                        language: newLang,
                    });
                }}
                runnerState={runnerState}
                onRun={handleRunLocal}
                onReset={handleReset}
                onLogout={handleLogout}
            />
            <IncomingDiffModal
                open={diffOpen}
                original={code}
                modified={incomingCode || ""}
                language={language}
                theme={theme}
                onAccept={handleAcceptIncoming}
                onClose={handleCloseIncoming}
            />

            {/* Main area: left column with visualizer (top) + console (bottom); right column is the editor (half width, full height) */}
            <main className="flex-1 flex overflow-hidden p-4 gap-4">
                {/* Left column: visualizer (top) and console (bottom) */}
                <div className="w-[55%] flex flex-col gap-4 min-h-0">
                    <div className="flex-2 min-h-0 overflow-hidden rounded border border-zinc-800">
                        <ArenaVisualizer
                            events={
                                runnerState.warehouseEvents as unknown as import("@/components/warehouse/types").WarehouseEventPayload[]
                            }
                        />
                    </div>

                    <div className="flex-1 min-h-0 overflow-hidden rounded border border-zinc-800 bg-zinc-900">
                        {/* Make ConsoleOutput scroll internally */}
                        <div className="h-full min-h-0 overflow-auto">
                            <ConsoleOutput runnerState={runnerState} />
                        </div>
                    </div>
                </div>

                {/* Right column: code editor occupying half width and full height */}
                <div className="w-[45%] flex flex-col min-h-0 overflow-hidden rounded border border-zinc-800">
                    <div className="relative flex-1 min-h-0">
                        {status !== "connected" && (
                            <div className="absolute top-0 right-0 p-2 z-10 pointer-events-none">
                                <span className="text-xs font-medium bg-zinc-900 text-zinc-400 px-2 py-1 rounded border border-zinc-800">
                                    Disconnected - Retrying...
                                </span>
                            </div>
                        )}
                        <div className="h-full min-h-0">
                            <CodeEditor
                                code={code}
                                language={language}
                                onChange={handleEditorChange}
                                theme={theme}
                            />
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
