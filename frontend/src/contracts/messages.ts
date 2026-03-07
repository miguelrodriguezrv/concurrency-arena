import { z } from "zod";

/**
 * Shared runtime contracts and schemas used across the frontend.
 *
 * This centralizes the canonical zod schemas and exported TypeScript
 * types for metrics, warehouse events, and runner messages so that
 * different modules (store, hooks, workers, visualizer) can share a
 * single source of truth.
 */

/* ---------- Metric payload (used for METRIC_PULSE / METRIC_UPDATE) ---------- */

export const MetricPayloadSchema = z
    .object({
        throughput: z.number().optional(),
        correctness: z.number().optional(),
        collisions: z.number().optional(),
    })
    .catchall(z.unknown());

export type MetricPayload = z.infer<typeof MetricPayloadSchema>;

/* Alias kept for compatibility with store naming */
export type StudentMetrics = MetricPayload;

/* ---------- Warehouse event (visualizer) ---------- */

export const WarehouseEventSchema = z
    .object({
        type: z.string(), // e.g. "PACKAGE_ARRIVE", "TASK_START", "ERROR", "HEARTBEAT", ...
        timestamp: z.number().optional(),
        packageId: z.union([z.string(), z.number()]).optional(),
        lineId: z.union([z.string(), z.number()]).optional(),
        laneId: z.union([z.string(), z.number()]).optional(),
        metadata: z.record(z.string(), z.any()).optional(),
    })
    .catchall(z.unknown());

export type WarehouseEvent = z.infer<typeof WarehouseEventSchema>;

/* ---------- Runner event / command shapes (worker <-> UI bridge) ---------- */

/**
 * Minimal set of runner event types used by the UI to drive output, metrics and visualizer.
 * This mirrors the runtime contract used by worker bridge files.
 */
export const RunnerEventTypeEnum = z.enum([
    "RUNNER_READY",
    "STDOUT",
    "STDERR",
    "METRIC_UPDATE",
    "RUN_COMPLETE",
    "RUN_ERROR",
    "WAREHOUSE_EVENT",
]);

export type RunnerEventType = z.infer<typeof RunnerEventTypeEnum>;

export const RunnerEventSchema = z
    .object({
        type: RunnerEventTypeEnum,
        payload: z.unknown().optional(),
    })
    .catchall(z.unknown());

export type RunnerEvent = z.infer<typeof RunnerEventSchema>;

/* Runner command types sent from main thread to worker */
export const RunnerCommandTypeEnum = z.enum(["START_RUN", "STOP_RUN"]);
export type RunnerCommandType = z.infer<typeof RunnerCommandTypeEnum>;

export const StartRunPayloadSchema = z
    .object({
        code: z.string(),
        deck: z.array(z.unknown()).optional(),
    })
    .catchall(z.unknown());

export type StartRunPayload = z.infer<typeof StartRunPayloadSchema>;

/* Generic runner command shape */
export const RunnerCommandSchema = z
    .object({
        type: RunnerCommandTypeEnum,
        payload: z.unknown().optional(),
    })
    .catchall(z.unknown());

export type RunnerCommand = z.infer<typeof RunnerCommandSchema>;

/* ---------- Exports convenience / validators ---------- */

/**
 * Safe parse helpers (optional convenience wrappers)
 */
export const parseMetricPayload = (input: unknown) =>
    MetricPayloadSchema.safeParse(input);

export const parseWarehouseEvent = (input: unknown) =>
    WarehouseEventSchema.safeParse(input);

export const parseRunnerEvent = (input: unknown) =>
    RunnerEventSchema.safeParse(input);
