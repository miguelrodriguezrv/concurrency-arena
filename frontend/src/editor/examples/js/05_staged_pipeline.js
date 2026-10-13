/**
 * Example 05 — staged pipeline (JavaScript)
 *
 * Builds on 04, but splits the work into stages that hand packages to each
 * other through shared state, guarded by a "something changed" signal
 * (a tiny condition variable):
 *
 *   4 unloaders ──► the line with the fewest packages (max 5 per line)
 *   3 processors, one per line, process ahead: up to 5 packages per line
 *   1 printer coordinator prints (and ships) whatever is ready, in turn
 *
 * Unloaders never wait for printing anymore, and lines keep processing while
 * the printer is busy. But it's barely faster than 04: the printer still
 * travels for almost every label. The slowest stage sets the pace.
 *
 * JavaScript runs on one thread, so plain variables are safe between two
 * `await`s — but any check that spans an `await` can go stale.
 */

const BAYS = 4;
const BELT_CAPACITY = 8;
const LINE_CAPACITY = 5;
const LANE_CAPACITY = 4;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- A tiny condition variable: wait until a predicate holds -------------
let waiters = [];
const changed = () => {
    const w = waiters;
    waiters = [];
    w.forEach((wake) => wake());
};
async function waitUntil(predicate) {
    while (!predicate()) await new Promise((wake) => waiters.push(wake));
}
/**
 * Wait until `tryClaim()` succeeds. tryClaim must check AND take the resource
 * in one synchronous step (no await in between), and return what it took.
 * Checking in waitUntil and taking it after the `await` would race: another
 * task can run in between and take the same slot.
 */
async function claim(tryClaim) {
    let taken;
    await waitUntil(() => (taken = tryClaim()) !== undefined);
    return taken;
}

// --- Shared state (owned by this script, mirrors the warehouse) ----------
// lines[i] = packages on line i, in order: { id, time, state }
// state: "queued" | "processing" | "processed"
const lines = [[], [], []];
const reserved = [0, 0, 0]; // pushes in flight per line
let onBelt = 0; // unloading or waiting on the intake belt
let trucksEmpty = false;

const hasRoom = (i) => lines[i].length + reserved[i] < LINE_CAPACITY;
const count = (i) => lines[i].length + reserved[i];

// --- Stage 1: unloaders --------------------------------------------------
async function unloader() {
    while (!trucksEmpty) {
        const gotBeltSpot = await claim(() => {
            if (trucksEmpty) return false;
            if (onBelt < BELT_CAPACITY) {
                onBelt++;
                return true;
            }
        });
        if (!gotBeltSpot) return;
        const pkg = await warehouse.unload();
        if (pkg === null) {
            onBelt--;
            trucksEmpty = true;
            changed();
            return;
        }

        // Claim a slot on the line with the fewest packages.
        const line = await claim(() => {
            const best = [0, 1, 2].filter(hasRoom).sort((a, b) => count(a) - count(b))[0];
            if (best !== undefined) reserved[best]++;
            return best;
        });
        await warehouse.pushToProcessingLine(pkg.id, line);
        reserved[line]--;
        onBelt--;
        lines[line].push({ id: pkg.id, time: pkg.processingTime, state: "queued" });
        changed();
    }
}

// --- Stage 2: one processor per line -------------------------------------
const allDone = () =>
    trucksEmpty && onBelt === 0 && lines.every((l) => l.length === 0);

async function processor(line) {
    while (true) {
        const next = () => lines[line].find((p) => p.state === "queued");
        await waitUntil(() => next() || allDone());
        if (allDone()) return;
        const pkg = next();
        pkg.state = "processing";
        await warehouse.processPackage(pkg.id, line);
        pkg.state = "processed";
        changed();
    }
}

// --- Stage 3: printer coordinator (batching) ------------------------------
// How many packages at the END of a line are processed and ready to print.
const ready = (i) => {
    let n = 0;
    for (const p of lines[i]) {
        if (p.state !== "processed") break;
        n++;
    }
    return n;
};

// Where should the printer work next? Returns a line, or null to wait.
// Fair round-robin: the next line (after the current one) that has a package
// ready. Every line gets served in turn... so the printer travels for almost
// every label.
function chooseLine(at) {
    for (const step of [1, 2, 0]) {
        const line = (at + step) % 3;
        if (ready(line) > 0) return line;
    }
    return null;
}

async function printer() {
    let at = 0; // the printer starts at line 0
    while (true) {
        let line = null;
        await waitUntil(() => allDone() || (line = chooseLine(at)) !== null);
        if (allDone()) return;

        const pkg = lines[line][0];
        const lane = await warehouse.print(pkg.id, line);
        at = line;

        // Only this coordinator ships, so check-then-ship can't race here.
        while (warehouse.getShippingLaneQueueLength(lane) >= LANE_CAPACITY) {
            await sleep(20);
        }
        await warehouse.ship(pkg.id, lane);
        lines[line].shift();
        changed();
    }
}

await Promise.all([
    ...Array.from({ length: BAYS }, unloader),
    processor(0),
    processor(1),
    processor(2),
    printer(),
]);
console.log("Pipeline drained.");
