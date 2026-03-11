/// <reference types="vite/client" />

/**
 * Project-level Vite environment type declarations.
 *
 * These are exposed via `import.meta.env` at runtime.
 */

interface ImportMetaEnv {
    readonly VITE_BACKEND_URL?: string;
    readonly VITE_WS_URL?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
