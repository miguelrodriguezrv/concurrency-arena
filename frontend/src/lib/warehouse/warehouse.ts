/**
 * Validator-only Warehouse runtime implementation.
 *
 * Implements the Warehouse API described in WAREHOUSE_SPECIFICATION.md:
 * - Validator-only: calls immediately throw (and emit ERROR) on rule violations.
 * - Minimal inspection API: getShippingLaneQueueLength(...)
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
    ShippingLane,
    ProcessingLineId,
} from "./types";

/**
 * Timings (in "game" milliseconds). Real waiting time = game time / speed.
 * Tuned with scripts/simulate.ts so that both pipelining and printer batching
 * pay off. See RULES.md for the student-facing table.
 */
export interface WarehouseTimings {
    unloadMs: number;
    pushMs: number;
    /** Normal packages: processingTime in [min, max]. */
    processingMinMs: number;
    processingMaxMs: number; // inclusive
    /** Fraction of the deck that are slow packages (0..1). */
    slowFraction: number;
    /** Slow packages: processingTime in [slowMin, slowMax]. */
    slowMinMs: number;
    slowMaxMs: number;
    printMs: number;
    printerTravelMs: number;
    shipEnqueueMs: number;
    /** Each shipping lane loads one package into its truck every N ms. */
    shipLoadMs: number;
    /** Extra wait before a capacity rejection is thrown (bays, belt, line, lane full). */
    capacityPenaltyMs: number;
    /** Extra wait before a busy rejection is thrown (station, printer). */
    busyPenaltyMs: number;
}

export const DEFAULT_TIMINGS: WarehouseTimings = {
    unloadMs: 600,
    pushMs: 80,
    processingMinMs: 500,
    processingMaxMs: 1700,
    slowFraction: 0.1,
    slowMinMs: 4000,
    slowMaxMs: 6000,
    printMs: 250,
    printerTravelMs: 900,
    shipEnqueueMs: 80,
    shipLoadMs: 1400,
    capacityPenaltyMs: 800,
    busyPenaltyMs: 400,
};

export interface WarehouseOptions {
    /** Simulation speed multiplier (1 = normal, 2 = twice as fast, ...). */
    speed?: number;
    /** Override timings (tuning / tests only). */
    timings?: Partial<WarehouseTimings>;
}

const INTAKE_CONCURRENCY = 4;
const INTAKE_CAPACITY = 8;
const PROCESSING_LINE_CAPACITY = 5;
const SHIPPING_LANE_CAPACITY = 4;

/** Public, read-only view of the limits so the UI can display them. */
export const WAREHOUSE_LIMITS = {
    intakeBays: INTAKE_CONCURRENCY,
    intakeBelt: INTAKE_CAPACITY,
    processingLine: PROCESSING_LINE_CAPACITY,
    shippingLane: SHIPPING_LANE_CAPACITY,
} as const;

/** Penalties and Error Limits */
const MAX_ERRORS = 100;

/** Max time to wait for in-flight work to settle after the student's code returns. */
const SETTLE_TIMEOUT_MS = 60000;

/** Verbose per-event console.debug logging (dev only). */
const DEBUG_EVENT_LOGS =
    import.meta.env?.VITE_WAREHOUSE_DEBUG !== undefined
        ? import.meta.env.VITE_WAREHOUSE_DEBUG === "true"
        : !!import.meta.env?.DEV;

export interface RunSummary {
    total: number;
    shipped: number;
    stranded: number[];
    /** Unloaded but never shipped (left somewhere inside the warehouse). */
    stuck: number[];
    /** Never unloaded from the trucks. */
    notUnloaded: number;
    complete: boolean;
    halted: boolean;
}

/** Utility delay */
const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

/** Internal representation of a package */
type LocationString =
    | "deck"
    | "intake"
    | "processingLine0"
    | "processingLine1"
    | "processingLine2"
    | "shippingLaneNorth"
    | "shippingLaneSouth"
    | "shippingLaneInternational"
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
    targetLane: ShippingLane; // private
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

/** Deterministic integer hash (so every participant gets the same deck). */
function hash32(n: number, salt: number): number {
    let x = (n + 1) * 0x9e3779b1 + salt * 0x85ebca6b;
    x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
    x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
    return (x ^ (x >>> 16)) >>> 0;
}

/**
 * Deterministic processingTime, rounded to 10 ms. Most packages are "normal";
 * a fraction (slowFraction) are much slower, which rewards routing decisions.
 */
function deterministicProcessingTime(id: number, t: WarehouseTimings): number {
    const pick = (hash32(id, 1) % 100000) / 99999;
    const pos = (hash32(id, 3) % 100000) / 99999;
    const [lo, hi] =
        pick < t.slowFraction
            ? [t.slowMinMs, t.slowMaxMs]
            : [t.processingMinMs, t.processingMaxMs];
    return Math.round((lo + pos * (hi - lo)) / 10) * 10;
}

const LANES: ShippingLane[] = ["North", "South", "International"];

/** Deterministic shipping lane, independent of the package id pattern. */
function deterministicTargetLane(id: number): ShippingLane {
    return LANES[hash32(id, 2) % 3];
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
    private shippingQueues: Record<ShippingLane, number[]> = {
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

    // In-flight shipping work (used to detect when the warehouse is idle)
    private pendingShipEnqueues = 0;
    private shippingInFlight: Record<ShippingLane, boolean> = {
        North: false,
        South: false,
        International: false,
    };
    private completedEmitted = false;

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
    // timing configuration
    private t: WarehouseTimings;
    private speed: number;

    /** Wait `ms` of game time (scaled by speed). */
    private sleep(ms: number) {
        return delay(ms / this.speed);
    }

    constructor(deck?: Array<{ id?: number } | number>, opts: WarehouseOptions = {}) {
        this.t = { ...DEFAULT_TIMINGS, ...(opts.timings ?? {}) };
        this.speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
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
                const processingTime = deterministicProcessingTime(id, this.t);
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
                const processingTime = deterministicProcessingTime(id, this.t);
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

            // Also log a compact debug-friendly representation to the console (dev only).
            if (DEBUG_EVENT_LOGS && ev.type !== "HEARTBEAT") try {
                const p = ev;
                const logEntry = {
                    type: ev.type,
                    timestamp: ev.timestamp,
                    packageId: p.packageId,
                    processingLineId: p.processingLineId,
                    shippingLane: p.shippingLane,
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
            await this.sleep(this.t.capacityPenaltyMs);
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
            await this.sleep(this.t.capacityPenaltyMs);
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
            metadata: { unloadMs: this.t.unloadMs },
        });
        try {
            await this.sleep(this.t.unloadMs);
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
                metadata: { unloadMs: this.t.unloadMs, queueLengthAfter },
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
            await this.sleep(this.t.capacityPenaltyMs);
            throw new Error(msg); // Throw after penalty delay
        }

        // Reserve slot
        this.pendingProcessingCounts[processingLineId]++;

        // Simulate induction delay
        this.emit("INDUCTION_START", {
            packageId,
            processingLineId,
            metadata: { pushMs: this.t.pushMs },
        });
        try {
            await this.sleep(this.t.pushMs);
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
                metadata: { queueLengthAfter: queue.length, pushMs: this.t.pushMs },
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
            await this.sleep(this.t.busyPenaltyMs);
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
            await this.sleep(rec.processingTime);
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
    ): Promise<ShippingLane> {
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
            await this.sleep(this.t.busyPenaltyMs);
            throw new Error(msg);
        }

        // compute travel penalty
        const travelPenalty =
            this.printerPosition === processingLineId ? 0 : this.t.printerTravelMs;
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
                await this.sleep(travelPenalty);
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
                    printMs: this.t.printMs,
                    travelMs: travelPenalty,
                },
            });
            await this.sleep(this.t.printMs);
            if (this.isHalted) throw new Error("Warehouse Halted");

            // set private status and return target lane
            rec.status = "labeled";
            rec.timestamps.printedAt = performance.now();

            const lane = rec.targetLane;
            this.emit("PRINT_SUCCESS", {
                packageId,
                processingLineId,
                shippingLane: lane,
                metadata: {
                    printMs: this.t.printMs,
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

    async ship(packageId: number, shippingLane: ShippingLane): Promise<void> {
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
        if (rec.targetLane !== shippingLane) {
            const msg = `ship: package ${packageId} target lane mismatch (expected=${rec.targetLane} provided=${shippingLane})`;
            this.emit("ERROR", {
                packageId,
                shippingLane,
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

        const queue = this.shippingQueues[shippingLane];
        if (!queue) {
            const msg = `ship: unknown shippingLane ${shippingLane}`;
            this.emit("ERROR", {
                packageId,
                shippingLane,
                metadata: { message: msg },
            });
            throw new Error(msg);
        }

        // capacity check
        if (queue.length >= SHIPPING_LANE_CAPACITY) {
            const msg = `ship: shippingLane ${shippingLane} is full (${SHIPPING_LANE_CAPACITY})`;
            this.emit("ERROR", {
                packageId,
                shippingLane,
                metadata: { message: msg, queueLength: queue.length },
            });
            await this.sleep(this.t.capacityPenaltyMs);
            throw new Error(msg); // Throw after penalty delay
        }

        // enqueue quickly and return
        this.pendingShipEnqueues++;
        try {
            await this.sleep(this.t.shipEnqueueMs);
            if (this.isHalted) return;

            // Shift from processing queue ONLY NOW
            procQueue.shift();

            queue.push(packageId);
            rec.location =
                shippingLane === "North"
                    ? "shippingLaneNorth"
                    : shippingLane === "South"
                      ? "shippingLaneSouth"
                      : "shippingLaneInternational";
            // rec.status remains "printed" or set to intermediate if desired
            this.emit("SHIP_ENQUEUED", {
                packageId,
                shippingLane,
                metadata: {
                    queueLength: queue.length,
                    enqueueMs: this.t.shipEnqueueMs,
                },
            });
            return;
        } catch (err) {
            if (!this.isHalted) {
                this.emit("ERROR", {
                    packageId,
                    shippingLane,
                    metadata: { message: String(err) },
                });
            }
            throw err;
        } finally {
            this.pendingShipEnqueues = Math.max(0, this.pendingShipEnqueues - 1);
        }
    }

    // Minimal inspection helper
    getShippingLaneQueueLength(shippingLane: ShippingLane): number {
        const q = this.shippingQueues[shippingLane];
        return q ? q.length : 0;
    }

    // ---------- End-of-run settlement ----------

    /** True when nothing is moving inside the warehouse anymore. */
    private isIdle(): boolean {
        return (
            this.activeUnloaders === 0 &&
            this.pendingProcessingCounts.every((n) => n === 0) &&
            this.processingBusy.every((b) => !b) &&
            !this.printerBusy &&
            this.pendingShipEnqueues === 0 &&
            Object.values(this.shippingQueues).every((q) => q.length === 0) &&
            Object.values(this.shippingInFlight).every((b) => !b)
        );
    }

    /**
     * Called by the runner once the student's code has returned.
     * Waits for in-flight work (e.g. shipping lanes draining) to finish, then
     * reports whether every package shipped. Emits INCOMPLETE if packages
     * were left behind.
     */
    async settle(timeoutMs = SETTLE_TIMEOUT_MS): Promise<RunSummary> {
        const deadline = performance.now() + timeoutMs;
        while (!this.isHalted && !this.isIdle() && performance.now() < deadline) {
            await delay(50);
        }
        // Give the COMPLETED emission (same tick as the last ship) a chance to land.
        await delay(0);

        const total = this.packageRecords.size;
        const records = Array.from(this.packageRecords.values());
        const stranded = records.filter((p) => p.status !== "shipped").map((p) => p.id);
        const summary: RunSummary = {
            total,
            shipped: this.processedCount,
            stranded,
            stuck: records
                .filter((p) => p.status !== "on_deck" && p.status !== "shipped")
                .map((p) => p.id),
            notUnloaded: records.filter((p) => p.status === "on_deck").length,
            complete: stranded.length === 0,
            halted: this.isHalted,
        };

        if (!summary.complete && !this.isHalted) {
            this.emit("INCOMPLETE", {
                metadata: {
                    shipped: summary.shipped,
                    total,
                    stranded,
                    stuck: summary.stuck,
                    notUnloaded: summary.notUnloaded,
                    message: `${stranded.length} package(s) never shipped`,
                },
            });
        }
        return summary;
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
        const schedule = async (line: ShippingLane) => {
            while (this.shippingRunning && !this.isHalted) {
                const q = this.shippingQueues[line];
                if (!q || q.length === 0) {
                    await this.sleep(25);
                    continue;
                }
                // pop head and process
                const packageId = q.shift()!;
                this.shippingInFlight[line] = true;
                this.emit("SHIP_START", {
                    packageId,
                    shippingLane: line,
                    metadata: {
                        queueLength: q.length,
                        shipRemoveMs: this.t.shipLoadMs,
                    },
                });
                try {
                    await this.sleep(this.t.shipLoadMs);
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
                        shippingLane: line,
                        metadata: {
                            processedCount: this.processedCount,
                            total: this.packageRecords.size,
                            shipRemoveMs: this.t.shipLoadMs,
                        },
                    });

                    // Every package in the deck has shipped: the run is complete.
                    if (
                        !this.completedEmitted &&
                        this.processedCount >= this.packageRecords.size &&
                        this.firstUnloadTimestamp !== undefined
                    ) {
                        this.completedEmitted = true;
                        // Reported in game time so scores are comparable across speeds.
                        const finalDurationMs =
                            (this.lastShipTimestamp - this.firstUnloadTimestamp) * this.speed;
                        const finalUPM =
                            Math.floor((this.processedCount / (finalDurationMs / 60000)) * 10) / 10;
                        this.emit("COMPLETED", {
                            metadata: {
                                finalDuration: finalDurationMs,
                                finalUPM,
                                processedCount: this.processedCount,
                                total: this.packageRecords.size,
                                errorCount: this.errorCount,
                                speed: this.speed,
                            },
                        });
                    }
                } catch (err) {
                    if (!this.shippingRunning || this.isHalted) return;
                    this.emit("ERROR", {
                        packageId,
                        shippingLane: line,
                        metadata: { message: String(err) },
                    });
                } finally {
                    this.shippingInFlight[line] = false;
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
    opts?: WarehouseOptions,
): WarehouseAPI {
    return new Warehouse(deck, opts);
}

export default createWarehouse;
