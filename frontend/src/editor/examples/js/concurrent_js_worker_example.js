/**
 * Concurrent JS example for the Concurrency Arena.
 *
 * This example demonstrates the use of Locks (Mutexes) to coordinate access
 * to shared physical resources and internal data structures.
 *
 * Architectural Patterns:
 *  1. Parallel Intake: Runs multiple concurrent unloaders.
 *  2. Worker Pool: Multiple workers processing packages in parallel.
 *  3. Critical Sections: Uses a lock for the internal queue to prevent race conditions.
 *  4. Resource Locking: Prevents "Printer Busy" and "Station Busy" errors.
 */

const TOTAL_PACKAGES = 100;
const CONCURRENCY = 6;
const INTAKE_CONCURRENCY = 4;

const queue = [];
let itemsUnloaded = 0;
let itemsFinished = 0;

/**
 * Simple Mutex implementation for the JS environment.
 */
class Mutex {
    constructor() {
        this.locked = false;
        this.waiting = [];
    }
    async lock() {
        if (this.locked) {
            await new Promise((res) => this.waiting.push(res));
        }
        this.locked = true;
    }
    unlock() {
        this.locked = false;
        if (this.waiting.length > 0) {
            const next = this.waiting.shift();
            next();
        }
    }
}

// Internal State Lock
const queueLock = new Mutex();

// Physical Resource Locks
const printerLock = new Mutex();
const stationLocks = [new Mutex(), new Mutex(), new Mutex()];

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * Intake Loop using parallel unloaders.
 * The lock MUST be held during the warehouse.unload() call to ensure
 * no two unloaders receive the same package reference from the deck.
 */
async function intakeLoop() {
    const unloader = async () => {
        while (true) {
            let pkg = null;

            // Critical Section: Acquire the next package from the warehouse deck
            await queueLock.lock();
            try {
                if (itemsUnloaded >= TOTAL_PACKAGES) {
                    break;
                }

                // We call unload() while holding the lock to prevent other
                // unloaders from overlapping and getting the same ID.
                pkg = await warehouse.unload();
                if (pkg) {
                    itemsUnloaded++;
                    queue.push(pkg);
                }
            } catch (err) {
                // If intake is full, we release and wait
                await delay(100);
            } finally {
                queueLock.unlock();
            }

            if (!pkg && itemsUnloaded >= TOTAL_PACKAGES) break;
            if (!pkg) await delay(50);
        }
    };

    const unloaders = Array.from({ length: INTAKE_CONCURRENCY }, unloader);
    await Promise.all(unloaders);
}

/**
 * Worker logic with resource coordination.
 */
async function worker(workerId) {
    while (true) {
        let pkg = null;

        // Critical Section: Get work from the internal queue
        await queueLock.lock();
        try {
            if (itemsFinished >= TOTAL_PACKAGES) {
                break;
            }
            pkg = queue.shift();
        } finally {
            queueLock.unlock();
        }

        if (!pkg) {
            await delay(100);
            continue;
        }

        try {
            // 1. Choose a processing line
            const lineId = pkg.id % 3;

            // 2. Induction & Processing (Station Lock)
            await stationLocks[lineId].lock();
            try {
                await warehouse.pushToProcessingLine(pkg.id, lineId);
                await warehouse.processPackage(pkg.id, lineId);
            } finally {
                stationLocks[lineId].unlock();
            }

            // 3. Printing (Global Printer Lock)
            await printerLock.lock();
            let shippingLine;
            try {
                shippingLine = await warehouse.print(pkg.id, lineId);
            } finally {
                printerLock.unlock();
            }

            // 4. Shipping (Backpressure loop)
            let shipped = false;
            while (!shipped) {
                try {
                    await warehouse.ship(pkg.id, shippingLine);
                    shipped = true;
                } catch (err) {
                    await delay(500);
                }
            }

            // Mark as finished under lock
            await queueLock.lock();
            itemsFinished++;
            queueLock.unlock();
        } catch (err) {
            console.error(
                `[Worker ${workerId}] Error on pkg ${pkg?.id}:`,
                err.message,
            );
        }
    }
}

async function runConcurrent() {
    console.log(
        `Starting concurrent run with ${CONCURRENCY} workers and ${INTAKE_CONCURRENCY} parallel unloaders...`,
    );

    // Start background intake and worker pool
    const intakePromise = intakeLoop();
    const workerPromises = Array.from({ length: CONCURRENCY }, (_, i) =>
        worker(i),
    );

    await Promise.all([intakePromise, ...workerPromises]);
    console.log("--- All packages processed concurrently! ---");
}

await runConcurrent();
