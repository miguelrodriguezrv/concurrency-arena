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
 *     `getShippingLineQueueLength(shippingLine)`
 * - Packages returned by `unload()` are deliberately minimal (public view).
 */

export type ShippingLine = "North" | "South" | "International";

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
        | "ERROR"
        | "HEARTBEAT";

    // Optional identifiers to help consumers correlate events
    packageId?: number;
    processingLineId?: ProcessingLineId;
    shippingLine?: ShippingLine;

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
     * Intake: unloads the next package from the internal deck.
     * - Simulated delay: 200 ms.
     * - Constraint: max 4 concurrent unload() calls — otherwise throws CapacityError.
     * - Returns a minimal package object containing only public fields, or null if no more packages are available.
     */
    unload(): Promise<PackagePublic | null>;

    /**
     * Induction: push a previously-unloaded package onto a ProcessingLine.
     * - Simulated delay: 50 ms.
     * - Constraint: ProcessingLine queue capacity (5). If full, throws CapacityError.
     * - Validation: `packageId` must refer to a package in intake/unloaded state; otherwise throws ValidationError.
     */
    pushToProcessingLine(
        packageId: number,
        processingLineId: ProcessingLineId,
    ): Promise<void>;

    /**
     * Processing: process a package at the head of the specified ProcessingLine.
     * - Simulated delay: pkg.processingTime ms.
     * - Constraints:
     *   - The package must be at the head of the processing line queue; otherwise throws ValidationError.
     *   - The processing station must be free; otherwise throws ResourceBusyError.
     */
    processPackage(
        packageId: number,
        processingLineId: ProcessingLineId,
    ): Promise<void>;

    /**
     * Labeling: print a label for the package.
     * - Simulated base delay: 100 ms.
     * - Travel penalty: +500 ms if the printer moves from its current line to processingLineId.
     * - Constraint: Global singleton printer; if busy, throws ResourceBusyError.
     * - Validation: package must be processed and on the specified processing line; otherwise throws ValidationError.
     * - Returns the ShippingLine assigned to the package (this reveals the package's private targetLane).
     */
    print(
        packageId: number,
        processingLineId: ProcessingLineId,
    ): Promise<ShippingLine>;

    /**
     * Shipping: enqueue a package into the specified ShippingLine.
     * - Quick enqueue action: small internal delay; ship() resolves after enqueue.
     * - Constraint: ShippingLine capacity = 5. If full, throws CapacityError.
     * - Validation: package must have been printed and the provided shippingLine must match the package's target lane; otherwise throws HandshakeError.
     * - Background: Warehouse internally removes (ships) one package from each ShippingLine every 500 ms; ship() does not wait for that removal.
     */
    ship(packageId: number, shippingLine: ShippingLine): Promise<void>;

    /**
     * Minimal read-only inspection helper:
     * Returns the current queue length for the requested ShippingLine (0..capacity).
     * Students can use this to avoid enqueuing into a full lane (TOCTOU races still possible).
     */
    getShippingLineQueueLength(shippingLine: ShippingLine): number;

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
}
