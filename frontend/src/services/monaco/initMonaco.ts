import { loader } from "@monaco-editor/react";
import { registerGoProviders } from "./providers/go";
import { registerPythonJediProvider } from "./providers/python";
import arenaTypes from "./types/arena.d.ts?raw";

let initialized = false;

/**
 * Initialize Monaco and register language-specific completion providers.
 * Calling multiple times is safe; initialization is performed once.
 */
export async function initMonaco(): Promise<void> {
    if (initialized) return;
    initialized = true;

    // loader.init() returns a promise resolving to the monaco namespace
    const monaco = await loader.init();

    // Set compiler options BEFORE adding extra libs
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
        target: monaco.languages.typescript.ScriptTarget.ESNext,
        allowNonTsExtensions: true,
        noLib: false,
    });

    // Register JS/TS types from the actual .d.ts file
    monaco.languages.typescript.javascriptDefaults.addExtraLib(arenaTypes);
    monaco.languages.typescript.typescriptDefaults.addExtraLib(arenaTypes);

    registerGoProviders(monaco);
    registerPythonJediProvider(monaco);
}
