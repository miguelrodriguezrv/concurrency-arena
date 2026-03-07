/**
 * Barrel file for runner bridge types + workers.
 *
 * Exports:
 *  - Runtime types from `bridge.ts`
 *  - Worker entrypoints for bundlers that understand the `?worker` suffix
 */

/* Re-export bridge types and schemas */
export * from "./bridge";
export type {
    RunnerEvent,
    RunnerCommand,
    MetricUpdatePayload,
    StartRunPayload,
} from "./bridge";

/* Export worker entrypoints.
 *
 * Using the `?worker` suffix allows Vite (and other bundlers that support
 * this convention) to treat the files as web worker entry points and return
 * the platform-appropriate constructor/URL.
 *
 * Consumers may import the worker constructors directly:
 *   import { JSWorker } from "@/services/runners";
 *
 * Or import specific worker modules with the ?worker suffix if they need a
 * direct worker constructor:
 *   import JSWorker from "@/services/runners/js.worker.ts?worker";
 */
export { default as JSWorker } from "./js.worker.ts?worker";
export { default as GoWorker } from "./go.worker.ts?worker";
export { default as PythonWorker } from "./python.worker.ts?worker";
