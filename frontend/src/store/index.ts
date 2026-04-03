import { create } from "zustand";
import type { MetricPayload } from "@/contracts/messages";
import {
    getSession as getStoredSession,
    setSession as persistSession,
    clearSession as clearPersistedSession,
    getPersistedMonacoTheme,
    setPersistedMonacoTheme,
    clearAllStoredCodes,
    getPersonalBest,
    setPersonalBest as persistPersonalBest,
    type SupportedLanguage,
} from "@/lib/storage";

export type Role = "Instructor" | "Student";

export type StudentMetrics = MetricPayload;

export interface ScoreEntry {
    userName: string;
    upm: number;
    duration?: number;
    language: string;
    timestamp: number;
}

export interface Session {
    token: string;
    name: string;
    role: Role;
}

export interface StudentState {
    name: string;
    code: string;
    codes: Record<string, string>;
    metrics: StudentMetrics;
    connected: boolean;
    lastUpdated: number;
    // current language the student is using (optional; defaults to 'javascript' when created)
    language?: string;
}

interface AppState {
    // Current User Session
    session: Session | null;
    setSession: (session: Session | null) => void;
    clearSession: () => void;
    hydrateSession: () => void;

    // UI Theme (Monaco editor theme)
    // Stored as Monaco theme id, e.g. "vs-dark" or "vs"
    theme: string;
    setTheme: (theme: string) => void;

    // Real-time State (Instructor view of all connected students)
    students: Record<string, StudentState>;
    updateStudentCode: (
        name: string,
        code: string | { code: string; language: string },
    ) => void;
    updateStudentMetrics: (name: string, metrics: StudentMetrics) => void;
    updateStudentPresence: (name: string, connected: boolean) => void;
    ensureStudent: (name: string) => void;
    removeStudent: (name: string) => void;

    // Instructor Dashboard "Stage" View
    stagedStudentName: string | null;
    activeCodeOnStage: string;
    setStagedStudent: (name: string | null) => void;
    setActiveCodeOnStage: (code: string) => void;

    // Leaderboard & Personal Best
    leaderboard: ScoreEntry[];
    personalBests: Record<string, number>; // per-language PB
    addScore: (entry: ScoreEntry) => void;
    updatePersonalBest: (lang: string, upm: number) => void;
}

export const useStore = create<AppState>((set, get) => ({
    // Leaderboard & Personal Best
    leaderboard: [],
    personalBests: {},

    addScore: (entry) => {
        set((state) => {
            // Filter out any existing entry for this specific user to maintain "One entry per student"
            const filtered = state.leaderboard.filter(
                (e) => e.userName !== entry.userName,
            );

            // Check if this new score is actually better than what we just filtered out (or if it's brand new)
            // Note: During hydration/sync, we might get multiple updates.
            const existing = state.leaderboard.find(
                (e) => e.userName === entry.userName,
            );
            if (existing && existing.upm >= entry.upm) {
                return state;
            }

            const nextLeaderboard = [...filtered, entry]
                .sort((a, b) => b.upm - a.upm) // Higher is better for UPM
                .slice(0, 50);
            return { leaderboard: nextLeaderboard };
        });
    },

    updatePersonalBest: (lang, upm) => {
        set((state) => {
            const current = state.personalBests[lang] || 0;
            if (upm > current) {
                persistPersonalBest(lang as SupportedLanguage, upm);
                return {
                    personalBests: {
                        ...state.personalBests,
                        [lang]: upm,
                    },
                };
            }
            return state;
        });
    },

    session: null,
    setSession: (session) => {
        if (session) {
            persistSession(session);
        } else {
            clearPersistedSession();
        }
        set({ session });
    },
    clearSession: () => {
        clearPersistedSession();
        clearAllStoredCodes();
        set({ session: null, students: {}, stagedStudentName: null });
    },
    hydrateSession: () => {
        const sessionObj = getStoredSession();
        if (sessionObj) {
            const languages: SupportedLanguage[] = [
                "javascript",
                "go",
                "python",
            ];
            const pbs: Record<string, number> = {};
            languages.forEach((lang) => {
                const pb = getPersonalBest(lang);
                if (pb !== null) pbs[lang] = pb;
            });
            set({ session: sessionObj, personalBests: pbs });
        }
    },

    // UI Theme (Monaco editor theme): 'vs-dark' or 'vs'
    theme: (() => {
        const t = getPersistedMonacoTheme();
        return t || "vs-dark";
    })(),
    setTheme: (theme: string) => {
        setPersistedMonacoTheme(theme);
        set({ theme });
    },

    // Students Map
    students: {},

    ensureStudent: (name) => {
        set((state) => {
            if (state.students[name]) return state;
            return {
                students: {
                    ...state.students,
                    [name]: {
                        name,
                        code: "",
                        codes: {},
                        metrics: {
                            throughput: 0,
                            collisions: 0,
                            errors: 0,
                            shipped: 0,
                            fatal: false,
                        },
                        connected: true,
                        lastUpdated: Date.now(),
                        language: "javascript",
                    },
                },
            };
        });
    },

    updateStudentCode: (name, codeOrPayload) => {
        get().ensureStudent(name);
        set((state) => {
            const student = state.students[name];
            const codes = { ...student.codes };
            let finalCode = student.code;
            let finalLanguage = student.language;

            if (typeof codeOrPayload === "string") {
                // If it's a bare string, we don't know the language.
                // We keep it in the primary 'code' field for UI compatibility.
                finalCode = codeOrPayload;
            } else {
                finalCode = codeOrPayload.code;
                codes[codeOrPayload.language] = codeOrPayload.code;
                finalLanguage = codeOrPayload.language;
            }

            return {
                students: {
                    ...state.students,
                    [name]: {
                        ...student,
                        code: finalCode,
                        codes,
                        language: finalLanguage,
                        lastUpdated: Date.now(),
                    },
                },
            };
        });
    },

    updateStudentMetrics: (name, metrics) => {
        get().ensureStudent(name);
        set((state) => ({
            students: {
                ...state.students,
                [name]: {
                    ...state.students[name],
                    metrics,
                    lastUpdated: Date.now(),
                },
            },
        }));
    },

    updateStudentPresence: (name, connected) => {
        get().ensureStudent(name);
        set((state) => ({
            students: {
                ...state.students,
                [name]: {
                    ...state.students[name],
                    connected,
                    lastUpdated: Date.now(),
                },
            },
        }));
    },
    removeStudent: (name) =>
        set((state) => {
            const newStudents = { ...state.students };
            delete newStudents[name];
            return { students: newStudents };
        }),

    // Stage View
    stagedStudentName: null,
    activeCodeOnStage: "",
    setStagedStudent: (name) =>
        set((state) => ({
            stagedStudentName: name,
            activeCodeOnStage:
                name && state.students[name] ? state.students[name].code : "",
        })),
    setActiveCodeOnStage: (code) => set({ activeCodeOnStage: code }),
}));
