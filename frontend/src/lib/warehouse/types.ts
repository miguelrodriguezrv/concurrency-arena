/**
 * Validator-only Warehouse API types (final specification)
 *
 * This file defines the public TypeScript types for the validator-only
 * Warehouse runtime used by the Concurrency Arena.
 *
 * Important notes:
 * - The Warehouse enforces physical constraints by validating calls and
 *   throwing immediately on violations. It does NOT block/wait for students.
 * - The only read-only inspection helper exposed to students is:
 *     `getShippingLaneQueueLength(shippingLane)`
 * - Packages returned by `unload()` are deliberately minimal (public view).
 */

export type ShippingLane = "North" | "South" | "International";

/**
 * ProcessingLineId is an index for the three processing lines.
 * Use 0, 1 or 2 when calling processing-line APIs.
 */
export type ProcessingLineId = 0 | 1 | 2;

/**
 * Events emitted by the Warehouse runtime.
 * Consumed by the UI/visualizer and the runner for telemetry.
 */
export interface WarehouseEvent {
    type:
        | "INTAKE_START"
        | "INTAKE_DONE"
        | "INDUCTION_START"
        | "INDUCTION_DONE"
        | "PROCESS_START"
        | "PROCESS_DONE"
        | "PRINT_START"
    | "PRINT_SUCCESS"
    | "PRINTER_MOVE_START"
    | "PRINTER_MOVE_DONE"
    | "SHIP_ENQUEUED"
    | "SHIP_START"
    | "SHIP_COMPLETE"
    | "PENALTY"
    | "ERROR"
    | "COMPLETED"
    | "INCOMPLETE"
    | "HEARTBEAT";

    // Optional identifiers to help consumers correlate events
    packageId?: number;
    processingLineId?: ProcessingLineId;
    shippingLane?: ShippingLane;

    // Timestamp should use performance.now() where available (otherwise Date.now()).
    timestamp: number;

    // Free-form metadata for additional context (queue lengths, messages, etc).
    // Keep values serializable for postMessage between worker/main thread.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata?: Record<string, any>;
}

/**
 * Public Package shape returned by `unload()`.
 * This intentionally hides all private fields such as `targetLane`,
 * `location`, and `status`.
 */
export interface PackagePublic {
    id: number;
    processingTime: number; // ms (deterministic per deck)
}

/**
 * Minimal (validator-only) Warehouse public API.
 *
 * Implementations MUST validate every call and throw an Error (or a typed
 * subclass) immediately if the call would violate the Warehouse rules.
 */
export interface WarehouseAPI {
    /**
     * Unload the next package from the trucks. Max 4 concurrent calls; the
     * intake belt (unloaded + unloading, not yet pushed) holds 8.
     * Resolves to null when the trucks are empty. Timings: see DEFAULT_TIMINGS.
     */
    unload(): Promise<PackagePublic | null>;

    /** Move a package from the intake belt onto line 0, 1 or 2 (max 5 per line). */
    pushToProcessingLine(
        packageId: number,
        processingLineId: ProcessingLineId,
    ): Promise<void>;

    /** Process any package on its line; one package at a time per line. */
    processPackage(
        packageId: number,
        processingLineId: ProcessingLineId,
    ): Promise<void>;

    /**
     * Label the processed package at the head (end) of the line. Single printer;
     * travel penalty if it has to move. Returns the package's shipping lane.
     */
    print(
        packageId: number,
        processingLineId: ProcessingLineId,
    ): Promise<ShippingLane>;

    /**
     * Ship the printed package at the head of its line into its lane (max 4
     * waiting). Resolves once enqueued; lanes load trucks in the background.
     */
    ship(packageId: number, shippingLane: ShippingLane): Promise<void>;

    /** Current queue length of a shipping lane (0..4). Optimistic: may change. */
    getShippingLaneQueueLength(shippingLane: ShippingLane): number;

    /**
     * Subscribe to Warehouse events.
     * The callback may be called frequently; keep handlers fast.
     */
    onEvent(cb: (ev: WarehouseEvent) => void): void;

    /**
     * Optional cleanup hook.
     * Implementations that allocate background timers or other resources may
     * provide this method so consumers can request a graceful shutdown.
     */
    dispose?: () => void;

    /**
     * Runner-only: wait for in-flight work to finish after the student's code
     * returns, then report whether every package shipped.
     */
    settle?: (timeoutMs?: number) => Promise<{
        total: number;
        shipped: number;
        stranded: number[];
        stuck: number[];
        notUnloaded: number;
        complete: boolean;
        halted: boolean;
    }>;
}
