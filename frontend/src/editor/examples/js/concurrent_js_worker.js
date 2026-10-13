/**
 * Concurrent JS example for the Concurrency Arena.
 *
 * This example demonstrates robust resource coordination and backpressure:
 *  1. Parallel Intake: Uses 4 unloaders to maximize intake concurrency.
 *  2. Intake Backpressure: Checks total packages currently in the system to avoid exceeding the 8-package limit.
 *  3. Worker Pool: Multiple workers draining an internal queue and managing physical locks.
 *  4. Critical Sections: Uses Mutexes for Deck, Internal Queue, Stations, and Printer.
 */

const TOTAL_PACKAGES = 100;
const CONCURRENCY = 6;
const INTAKE_CONCURRENCY = 4;
const MAX_PHYSICAL_INTAKE = 8; // Physical limit of the warehouse intake belt

const queue = [];
let itemsUnloaded = 0;
let itemsFinished = 0;

/**
 * Mutex implementation to synchronize async operations.
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

// Critical section locks
const deckLock = new Mutex(); // Protects warehouse.unload()
const queueLock = new Mutex(); // Protects the JS 'queue' array and counters
const printerLock = new Mutex(); // Protects warehouse.print()
const stationLocks = [new Mutex(), new Mutex(), new Mutex()]; // Protects stations

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * Intake Loop: Pulls packages from the deck and pushes them into the worker queue.
 * Implements backpressure to ensure we don't exceed the warehouse's physical intake capacity.
 */
async function intakeLoop() {
    const unloader = async (id) => {
        while (true) {
            // 1. Check if we are done with the deck
            await queueLock.lock();
            if (itemsUnloaded >= TOTAL_PACKAGES) {
                queueLock.unlock();
                break;
            }

            // 2. BACKPRESSURE: Check how many packages are currently "in flight" (unloaded but not yet finished)
            // If there are too many packages on the belts, we wait before pulling more from the deck.
            const inFlight = itemsUnloaded - itemsFinished;
            if (inFlight >= MAX_PHYSICAL_INTAKE) {
                queueLock.unlock();
                await delay(200);
                continue;
            }
            queueLock.unlock();

            let pkg = null;

            // 3. Acquire from physical deck
            await deckLock.lock();
            try {
                // Re-check count under deck lock to avoid races
                await queueLock.lock();
                const stillNeedWork = itemsUnloaded < TOTAL_PACKAGES;
                queueLock.unlock();

                if (stillNeedWork) {
                    pkg = await warehouse.unload();
                    if (pkg) {
                        await queueLock.lock();
                        itemsUnloaded++;
                        queue.push(pkg);
                        queueLock.unlock();
                    }
                }
            } catch (err) {
                // Intake might be physically full despite our checks (race condition)
                await delay(250);
            } finally {
                deckLock.unlock();
            }

            if (!pkg && itemsUnloaded >= TOTAL_PACKAGES) break;
            if (!pkg) await delay(50);
        }
    };

    const unloaders = Array.from({ length: INTAKE_CONCURRENCY }, (_, i) =>
        unloader(i),
    );
    await Promise.all(unloaders);
}

/**
 * Worker: Drains the internal queue and processes packages through the factory.
 */
async function worker(workerId) {
    while (true) {
        let pkg = null;

        // 1. Get next available package from internal queue
        await queueLock.lock();
        try {
            if (itemsFinished >= TOTAL_PACKAGES) {
                queueLock.unlock();
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
            const lineId = pkg.id % 3;

            // 2. Processing Critical Section
            await stationLocks[lineId].lock();
            try {
                await warehouse.pushToProcessingLine(pkg.id, lineId);
                await warehouse.processPackage(pkg.id, lineId);
            } finally {
                stationLocks[lineId].unlock();
            }

            // 3. Printing Critical Section
            await printerLock.lock();
            let shippingLine;
            try {
                shippingLine = await warehouse.print(pkg.id, lineId);
            } finally {
                printerLock.unlock();
            }

            // 4. Shipping (with backpressure retry)
            let shipped = false;
            while (!shipped) {
                try {
                    await warehouse.ship(pkg.id, shippingLine);
                    shipped = true;
                } catch (err) {
                    await delay(500); // Lane full, wait for truck removal
                }
            }

            // 5. Finalize - decrementing in-flight count implicitly
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
        `Starting run with ${CONCURRENCY} workers and 4 parallel unloaders...`,
    );

    // Start all actors
    const intakePromise = intakeLoop();
    const workerPromises = Array.from({ length: CONCURRENCY }, (_, i) =>
        worker(i),
    );

    await Promise.all([intakePromise, ...workerPromises]);
    console.log("--- Mission Accomplished: 100% Shipped ---");
}

await runConcurrent();
