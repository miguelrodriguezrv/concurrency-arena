/**
 * Validator-only Warehouse runtime implementation.
 *
 * Implements the Warehouse API described in WAREHOUSE_SPECIFICATION.md:
 * - Validator-only: calls immediately throw (and emit ERROR) on rule violations.
 * - Minimal inspection API: getShippingLineQueueLength(...)
 * - Packages returned by unload() are minimal and hide private fields.
 *
 * This file intentionally keeps the runtime deterministic by deriving
 * per-package processingTime and targetLane from the package id.
 */

import { EventEmitter } from "./emitter";
import type {
    WarehouseAPI,
    WarehouseEvent,
    PackagePublic,
    ShippingLine,
    ProcessingLineId,
} from "./types";

/** Timings and capacities (tunable) */
const UNLOAD_MS = 600;
const PUSH_MS = 100;
const PRINT_BASE_MS = 500;
const PRINT_TRAVEL_MS = 2000;
const SHIP_REMOVE_INTERVAL_MS = 2000;
const SHIP_ENQUEUE_MS = 200;
const PROCESSING_TIME_MIN = 500;
const PROCESSING_TIME_MAX = 3000; // inclusive
const INTAKE_CONCURRENCY = 4;
const INTAKE_CAPACITY = 8;
const PROCESSING_LINE_CAPACITY = 5;
const SHIPPING_LINE_CAPACITY = 5;

/** Penalties and Error Limits */
const MAX_ERRORS = 100;
const TRANSIENT_PENALTY_MS = 2000; // Delay for capacity/concurrency errors
const RESOURCE_PENALTY_MS = 1000; // Delay for station/printer busy errors

/** Utility delay */
const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

/** Internal representation of a package */
type LocationString =
    | "deck"
    | "intake"
    | "processingLine0"
    | "processingLine1"
    | "processingLine2"
    | "shippingLineNorth"
    | "shippingLineSouth"
    | "shippingLineInternational"
    | "shipped";

type StatusString =
    | "on_deck"
    | "unloading"
    | "in_intake"
    | "processing"
    | "processed"
    | "labeled"
    | "shipped";

interface InternalPackage {
    id: number;
    processingTime: number;
    targetLane: ShippingLine; // private
    location: LocationString;
    status: StatusString;
    lineId?: ProcessingLineId;
    timestamps: {
        unloadedAt?: number;
        pushedAt?: number;
        processingStartedAt?: number;
        printedAt?: number;
        shippedAt?: number;
    };
}

/** Helper: deterministic processingTime in [500,3000] and deterministic lane */
function deterministicProcessingTime(id: number): number {
    // simple deterministic formula: spread across [500..3000]
    const span = PROCESSING_TIME_MAX - PROCESSING_TIME_MIN;
    // use a deterministic linear congruence-ish step
    const v = (id * 997) % (span + 1); // 0..span
    return PROCESSING_TIME_MIN + v;
}

function deterministicTargetLane(id: number): ShippingLine {
    const r = id % 3;
    if (r === 0) return "North";
    if (r === 1) return "South";
    return "International";
}

class Warehouse implements WarehouseAPI {
    // public event emitter
    private emitter = new EventEmitter<WarehouseEvent>();

    // internal deck/records
    private packageRecords = new Map<number, InternalPackage>();

    // intake concurrency tracking
    private activeUnloaders = 0;

    // processing line queues and station busy flags
    private processingQueues: number[][] = [[], [], []]; // queues store package ids
    private processingBusy: boolean[] = [false, false, false];

    // printer state
    private printerBusy = false;
    private printerPosition: ProcessingLineId = 0; // 0..2

    // shipping queues (per lane) and background processors
    private shippingQueues: Record<ShippingLine, number[]> = {
        North: [],
        South: [],
        International: [],
    };
    private shippingRunning: boolean = false;

    // Capacity Tracking (Atomic)
    private pendingProcessingCounts: number[] = [0, 0, 0];

    // Error and Penalty Tracking
    private errorCount = 0;
    private isHalted = false;

    // instrumentation
    private processedCount = 0;
    private firstUnloadTimestamp?: number;
    private lastShipTimestamp?: number;

    // heartbeat
    private heartbeatTimer?: number | ReturnType<typeof setInterval>;

    /**
     * deck param:
     * - The runner may pass an array describing a deterministic deck.
     * - We accept an array of objects that include { id?: number } or an array of numbers.
     * - If undefined, we will generate package ids incrementally starting at 0.
     */
    constructor(deck?: Array<{ id?: number } | number>) {
        // If a deck is provided, respect its size and ids; otherwise pre-create
        // a deterministic deck of 100 packages (ids 0..99).
        const DEFAULT_DECK_SIZE = 100;

        if (Array.isArray(deck) && deck.length > 0) {
            // Use the provided ids if present, otherwise assign increasing ids
            for (let i = 0; i < deck.length; i++) {
                const item = deck[i] as unknown;
                const id =
                    typeof item === "number"
                        ? item
                        : item &&
                            typeof (item as { id?: number }).id === "number"
                          ? (item as { id: number }).id
                          : i;
                if (this.packageRecords.has(id)) continue;
                const processingTime = deterministicProcessingTime(id);
                const targetLane = deterministicTargetLane(id);
                const rec: InternalPackage = {
                    id,
                    processingTime,
                    targetLane,
                    location: "deck",
                    status: "on_deck",
                    lineId: undefined,
                    timestamps: {},
                };
                this.packageRecords.set(id, rec);
            }
        } else {
            // Pre-create a deterministic deck of DEFAULT_DECK_SIZE packages.
            for (let id = 0; id < DEFAULT_DECK_SIZE; id++) {
                if (this.packageRecords.has(id)) continue;
                const processingTime = deterministicProcessingTime(id);
                const targetLane = deterministicTargetLane(id);
                const rec: InternalPackage = {
                    id,
                    processingTime,
                    targetLane,
                    location: "deck",
                    status: "on_deck",
                    lineId: undefined,
                    timestamps: {},
                };
                this.packageRecords.set(id, rec);
            }
        }

        // start shipping background processors
        this.startShippingProcessors();

        // start heartbeat
        this.startHeartbeat();
    }

    // ---------- Event helpers ----------
    private emit(
        type: WarehouseEvent["type"],
        payload: Partial<WarehouseEvent> = {},
    ) {
        if (this.isHalted) return; // Silent discard if already dead

        if (type === "ERROR") {
            this.errorCount++;
            if (this.errorCount > MAX_ERRORS) {
                this.isHalted = true;
                const fatalMsg = `Excessive errors: ${this.errorCount} (limit ${MAX_ERRORS})`;
                // Emit one last fatal error then stop processing
                const ev: WarehouseEvent = {
                    type: "ERROR",
                    timestamp: performance.now(),
                    metadata: { message: fatalMsg, fatal: true },
                };
                this.emitter.emit(ev);
                this.dispose();
                return;
            }
        }
        const ev: WarehouseEvent = {
            type,
            timestamp: performance.now(),
            ...payload,
        };
        try {
            // Emit to listeners...
            this.emitter.emit(ev);

            // Also log a compact debug-friendly representation to the console.
            // Keep the log lightweight but include the most useful fields so the
            // front-end can show and filter runtime activity during development.
            try {
                const p = ev;
                const logEntry = {
                    type: ev.type,
                    timestamp: ev.timestamp,
                    packageId: p.packageId,
                    processingLineId: p.processingLineId,
                    shippingLine: p.shippingLine,
                    metadata: p.metadata,
                };
                // Use debug so logs can be toggled by developer tools; fallback to log when debug is unavailable.
                if (console.debug) {
                    console.debug("[Warehouse Event]", logEntry);
                } else {
                    console.log("[Warehouse Event]", logEntry);
                }
            } catch (logErr) {
                // Non-fatal: don't allow logging failures to interrupt runtime.
                console.warn("Warehouse.emit logging failed:", logErr);
            }
        } catch (err) {
            // don't allow event emission errors to crash
            console.error("Warehouse.emit failed:", err);
        }
    }

    onEvent(cb: (ev: WarehouseEvent) => void): void {
        this.emitter.on(cb);
    }

    // ---------- Public API (validator-only) ----------

    async unload(): Promise<PackagePublic | null> {
        if (this.isHalted) {
            throw new Error(`Execution terminated due to excessive errors (${this.errorCount}/${MAX_ERRORS})`);
        }

        // Find the next package that is still on the deck and not already being unloaded.
        const recordCandidate = Array.from(this.packageRecords.values()).find(
            (p) => p.status === "on_deck",
        );
        if (!recordCandidate) return null;

        // Validate intake concurrency (simultaneous unloaders) and physical intake capacity.
        // Capacity includes: already on belt (intake) + currently being unloaded (activeUnloaders)
        const intakeOnBelt = Array.from(this.packageRecords.values()).filter(
            (p) => p.location === "intake",
        ).length;

        if (this.activeUnloaders >= INTAKE_CONCURRENCY) {
            const msg = `unload: intake concurrency exceeded (${INTAKE_CONCURRENCY})`;
            this.emit("ERROR", { metadata: { message: msg } });
            await delay(TRANSIENT_PENALTY_MS);
            throw new Error(msg);
        }

        if (intakeOnBelt + this.activeUnloaders >= INTAKE_CAPACITY) {
            const msg = `unload: intake queue full (${INTAKE_CAPACITY})`;
            this.emit("ERROR", {
                metadata: {
                    message: msg,
                    intakeCount: intakeOnBelt + this.activeUnloaders,
                },
            });
            await delay(TRANSIENT_PENALTY_MS);
            throw new Error(msg);
        }

        const pkgId = recordCandidate.id;
        const rec = this.packageRecords.get(pkgId)!;
        
        // Mark as unloading to prevent duplicate selection
        rec.status = "unloading";
        this.activeUnloaders++;
        
        if (!this.firstUnloadTimestamp)
            this.firstUnloadTimestamp = performance.now();

        // Simulate unload
        this.emit("INTAKE_START", {
            packageId: pkgId,
            metadata: { unloadMs: UNLOAD_MS },
        });
        try {
            await delay(UNLOAD_MS);
            if (this.isHalted) return null;

            // Update package to intake
            rec.location = "intake";
            rec.status = "in_intake";
            rec.timestamps.unloadedAt = performance.now();

            // compute intake queue length after placing this package on the belt
            const queueLengthAfter = Array.from(
                this.packageRecords.values(),
            ).filter((p) => p.location === "intake").length;
            this.emit("INTAKE_DONE", {
                packageId: pkgId,
                metadata: { unloadMs: UNLOAD_MS, queueLengthAfter },
            });

            // Return PublicPackage only
            const publicPkg: PackagePublic = {
                id: pkgId,
                processingTime: rec.processingTime,
            };
            return publicPkg;
        } catch (err) {
            // Revert status if unload failed (unless halted)
            if (!this.isHalted) {
                rec.status = "on_deck";
                this.emit("ERROR", { metadata: { message: String(err) } });
            }
            throw err;
        } finally {
            this.activeUnloaders = Math.max(0, this.activeUnloaders - 1);
        }
    }

    async pushToProcessingLine(
        packageId: number,
        processingLineId: ProcessingLineId,
    ): Promise<void> {
        if (this.isHalted) {
            throw new Error(`Execution terminated due to excessive errors (${this.errorCount}/${MAX_ERRORS})`);
        }
        // Basic validations
        const rec = this.packageRecords.get(packageId);
        if (!rec) {
            const msg = `pushToProcessingLine: unknown package ${packageId}`;
            this.emit("ERROR", {
                packageId,
                metadata: { message: msg },
            });
            throw new Error(msg);
        }
        if (processingLineId < 0 || processingLineId > 2) {
            const msg = `pushToProcessingLine: invalid processingLineId ${processingLineId}`;
            this.emit("ERROR", {
                packageId,
                metadata: { message: msg },
            });
            throw new Error(msg);
        }
        // Validate location/status
        if (!(rec.location === "intake" && rec.status === "in_intake")) {
            const msg = `pushToProcessingLine: package ${packageId} not in intake state (location=${rec.location} status=${rec.status})`;
            this.emit("ERROR", {
                packageId,
                processingLineId,
                metadata: { message: msg },
            });
            throw new Error(msg);
        }

        // Check capacity (actual in queue + pending pushes)
        const queue = this.processingQueues[processingLineId];
        const pending = this.pendingProcessingCounts[processingLineId];
        if (queue.length + pending >= PROCESSING_LINE_CAPACITY) {
            const msg = `pushToProcessingLine: processingLine ${processingLineId} is full (${PROCESSING_LINE_CAPACITY})`;
            this.emit("ERROR", {
                packageId,
                processingLineId,
                metadata: { message: msg, queueLength: queue.length, pending },
            });
            await delay(TRANSIENT_PENALTY_MS);
            throw new Error(msg); // Throw after penalty delay
        }

        // Reserve slot
        this.pendingProcessingCounts[processingLineId]++;

        // Simulate induction delay
        this.emit("INDUCTION_START", {
            packageId,
            processingLineId,
            metadata: { pushMs: PUSH_MS },
        });
        try {
            await delay(PUSH_MS);
            if (this.isHalted) return;

            // enqueued - atomically transition from pending to actual queue
            queue.push(packageId);
            rec.location =
                `processingLine${processingLineId}` as LocationString;
            rec.lineId = processingLineId;
            rec.timestamps.pushedAt = performance.now();
            this.emit("INDUCTION_DONE", {
                packageId,
                processingLineId,
                metadata: { queueLengthAfter: queue.length, pushMs: PUSH_MS },
            });
        } catch (err) {
            if (!this.isHalted) {
                this.emit("ERROR", {
                    packageId,
                    processingLineId,
                    metadata: { message: String(err) },
                });
            }
            throw err;
        } finally {
            this.pendingProcessingCounts[processingLineId] = Math.max(
                0,
                this.pendingProcessingCounts[processingLineId] - 1,
            );
        }
    }

    async processPackage(
        packageId: number,
        processingLineId: ProcessingLineId,
    ): Promise<void> {
        if (this.isHalted) {
            throw new Error(`Execution terminated due to excessive errors (${this.errorCount}/${MAX_ERRORS})`);
        }
        const rec = this.packageRecords.get(packageId);
        if (!rec) {
            const msg = `process: unknown package ${packageId}`;
            this.emit("ERROR", {
                packageId,
                processingLineId,
                metadata: { message: msg },
            });
            throw new Error(msg);
        }

        // Validate package is on the requested line
        if (
            !(
                rec.lineId === processingLineId &&
                rec.location === `processingLine${processingLineId}`
            )
        ) {
            const msg = `process: package ${packageId} not on processingLine ${processingLineId} (location=${rec.location})`;
            this.emit("ERROR", {
                packageId,
                processingLineId,
                metadata: { message: msg },
            });
            throw new Error(msg);
        }

        // status check - can only process packages that were pushed to line
        if (rec.status !== "in_intake") {
             const msg = `process: package ${packageId} is in state: ${rec.status}`;
             this.emit("ERROR", {
                 packageId,
                 processingLineId,
                 metadata: { message: msg },
             });
             throw new Error(msg);
        }

        // station busy check
        if (this.processingBusy[processingLineId]) {
            const msg = `process: processing station ${processingLineId} is busy`;
            this.emit("ERROR", {
                packageId,
                processingLineId,
                metadata: { message: msg },
            });
            await delay(RESOURCE_PENALTY_MS);
            throw new Error(msg);
        }

        // Acquire station (validator-only: we just set busy)
        this.processingBusy[processingLineId] = true;

        // update rec to processing status
        // Use a temporary status to indicate in-progress
        const originalStatus = rec.status;
        rec.status = "processing"; 
        rec.timestamps.processingStartedAt = performance.now();

        this.emit("PROCESS_START", {
            packageId,
            processingLineId,
            metadata: { processingMs: rec.processingTime },
        });

        try {
            await delay(rec.processingTime);
            if (this.isHalted) {
                rec.status = originalStatus;
                return;
            }

            rec.status = "processed";

            this.emit("PROCESS_DONE", {
                packageId,
                processingLineId,
                metadata: { processingMs: rec.processingTime },
            });
        } catch (err) {
            if (!this.isHalted) {
                rec.status = originalStatus;
                this.emit("ERROR", {
                    packageId,
                    processingLineId,
                    metadata: { message: String(err) },
                });
            }
            throw err;
        } finally {
            this.processingBusy[processingLineId] = false;
        }
    }

    async print(
        packageId: number,
        processingLineId: ProcessingLineId,
    ): Promise<ShippingLine> {
        if (this.isHalted) {
            throw new Error(`Execution terminated due to excessive errors (${this.errorCount}/${MAX_ERRORS})`);
        }
        const rec = this.packageRecords.get(packageId);
        if (!rec) {
            const msg = `print: unknown package ${packageId}`;
            this.emit("ERROR", {
                packageId,
                processingLineId,
                metadata: { message: msg },
            });
            throw new Error(msg);
        }

        // Validate that the package is processed and on the given line
        if (
            !(
                rec.lineId === processingLineId &&
                rec.location === `processingLine${processingLineId}` &&
                rec.status === "processed"
            )
        ) {
            const msg = `print: package ${packageId} not ready for printing at processingLine ${processingLineId} (location=${rec.location} status=${rec.status})`;
            this.emit("ERROR", {
                packageId,
                processingLineId,
                metadata: { message: msg },
            });
            throw new Error(msg);
        }

        // Head of line check for printing
        const queue = this.processingQueues[processingLineId];
        if (queue.length === 0 || queue[0] !== packageId) {
             const msg = `print: package ${packageId} is not at head of processingLine ${processingLineId}`;
             this.emit("ERROR", {
                 packageId,
                 processingLineId,
                 metadata: { message: msg },
             });
             throw new Error(msg);
        }

        if (this.printerBusy) {
            const msg = `print: printer busy`;
            this.emit("ERROR", {
                packageId,
                processingLineId,
                metadata: { message: msg },
            });
            await delay(RESOURCE_PENALTY_MS);
            throw new Error(msg);
        }

        // compute travel penalty
        const travelPenalty =
            this.printerPosition === processingLineId ? 0 : PRINT_TRAVEL_MS;
        this.printerBusy = true;
        this.emit("PRINTER_MOVE_START", {
            packageId,
            processingLineId,
            metadata: {
                from: this.printerPosition,
                to: processingLineId,
                travelMs: travelPenalty,
            },
        });

        try {
            // move (simulate travel) if needed
            if (travelPenalty > 0) {
                await delay(travelPenalty);
                if (this.isHalted) throw new Error("Warehouse Halted");
            }
            this.printerPosition = processingLineId;
            this.emit("PRINTER_MOVE_DONE", {
                packageId,
                processingLineId,
                metadata: {
                    atPrinterLine: this.printerPosition,
                    travelMs: travelPenalty,
                },
            });

            // actual print
            this.emit("PRINT_START", {
                packageId,
                processingLineId,
                metadata: {
                    atPrinterLine: this.printerPosition,
                    printMs: PRINT_BASE_MS,
                    travelMs: travelPenalty,
                },
            });
            await delay(PRINT_BASE_MS);
            if (this.isHalted) throw new Error("Warehouse Halted");

            // set private status and return target lane
            rec.status = "labeled";
            rec.timestamps.printedAt = performance.now();

            const lane = rec.targetLane;
            this.emit("PRINT_SUCCESS", {
                packageId,
                processingLineId,
                shippingLine: lane,
                metadata: {
                    printMs: PRINT_BASE_MS,
                    travelMs: travelPenalty,
                    atPrinterLine: this.printerPosition,
                },
            });

            return lane;
        } catch (err) {
            if (!this.isHalted) {
                this.emit("ERROR", {
                    packageId,
                    processingLineId,
                    metadata: { message: String(err) },
                });
            }
            throw err;
        } finally {
            this.printerBusy = false;
        }
    }

    async ship(packageId: number, shippingLine: ShippingLine): Promise<void> {
        if (this.isHalted) {
            throw new Error(`Execution terminated due to excessive errors (${this.errorCount}/${MAX_ERRORS})`);
        }
        const rec = this.packageRecords.get(packageId);
        if (!rec) {
            const msg = `ship: unknown package ${packageId}`;
            this.emit("ERROR", { packageId, metadata: { message: msg } });
            throw new Error(msg);
        }

        // Validate labeled and handshake
        if (rec.status !== "labeled") {
            const msg = `ship: package ${packageId} is in state: ${rec.status} (expected labeled)`;
            this.emit("ERROR", { packageId, metadata: { message: msg } });
            throw new Error(msg);
        }
        if (rec.targetLane !== shippingLine) {
            const msg = `ship: package ${packageId} target lane mismatch (expected=${rec.targetLane} provided=${shippingLine})`;
            this.emit("ERROR", {
                packageId,
                shippingLine,
                metadata: { message: msg },
            });
            throw new Error(msg);
        }

        // Validate head-of-line on processing line
        const procLineId = rec.lineId;
        if (procLineId === undefined) {
             const msg = `ship: package ${packageId} has no lineId`;
             this.emit("ERROR", { packageId, metadata: { message: msg } });
             throw new Error(msg);
        }
        const procQueue = this.processingQueues[procLineId];
        if (procQueue.length === 0 || procQueue[0] !== packageId) {
             const msg = `ship: package ${packageId} is not at head of processingLine ${procLineId}`;
             this.emit("ERROR", {
                 packageId,
                 processingLineId: procLineId,
                 metadata: { message: msg },
             });
             throw new Error(msg);
        }

        const queue = this.shippingQueues[shippingLine];
        if (!queue) {
            const msg = `ship: unknown shippingLine ${shippingLine}`;
            this.emit("ERROR", {
                packageId,
                shippingLine,
                metadata: { message: msg },
            });
            throw new Error(msg);
        }

        // capacity check
        if (queue.length >= SHIPPING_LINE_CAPACITY) {
            const msg = `ship: shippingLine ${shippingLine} is full (${SHIPPING_LINE_CAPACITY})`;
            this.emit("ERROR", {
                packageId,
                shippingLine,
                metadata: { message: msg, queueLength: queue.length },
            });
            await delay(TRANSIENT_PENALTY_MS);
            throw new Error(msg); // Throw after penalty delay
        }

        // enqueue quickly and return
        try {
            await delay(SHIP_ENQUEUE_MS);
            if (this.isHalted) return;

            // Shift from processing queue ONLY NOW
            procQueue.shift();

            queue.push(packageId);
            rec.location =
                shippingLine === "North"
                    ? "shippingLineNorth"
                    : shippingLine === "South"
                      ? "shippingLineSouth"
                      : "shippingLineInternational";
            // rec.status remains "printed" or set to intermediate if desired
            this.emit("SHIP_ENQUEUED", {
                packageId,
                shippingLine,
                metadata: {
                    queueLength: queue.length,
                    enqueueMs: SHIP_ENQUEUE_MS,
                },
            });
            return;
        } catch (err) {
            if (!this.isHalted) {
                this.emit("ERROR", {
                    packageId,
                    shippingLine,
                    metadata: { message: String(err) },
                });
            }
            throw err;
        }
    }

    // Minimal inspection helper
    getShippingLineQueueLength(shippingLine: ShippingLine): number {
        const q = this.shippingQueues[shippingLine];
        return q ? q.length : 0;
    }

    // Optional state snapshot for UI / debugging
    getState() {
        return {
            processedCount: this.processedCount,
            shipQueueLengths: {
                North: this.shippingQueues["North"].length,
                South: this.shippingQueues["South"].length,
                International: this.shippingQueues["International"].length,
            },
            timestamps: {
                firstUnload: this.firstUnloadTimestamp,
                lastShip: this.lastShipTimestamp,
            },
        };
    }

    // ---------- Shipping background processors ----------
    private startShippingProcessors() {
        this.shippingRunning = true;
        const schedule = async (line: ShippingLine) => {
            while (this.shippingRunning && !this.isHalted) {
                const q = this.shippingQueues[line];
                if (!q || q.length === 0) {
                    await delay(50);
                    continue;
                }
                // pop head and process
                const packageId = q.shift()!;
                this.emit("SHIP_START", {
                    packageId,
                    shippingLine: line,
                    metadata: {
                        queueLength: q.length,
                        shipRemoveMs: SHIP_REMOVE_INTERVAL_MS,
                    },
                });
                try {
                    await delay(SHIP_REMOVE_INTERVAL_MS);
                    if (!this.shippingRunning || this.isHalted) return;
                    // mark shipped
                    const rec = this.packageRecords.get(packageId);
                    if (rec) {
                        rec.status = "shipped";
                        rec.location = "shipped";
                        rec.timestamps.shippedAt = performance.now();
                    }
                    this.processedCount++;
                    this.lastShipTimestamp = performance.now();
                    this.emit("SHIP_COMPLETE", {
                        packageId,
                        shippingLine: line,
                        metadata: {
                            processedCount: this.processedCount,
                            shipRemoveMs: SHIP_REMOVE_INTERVAL_MS,
                        },
                    });

                    // If we just shipped the last package (99), the run is effectively complete.
                    // Emit a definitive COMPLETED event with final metrics.
                    if (packageId === 99 && this.firstUnloadTimestamp) {
                        const finalDurationMs = this.lastShipTimestamp - this.firstUnloadTimestamp;
                        const finalUPM = Math.floor((100 / (finalDurationMs / 60000)) * 10) / 10;
                        this.emit("COMPLETED" as any, {
                            metadata: {
                                finalDuration: finalDurationMs,
                                finalUPM,
                                processedCount: this.processedCount,
                            },
                        });
                    }
                } catch (err) {
                    if (!this.shippingRunning || this.isHalted) return;
                    this.emit("ERROR", {
                        packageId,
                        shippingLine: line,
                        metadata: { message: String(err) },
                    });
                }
            }
        };

        schedule("North");
        schedule("South");
        schedule("International");
    }

    private stopShippingProcessors() {
        this.shippingRunning = false;
    }

    // ---------- Heartbeat ----------
    private startHeartbeat() {
        if (this.heartbeatTimer) return;
        this.heartbeatTimer = setInterval(() => {
            if (this.isHalted) {
                this.stopHeartbeat();
                return;
            }
            this.emit("HEARTBEAT", {});
        }, 500);
    }

    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }
    }

    // ---------- Shutdown ----------
    dispose() {
        this.stopHeartbeat();
        this.stopShippingProcessors();
        this.emitter.clear?.();
    }
}

/** Factory */
export function createWarehouse(
    deck?: Array<{ id?: number } | number>,
): WarehouseAPI {
    return new Warehouse(deck);
}

export default createWarehouse;
