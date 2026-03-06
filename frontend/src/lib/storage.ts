/**
 * LocalStorage helper utilities for the Concurrency Arena frontend.
 *
 * Responsibilities:
 * - Centralize key naming for `arena_code_<lang>`, `arena_session`, and `monaco_theme`.
 * - Provide safe get/set/remove wrappers that tolerate SSR and localStorage errors.
 * - Small convenience helpers to list or clear all arena code entries.
 *
 * This module is intentionally minimal and has no runtime dependencies so it can be
 * safely imported from any UI module.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Role = "Instructor" | "Student";

export interface Session {
    token: string;
    name: string;
    role: Role;
}

/**
 * Supported languages for editor code storage.
 * Keep this in-sync with the rest of the application (e.g. the code-runner hook).
 */
export type SupportedLanguage = "javascript" | "go" | "python";

/* Key constants (single source of truth for localStorage keys) */
export const ARENA_CODE_PREFIX = "arena_code_"; // usage: arena_code_<language>
export const ARENA_SESSION_KEY = "arena_session";
export const MONACO_THEME_KEY = "monaco_theme";
export const ARENA_CURRENT_LANGUAGE_KEY = "arena_current_language";

/* ---------- Safe localStorage helpers ---------- */

/**
 * Returns true when localStorage is available in the current environment.
 * Safely guards against SSR and browser privacy modes where access can throw.
 */
function storageAvailable(): boolean {
    try {
        return (
            typeof window !== "undefined" &&
            typeof window.localStorage !== "undefined" &&
            window.localStorage !== null
        );
    } catch {
        return false;
    }
}

/**
 * Safely read a string value from localStorage.
 */
export function safeGetItem(key: string): string | null {
    if (!storageAvailable()) return null;
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

/**
 * Safely set a string value in localStorage.
 */
export function safeSetItem(key: string, value: string): boolean {
    if (!storageAvailable()) return false;
    try {
        window.localStorage.setItem(key, value);
        return true;
    } catch {
        return false;
    }
}

/**
 * Safely remove a key from localStorage.
 */
export function safeRemoveItem(key: string): boolean {
    if (!storageAvailable()) return false;
    try {
        window.localStorage.removeItem(key);
        return true;
    } catch {
        return false;
    }
}

/* ---------- Code-per-language helpers ---------- */

/**
 * Build the storage key for a language's code entry.
 */
export function codeKeyForLanguage(lang: SupportedLanguage): string {
    return `${ARENA_CODE_PREFIX}${lang}`;
}

/**
 * Get stored code for a language.
 * Returns null when not present or unavailable.
 */
export function getCodeForLanguage(lang: SupportedLanguage): string | null {
    return safeGetItem(codeKeyForLanguage(lang));
}

/* ---------- Current language helpers ---------- */

/**
 * Read the persisted current language (the value previously saved by
 * `setCurrentLanguage`). Returns a `SupportedLanguage` or `null` when no
 * valid value is stored.
 */
export function getCurrentLanguage(): SupportedLanguage | null {
    const raw = safeGetItem(ARENA_CURRENT_LANGUAGE_KEY);
    if (!raw) return null;
    if (raw === "javascript" || raw === "go" || raw === "python") {
        return raw as SupportedLanguage;
    }
    // Invalid or corrupt value: remove it and return null.
    try {
        safeRemoveItem(ARENA_CURRENT_LANGUAGE_KEY);
    } catch {
        // ignore
    }
    return null;
}

/**
 * Persist the given language. Pass `null` to remove the stored value.
 * Returns true on success, false if storage wasn't available or failed.
 */
export function setCurrentLanguage(lang: SupportedLanguage | null): boolean {
    if (lang === null) {
        return safeRemoveItem(ARENA_CURRENT_LANGUAGE_KEY);
    }
    return safeSetItem(ARENA_CURRENT_LANGUAGE_KEY, lang);
}

/**
 * Remove the persisted current language.
 */
export function clearCurrentLanguage(): boolean {
    return safeRemoveItem(ARENA_CURRENT_LANGUAGE_KEY);
}

/**
 * Set stored code for a language.
 * Returns true on success, false if storage wasn't available or failed.
 */
export function setCodeForLanguage(
    lang: SupportedLanguage,
    code: string,
): boolean {
    return safeSetItem(codeKeyForLanguage(lang), code);
}

/**
 * Remove stored code for a language.
 */
export function removeCodeForLanguage(lang: SupportedLanguage): boolean {
    return safeRemoveItem(codeKeyForLanguage(lang));
}

/**
 * List all arena code keys currently present in localStorage.
 * Returns an array of language strings (the suffix after `arena_code_`) when possible.
 */
export function listStoredCodeLanguages(): string[] {
    if (!storageAvailable()) return [];
    try {
        const out: string[] = [];
        for (let i = 0; i < window.localStorage.length; i++) {
            const key = window.localStorage.key(i);
            if (key && key.startsWith(ARENA_CODE_PREFIX)) {
                out.push(key.slice(ARENA_CODE_PREFIX.length));
            }
        }
        return out;
    } catch {
        return [];
    }
}

/**
 * Clear all stored arena code entries (all keys that start with `arena_code_`).
 * Returns the number of keys removed, or -1 if storage was unavailable.
 */
export function clearAllStoredCodes(): number {
    if (!storageAvailable()) return -1;
    try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < window.localStorage.length; i++) {
            const key = window.localStorage.key(i);
            if (key && key.startsWith(ARENA_CODE_PREFIX)) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach((k) => {
            try {
                window.localStorage.removeItem(k);
            } catch {
                // ignore per-key failures
            }
        });
        return keysToRemove.length;
    } catch {
        return -1;
    }
}

/* ---------- Session helpers ---------- */

/**
 * Get the persisted session object, or null.
 */
export function getSession(): Session | null {
    const raw = safeGetItem(ARENA_SESSION_KEY);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as unknown;
        // Basic runtime validation (lightweight)
        if (
            parsed &&
            typeof parsed === "object" &&
            typeof (parsed as any).token === "string" &&
            typeof (parsed as any).name === "string" &&
            typeof (parsed as any).role === "string"
        ) {
            return parsed as Session;
        }
        return null;
    } catch {
        // Corrupt data: clear it to avoid repeated parse errors
        safeRemoveItem(ARENA_SESSION_KEY);
        return null;
    }
}

/**
 * Persist the session. Pass `null` to remove the stored session.
 */
export function setSession(session: Session | null): boolean {
    if (!session) {
        return safeRemoveItem(ARENA_SESSION_KEY);
    }
    try {
        return safeSetItem(ARENA_SESSION_KEY, JSON.stringify(session));
    } catch {
        return false;
    }
}

/**
 * Remove the persisted session.
 */
export function clearSession(): boolean {
    return safeRemoveItem(ARENA_SESSION_KEY);
}

/* ---------- Theme helpers ---------- */

/**
 * Get the persisted Monaco theme id (e.g. "vs-dark" or "vs").
 * Returns null when unavailable.
 */
export function getPersistedMonacoTheme(): string | null {
    return safeGetItem(MONACO_THEME_KEY);
}

/**
 * Persist the Monaco theme id.
 */
export function setPersistedMonacoTheme(themeId: string): boolean {
    return safeSetItem(MONACO_THEME_KEY, themeId);
}

/**
 * Remove persisted theme preference.
 */
export function clearPersistedMonacoTheme(): boolean {
    return safeRemoveItem(MONACO_THEME_KEY);
}

/* ---------- Small utilities ---------- */

/**
 * Safely parse JSON; returns `defaultValue` on error.
 */
export function safeJsonParse<T = any>(
    raw: string | null,
    defaultValue: T | null = null,
): T | null {
    if (raw === null) return defaultValue;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return defaultValue;
    }
}
