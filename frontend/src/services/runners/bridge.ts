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
    | "WAREHOUSE_EVENT"
    | "COMPLETIONS_RESULT"
    | "HOVER_RESULT"
    | "DIAGNOSTICS_RESULT"
    | "SIGNATURES_RESULT";

export interface RunnerEvent {
    type: RunnerEventType;
    payload?: any;
}

export interface MetricUpdatePayload {
    throughput?: number;
    correctness?: number;
    collisions?: number;
}

/**
 * Commands sent FROM the main thread TO the worker thread.
 */
export type RunnerCommandType = "START_RUN" | "STOP_RUN" | "GET_COMPLETIONS" | "GET_HOVER" | "GET_DIAGNOSTICS" | "GET_SIGNATURES";

export interface RunnerCommand {
    type: RunnerCommandType;
    payload?: any;
}

export interface StartRunPayload {
    code: string;
    // Optional deterministic deck payload (worker may generate its own if omitted)
    deck?: unknown;
}

export interface GetCompletionsPayload {
    code: string;
    line: number;
    column: number;
    requestId: string;
}

export interface GetHoverPayload {
    code: string;
    line: number;
    column: number;
    requestId: string;
}

export interface GetDiagnosticsPayload {
    code: string;
    requestId: string;
}

export interface GetSignaturesPayload {
    code: string;
    line: number;
    column: number;
    requestId: string;
}

export interface CompletionsResultPayload {
    suggestions: any[];
    requestId: string;
}

export interface HoverResultPayload {
    contents: any[];
    requestId: string;
}

export interface DiagnosticsResultPayload {
    diagnostics: any[];
    requestId: string;
}

export interface SignaturesResultPayload {
    signatures: any[];
    requestId: string;
}
