/**
 * Optimized JS runner for the Concurrency Arena.
 *
 * Strategy summary (see top of file for tunables):
 * - Parallel unloaders limited by a Semaphore to respect `unload()` concurrency.
 * - Internal bounded queue to decouple intake from processing.
 * - Worker pool that performs push->process->print->ship pipeline.
 * - PrinterCoordinator serializes `print()` calls and batches by target line
 *   to reduce printer travel.
 * - Retries with exponential backoff for transient ship/queue errors.
 *
 * Drop this file into the editor examples and run it as the challenge script.
 */

/* Tunable parameters */
const TOTAL_PACKAGES = 100; // set to the number of packages in the run
const WORKER_COUNT = 6;
const INTAKE_CONCURRENCY = 4; // matches warehouse intake limit
const MAX_PHYSICAL_INTAKE = 8; // soft backpressure threshold for in-flight packages
const INTERNAL_QUEUE_CAPACITY = 64;
const PRINTER_BATCH_SIZE = 4; // attempt short batches when consecutive same-line prints
const DEBUG_PRINTER = true;
const SHIP_RETRY_BASE_MS = 200;
const SHIP_RETRY_MAX_MS = 2000;
const DEBUG_WORKER = true;
const DEBUG_LINE = true;

/* --- Concurrency primitives --- */
class Semaphore {
    constructor(max) {
        this.max = max;
        this.current = 0;
        this.waiters = [];
    }
    async acquire() {
        if (this.current < this.max) {
            this.current++;
            return;
        }
        await new Promise((res) => this.waiters.push(res));
        this.current++;
    }
    release() {
        this.current = Math.max(0, this.current - 1);
        if (this.waiters.length > 0) {
            const next = this.waiters.shift();
            next();
        }
    }
}

class Mutex {
    constructor() {
        this.sem = new Semaphore(1);
    }
    lock() {
        return this.sem.acquire();
    }
    unlock() {
        this.sem.release();
    }
}

class BoundedQueue {
    constructor(capacity) {
        this.capacity = capacity;
        this.buf = [];
        this.waiters = [];
    }
    size() {
        return this.buf.length;
    }
    async push(item) {
        while (this.buf.length >= this.capacity) {
            await new Promise((res) => this.waiters.push(res));
        }
        this.buf.push(item);
    }
    shift() {
        const v = this.buf.shift();
        if (this.waiters.length > 0) {
            const next = this.waiters.shift();
            next();
        }
        return v;
    }
}

/* --- Printer coordinator --- */
class PrinterCoordinator {
    constructor(batchSize = PRINTER_BATCH_SIZE) {
        this.queue = [];
        this.running = false;
        this.batchSize = batchSize;
    }

    // Enqueue a print request and return a promise that resolves to the shipping lane
    printRequest(pkgId, lineId) {
        return new Promise((resolve, reject) => {
            this.queue.push({ pkgId, lineId, resolve, reject });
            if (DEBUG_PRINTER)
                console.log(
                    "printer: queued",
                    pkgId,
                    lineId,
                    "queueLen=",
                    this.queue.length,
                );
            if (!this.running) this._runLoop();
        });
    }

    async _runLoop() {
        this.running = true;
        while (this.queue.length > 0) {
            // Wait a short moment to allow other workers to enqueue print requests.
            // This lets us form larger batches for the most-common target line.
            await new Promise((r) => setTimeout(r, 5));
            if (DEBUG_PRINTER)
                console.log(
                    "printer: runLoop start queueLen=",
                    this.queue.length,
                );

            // Count requests per line and pick the line with the most pending requests.
            const counts = Object.create(null);
            for (const item of this.queue) {
                const lid = String(item.lineId);
                counts[lid] = (counts[lid] || 0) + 1;
            }

            // Choose best target line (most queued requests). Fallback to first item's line.
            let targetLine = this.queue[0].lineId;
            let maxCount = counts[String(targetLine)] || 0;
            for (const k in counts) {
                if (counts[k] > maxCount) {
                    maxCount = counts[k];
                    targetLine = Number(k);
                }
            }

            const batch = [];
            // gather up to batchSize requests for the chosen line
            for (
                let i = 0;
                i < this.queue.length && batch.length < this.batchSize;
            ) {
                if (this.queue[i].lineId === targetLine) {
                    batch.push(this.queue.splice(i, 1)[0]);
                } else {
                    i++;
                }
            }

            // If no same-line batch found (unlikely), pop one request
            if (batch.length === 0) batch.push(this.queue.shift());

            // Execute prints sequentially for this batch (printer must visit line)
            for (const req of batch) {
                try {
                    if (DEBUG_PRINTER)
                        console.log("printer: printing", req.pkgId, req.lineId);
                    const lane = await warehouse.print(req.pkgId, req.lineId);
                    if (DEBUG_PRINTER)
                        console.log("printer: printed", req.pkgId, "->", lane);
                    req.resolve(lane);
                } catch (err) {
                    if (DEBUG_PRINTER)
                        console.log("printer: print error", req.pkgId, err);
                    req.reject(err);
                }
            }
        }
        this.running = false;
    }
}

/* --- Helper: exponential backoff with jitter --- */
function backoffDelay(
    attempt,
    base = SHIP_RETRY_BASE_MS,
    max = SHIP_RETRY_MAX_MS,
) {
    const t = Math.min(max, base * 2 ** attempt);
    // jitter between 0.5x and 1.5x
    const jitter = 0.5 + Math.random();
    return Math.floor(t * jitter);
}

/* --- Runner implementation --- */
async function optimizedRun() {
    const semIntake = new Semaphore(INTAKE_CONCURRENCY);
    const internalQ = new BoundedQueue(INTERNAL_QUEUE_CAPACITY);
    const printer = new PrinterCoordinator();
    const stationLocks = [new Mutex(), new Mutex(), new Mutex()];
    // per-line push locks to serialize pushToProcessingLine ordering
    const pushLocks = [new Mutex(), new Mutex(), new Mutex()];

    let unloaded = 0;
    let finished = 0;
    let shippedCount = 0;
    let printerVisits = 0;

    const startTime = Date.now();

    const seen = new Set();

    async function unloader(id) {
        while (true) {
            if (unloaded >= TOTAL_PACKAGES) break;
            // simple in-flight backpressure
            const inFlight = unloaded - finished;
            if (inFlight >= MAX_PHYSICAL_INTAKE) {
                await new Promise((r) => setTimeout(r, 100));
                continue;
            }

            await semIntake.acquire();
            try {
                const pkg = await warehouse.unload();
                if (!pkg) {
                    break;
                }

                // Deduplicate packages in case the runtime returns duplicates.
                if (seen.has(pkg.id)) {
                    // skip duplicates
                } else {
                    seen.add(pkg.id);
                    unloaded++;
                    await internalQ.push(pkg);
                }
            } catch (err) {
                // Intake errors: pause briefly and retry
                await new Promise((r) => setTimeout(r, 200));
            } finally {
                semIntake.release();
            }
        }
    }

    async function worker(workerId) {
        while (true) {
            if (finished >= TOTAL_PACKAGES) break;
            const pkg = internalQ.shift();
            if (!pkg) {
                await new Promise((r) => setTimeout(r, 100));
                continue;
            }

            if (DEBUG_WORKER)
                console.log(
                    `[worker ${workerId}] dequeue pkg=${pkg.id} internalQsize=${internalQ.size()}`,
                );

            try {
                const lineId = pkg.id % 3;

                // Serialize pushing order per-line to keep the warehouse queue predictable.
                await pushLocks[lineId].lock();
                try {
                    if (DEBUG_WORKER)
                        console.log(
                            `[worker ${workerId}] pushing pkg=${pkg.id} to line=${lineId}`,
                        );
                    await warehouse.pushToProcessingLine(pkg.id, lineId);
                    if (DEBUG_WORKER)
                        console.log(
                            `[worker ${workerId}] pushed pkg=${pkg.id} to line=${lineId}`,
                        );

                    // Immediately process here to respect head-of-line semantics.
                    if (DEBUG_WORKER)
                        console.log(
                            `[worker ${workerId}] processing pkg=${pkg.id} on line=${lineId}`,
                        );
                    await warehouse.processPackage(pkg.id, lineId);
                    if (DEBUG_WORKER)
                        console.log(
                            `[worker ${workerId}] processed pkg=${pkg.id} on line=${lineId}`,
                        );
                } finally {
                    pushLocks[lineId].unlock();
                }

                // Ask printer coordinator to print and get shipping lane
                const lane = await printer.printRequest(pkg.id, lineId);
                printerVisits++;

                // Ship with retries on lane-full
                let attempt = 0;
                while (true) {
                    try {
                        await warehouse.ship(pkg.id, lane);
                        shippedCount++;
                        break;
                    } catch (err) {
                        // transient lane full — backoff and retry
                        const delayMs = backoffDelay(attempt++);
                        await new Promise((r) => setTimeout(r, delayMs));
                    }
                }

                finished++;
            } catch (err) {
                // Worker-level error: log and continue
                console.error(
                    `[worker ${workerId}] failed pkg ${pkg?.id}:`,
                    err?.message ?? err,
                );
            }
        }
    }

    // (processing handled inline in workers to respect warehouse head-of-line semantics)

    // Spawn actors
    const unloaders = Array.from({ length: INTAKE_CONCURRENCY }, (_, i) =>
        unloader(i),
    );
    const workers = Array.from({ length: WORKER_COUNT }, (_, i) => worker(i));

    await Promise.all([...unloaders, ...workers]);

    const elapsed = Date.now() - startTime;
    console.log(
        `Finished. elapsed=${elapsed}ms shipped=${shippedCount} printerVisits=${printerVisits}`,
    );
}

// Execute immediately when run inside the worker (top-level await supported by runner)
await optimizedRun();
await Promise.all([...unloaders, ...workers]);
