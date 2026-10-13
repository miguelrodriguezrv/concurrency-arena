/**
 * Example 04 — one worker per line (JavaScript)
 *
 * Builds on 03 (an unloader keeps packages ready in a bounded queue).
 *
 * Now three workers, one per processing line, take packages from the same
 * queue. Each line has exactly one worker, so a line never needs a lock.
 * What IS shared needs one (async-mutex):
 *   - the printer: only one print() at a time
 *   - each shipping lane: "is there room?" + ship() must be ONE step,
 *     otherwise two workers both see "3/4" and both ship → rejected
 *
 * Much faster than one line, but the printer now travels for almost every
 * label, and it's the bottleneck. Watch it bounce between lines.
 */

import { Mutex } from "async-mutex";

/** Bounded async queue: put() waits while full, get() waits while empty. */
class Channel {
    #items = [];
    #getters = [];
    #putters = [];
    #closed = false;

    constructor(capacity) {
        this.capacity = capacity;
    }

    async put(item) {
        while (this.#items.length >= this.capacity) {
            await new Promise((wake) => this.#putters.push(wake));
        }
        this.#items.push(item);
        this.#getters.shift()?.();
    }

    /** Next item, or undefined once the channel is closed and empty. */
    async get() {
        while (this.#items.length === 0) {
            if (this.#closed) return undefined;
            await new Promise((wake) => this.#getters.push(wake));
        }
        const item = this.#items.shift();
        this.#putters.shift()?.();
        return item;
    }

    close() {
        this.#closed = true;
        this.#getters.splice(0).forEach((wake) => wake());
    }
}

const UNLOADERS = 2;
const LANE_CAPACITY = 4;
// 3 waiting + 2 being unloaded + 3 being pushed = 8 on the belt (the limit).
const belt = new Channel(3);

const printer = new Mutex();
const laneLocks = { North: new Mutex(), South: new Mutex(), International: new Mutex() };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let unloadersLeft = UNLOADERS;
async function unloader() {
    while (true) {
        const pkg = await warehouse.unload();
        if (pkg === null) break;
        await belt.put(pkg);
    }
    if (--unloadersLeft === 0) belt.close(); // the last one out closes the queue
}

async function shipWhenThereIsRoom(id, lane) {
    await laneLocks[lane].runExclusive(async () => {
        while (warehouse.getShippingLaneQueueLength(lane) >= LANE_CAPACITY) {
            await sleep(50); // the lane is full: wait for the truck
        }
        await warehouse.ship(id, lane);
    });
}

async function lineWorker(line) {
    while (true) {
        const pkg = await belt.get();
        if (pkg === undefined) return;

        await warehouse.pushToProcessingLine(pkg.id, line);
        await warehouse.processPackage(pkg.id, line);
        const lane = await printer.runExclusive(() => warehouse.print(pkg.id, line));
        await shipWhenThereIsRoom(pkg.id, lane);
    }
}

await Promise.all([
    ...Array.from({ length: UNLOADERS }, unloader),
    lineWorker(0),
    lineWorker(1),
    lineWorker(2),
]);
console.log("All workers finished.");
