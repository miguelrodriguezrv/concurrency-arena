/**
 * Example 03 — unload ahead (JavaScript)
 *
 * Builds on 02 (everything on line 0, so the printer never moves).
 *
 * Unloading takes 600 ms, and in 02 the worker waits for it every time.
 * Here an unloader task keeps a few packages ready on the intake belt and
 * hands them to the worker through a small bounded queue (a "channel"):
 *
 *   unloader ──► [ queue, max 4 ] ──► worker (push, process, print, ship)
 *
 * Producer / consumer: the unloader works while the worker is busy, and the
 * queue's limit stops it from piling up more than the belt can hold.
 */

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

    /** No more items will come: wake everyone waiting in get(). */
    close() {
        this.#closed = true;
        this.#getters.splice(0).forEach((wake) => wake());
    }
}

const LINE = 0;
// At most 4 waiting + 1 being unloaded + 1 being pushed = 6 on the belt (limit 8).
const belt = new Channel(4);

async function unloader() {
    while (true) {
        const pkg = await warehouse.unload();
        if (pkg === null) break;
        await belt.put(pkg); // waits while the queue is full
    }
    belt.close();
}

async function worker() {
    while (true) {
        const pkg = await belt.get();
        if (pkg === undefined) return; // closed and empty: no more work

        await warehouse.pushToProcessingLine(pkg.id, LINE);
        await warehouse.processPackage(pkg.id, LINE);
        const lane = await warehouse.print(pkg.id, LINE);
        await warehouse.ship(pkg.id, lane);
    }
}

await Promise.all([unloader(), worker()]);
console.log("Done.");
