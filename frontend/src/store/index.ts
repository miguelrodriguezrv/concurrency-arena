import { create } from "zustand";
import type { MetricPayload } from "@/contracts/messages";
import {
    getSession as getStoredSession,
    setSession as persistSession,
    clearSession as clearPersistedSession,
    getPersistedMonacoTheme,
    setPersistedMonacoTheme,
    clearAllStoredCodes,
} from "@/lib/storage";

export type Role = "Instructor" | "Student";

export type StudentMetrics = MetricPayload;

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
}

export const useStore = create<AppState>((set, get) => ({
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
            set({ session: sessionObj });
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
                        metrics: { throughput: 0, collisions: 0 },
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
            let finalCode = "";
            let finalLanguage = student.language;

            if (typeof codeOrPayload === "string") {
                finalCode = codeOrPayload;
            } else {
                finalCode = codeOrPayload.code;
                // record the per-language snapshot
                codes[codeOrPayload.language] = codeOrPayload.code;
                // update the student's active language
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
