/**
 * Concurrency helper libraries available to JavaScript solutions (the same
 * ones shown in the masterclass slides). JS has no built-in mutex/semaphore,
 * Python and Go do.
 *
 * Student code runs inside an async function (for top-level await), where
 * static `import` statements are not allowed. `rewriteImports` turns the
 * supported imports into plain `const` declarations that read from `__lib`,
 * keeping the line count so error line numbers still match the editor.
 */
import pLimit from "p-limit";
import { Mutex, Semaphore, withTimeout } from "async-mutex";
import PQueue from "p-queue";

export const JS_LIBRARIES: Record<string, Record<string, unknown>> = {
    "p-limit": { default: pLimit, pLimit },
    "async-mutex": { Mutex, Semaphore, withTimeout },
    "p-queue": { default: PQueue, PQueue },
};

/** Also exposed as plain globals, so code without import lines works too. */
export const JS_LIBRARY_GLOBALS = { pLimit, Mutex, Semaphore, PQueue };

export class UnsupportedImportError extends Error {}

const IMPORT_RE =
    /^([ \t]*)import\s+(?:([\w$]+)\s*(?:,\s*)?)?(?:\{([^}]*)\})?\s*(?:\*\s+as\s+([\w$]+)\s*)?from\s*["']([^"']+)["'];?[ \t]*$/gm;

export function rewriteImports(code: string): string {
    return code.replace(
        IMPORT_RE,
        (m: string, indent: string, def?: string, named?: string, ns?: string, mod?: string) => {
            const name = mod ?? "";
            if (!(name in JS_LIBRARIES)) {
                throw new UnsupportedImportError(
                    `Cannot import "${name}". Available: ${Object.keys(JS_LIBRARIES).join(", ")}.`,
                );
            }
            const src = `__lib[${JSON.stringify(name)}]`;
            const parts: string[] = [];
            if (def) parts.push(`const ${def} = ${src}.default;`);
            if (ns) parts.push(`const ${ns} = ${src};`);
            if (named && named.trim()) {
                const fields = named
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .map((s) => s.replace(/\s+as\s+/, ": "));
                parts.push(`const { ${fields.join(", ")} } = ${src};`);
            }
            // keep line numbers stable for multi-line imports
            const newlines = "\n".repeat((m.match(/\n/g) ?? []).length);
            return indent + parts.join(" ") + newlines;
        },
    );
}
