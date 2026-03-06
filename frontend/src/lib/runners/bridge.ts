/**
 * The standard events that any runner (JS, Go, or Python) can emit
 * back to the main React UI thread.
 */
export type RunnerEventType =
    | "RUNNER_READY"
    | "STDOUT"
    | "STDERR"
    | "METRIC_UPDATE"
    | "RUN_COMPLETE"
    | "RUN_ERROR"
    | "WAREHOUSE_EVENT";

export interface RunnerEvent {
    type: RunnerEventType;
    payload?: unknown;
}

export interface MetricUpdatePayload {
    throughput?: number;
    correctness?: number;
    collisions?: number;
}

/**
 * Commands sent FROM the main thread TO the worker thread.
 */
export type RunnerCommandType = "START_RUN" | "STOP_RUN";

export interface RunnerCommand {
    type: RunnerCommandType;
    payload?: unknown;
}

export interface StartRunPayload {
    code: string;
    // Optional deterministic deck payload (worker may generate its own if omitted)
    deck?: unknown;
}
