/**
 * Example 03 — concurrent workers + locks (JavaScript)
 *
 * Four workers run the whole pipeline in parallel. Having exactly 4 workers
 * means at most 4 unload() calls at a time — the worker pool IS the
 * semaphore for the 4 intake bays.
 *
 * Shared resources are protected with mutexes (async-mutex):
 *   - one lock per processing line (one package on a line at a time)
 *   - one lock for the printer
 *   - one lock per shipping lane (check space + ship must be ONE step,
 *     otherwise two workers both see "3/4" and both ship → rejected)
 *
 * Better than sequential, but the printer still travels for almost every
 * package, and each line only ever holds one package.
 */

import { Mutex } from "async-mutex";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const lineLocks = [new Mutex(), new Mutex(), new Mutex()];
const printerLock = new Mutex();
const laneLocks = { North: new Mutex(), South: new Mutex(), International: new Mutex() };

async function shipWhenThereIsRoom(id, lane) {
    await laneLocks[lane].runExclusive(async () => {
        while (warehouse.getShippingLineQueueLength(lane) >= 4) {
            await sleep(50); // the lane is full: wait for the truck
        }
        await warehouse.ship(id, lane);
    });
}

async function worker(name) {
    while (true) {
        const pkg = await warehouse.unload();
        if (pkg === null) return;

        const line = pkg.id % 3;
        await lineLocks[line].runExclusive(async () => {
            await warehouse.pushToProcessingLine(pkg.id, line);
            await warehouse.processPackage(pkg.id, line);
            const lane = await printerLock.runExclusive(() => warehouse.print(pkg.id, line));
            await shipWhenThereIsRoom(pkg.id, lane);
        });
    }
}

await Promise.all(["A", "B", "C", "D"].map(worker));
console.log("All workers finished.");
