/*
 * Fill-lines runner (clean)
 *
 * Architecture:
 * - Concurrent unloaders (4) check the warehouse intake mirror before calling unload().
 * - Concurrent pusher pulls from shared intake buffer and pushes sequentially to lines 0->1->2.
 * - Per-line processor tasks call processPackage() in order and push processed ids to processed queues.
 * - A single printer stays "sticky" to a line while it has processed packages, otherwise moves to the busiest line.
 * - A shipper per shipping lane checks shipping queue length via getShippingLineQueueLength() before calling ship().
 *
 * This file is intended to be pasted into the editor examples and run as the student script.
 */

/* Tunables */
const TOTAL_PACKAGES = 100;
const UNLOAD_CONCURRENCY = 4;
const MAX_WAREHOUSE_INTAKE = 8; // mirror-based soft cap
const DEBUG = true;
const SHIP_RETRY_BASE_MS = 200;
const SHIP_RETRY_MAX_MS = 1500;

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function backoffDelay(
    attempt,
    base = SHIP_RETRY_BASE_MS,
    max = SHIP_RETRY_MAX_MS,
) {
    const t = Math.min(max, base * 2 ** attempt);
    const jitter = 0.5 + Math.random();
    return Math.floor(t * jitter);
}

async function runFillLines() {
    // Shared buffers
    const intake = [];
    const seen = new Set();

    // Mirrors and queues
    let warehouseIntakeOnBelt = 0; // maintained from INTAKE_DONE events
    let localUnloadersInFlight = 0;
    let unloadersDone = false;

    const pushedLineQueues = [[], [], []]; // ids that were pushed to processing lines (pending processing)
    const processedQueues = [[], [], []]; // ids that are processed and ready for printing
    const shippingQueues = { North: [], South: [], International: [] };

    // Event mirror
    warehouse.onEvent((ev) => {
        try {
            if (ev.type === "INTAKE_DONE") {
                const q = ev.metadata?.queueLengthAfter;
                if (typeof q === "number") warehouseIntakeOnBelt = q;
            } else if (ev.type === "INDUCTION_DONE") {
                const lid = ev.processingLineId;
                const pid = ev.packageId;
                if (typeof lid === "number" && typeof pid === "number") {
                    // synchronize pushed queue with warehouse induction
                    if (!pushedLineQueues[lid].includes(pid))
                        pushedLineQueues[lid].push(pid);
                }
            } else if (ev.type === "PROCESS_DONE") {
                const lid = ev.processingLineId;
                const pid = ev.packageId;
                if (typeof lid === "number" && typeof pid === "number") {
                    if (!processedQueues[lid].includes(pid))
                        processedQueues[lid].push(pid);
                }
            }
        } catch (e) {
            // ignore
        }
    });

    // Unloader: check mirror + local inflight before calling unload()
    async function unloader(id) {
        while (seen.size < TOTAL_PACKAGES) {
            if (
                warehouseIntakeOnBelt + localUnloadersInFlight >=
                Math.min(TOTAL_PACKAGES, MAX_WAREHOUSE_INTAKE)
            ) {
                if (DEBUG)
                    console.log(
                        `unloader${id}: belt full mirror=${warehouseIntakeOnBelt} inflight=${localUnloadersInFlight}`,
                    );
                await sleep(150);
                continue;
            }

            localUnloadersInFlight++;
            try {
                const pkg = await warehouse.unload();
                if (!pkg) break;
                if (seen.has(pkg.id)) continue;
                seen.add(pkg.id);
                intake.push(pkg);
                // optimistic mirror bump
                warehouseIntakeOnBelt++;
                if (DEBUG)
                    console.log(
                        `unloader${id}: unloaded ${pkg.id} intake=${intake.length} mirror=${warehouseIntakeOnBelt}`,
                    );
            } catch (err) {
                const msg = (err && err.message) || String(err || "");
                if (msg.includes("intake queue full")) {
                    if (DEBUG)
                        console.log(
                            `unloader${id}: unload failed - intake full, backing off`,
                        );
                    await sleep(300);
                } else {
                    if (DEBUG) console.log(`unloader${id}: unload error`, msg);
                    await sleep(200);
                }
            } finally {
                localUnloadersInFlight = Math.max(
                    0,
                    localUnloadersInFlight - 1,
                );
            }
        }
        if (DEBUG) console.log(`unloader${id}: exiting`);
    }

    // Pusher: take from intake and push to processing lines sequentially
    let pusherActive = true;
    async function pusher() {
        let currentLine = 0;
        while (true) {
            if (intake.length === 0) {
                if (unloadersDone) break;
                await sleep(30);
                continue;
            }

            const pkg = intake[0];
            if (!pkg) {
                await sleep(20);
                continue;
            }

            try {
                await warehouse.pushToProcessingLine(pkg.id, currentLine);
                // success
                intake.shift();
                warehouseIntakeOnBelt = Math.max(0, warehouseIntakeOnBelt - 1);
                // induction event will mirror into pushedLineQueues; we still record optimistic push count
                if (DEBUG)
                    console.log(
                        `pusher: pushed ${pkg.id} -> line${currentLine}`,
                    );
                // stay until full
                if ((pushedLineQueues[currentLine].length || 0) >= 5)
                    currentLine = (currentLine + 1) % 3;
            } catch (err) {
                const msg = (err && err.message) || String(err || "");
                if (msg.includes("processingLine") && msg.includes("is full")) {
                    currentLine = (currentLine + 1) % 3;
                    await sleep(10);
                } else if (msg.includes("intake queue full")) {
                    // shouldn't happen often; backoff
                    await sleep(200);
                } else {
                    if (DEBUG) console.log(`pusher push error`, msg);
                    await sleep(50);
                }
            }
        }
        pusherActive = false;
        if (DEBUG) console.log(`pusher: exiting`);
    }

    // Processor per line: process head-of-line packages
    async function processor(lineId) {
        while (true) {
            const next = pushedLineQueues[lineId][0];
            if (!next) {
                if (!pusherActive && intake.length === 0) break;
                await sleep(30);
                continue;
            }

            try {
                if (DEBUG)
                    console.log(`processor${lineId}: processing ${next}`);
                // shift before calling process to reflect in-flight state
                if (pushedLineQueues[lineId][0] === next)
                    pushedLineQueues[lineId].shift();
                await warehouse.processPackage(next, lineId);
                // PROCESS_DONE event handler will add to processedQueues
                if (DEBUG) console.log(`processor${lineId}: done ${next}`);
            } catch (err) {
                const msg = (err && err.message) || String(err || "");
                if (msg.includes("not at head") || msg.includes("busy")) {
                    await sleep(40);
                } else {
                    console.error(`processor${lineId} error`, msg);
                    await sleep(100);
                }
            }
        }
        if (DEBUG) console.log(`processor${lineId}: exiting`);
    }

    // Printer: sticky to currentLine until drained, then pick busiest
    let printerActive = true;
    async function printer() {
        let currentLine = 0;
        while (true) {
            const totalProcessed = processedQueues.reduce(
                (s, q) => s + q.length,
                0,
            );
            if (totalProcessed === 0) {
                if (!pusherActive && processedQueues.flat().length === 0) break;
                await sleep(40);
                continue;
            }

            if (processedQueues[currentLine].length === 0) {
                let best = 0;
                let bestLine = -1;
                for (let i = 0; i < 3; i++) {
                    if (processedQueues[i].length > best) {
                        best = processedQueues[i].length;
                        bestLine = i;
                    }
                }
                if (bestLine >= 0) currentLine = bestLine;
            }

            const pkgId = processedQueues[currentLine].shift();
            if (pkgId == null) {
                await sleep(20);
                continue;
            }

            try {
                if (DEBUG)
                    console.log(
                        `printer: printing ${pkgId} on line ${currentLine}`,
                    );
                const lane = await warehouse.print(pkgId, currentLine);
                if (DEBUG) console.log(`printer: printed ${pkgId} -> ${lane}`);
                shippingQueues[lane].push(pkgId);
            } catch (err) {
                console.error(
                    `printer print error for ${pkgId}`,
                    err?.message ?? err,
                );
                await sleep(50);
            }
        }
        printerActive = false;
        if (DEBUG) console.log(`printer: exiting`);
    }

    // Shipper per lane
    async function shipper(lane) {
        while (true) {
            const q = shippingQueues[lane];
            if (q.length === 0) {
                if (
                    !printerActive &&
                    !pusherActive &&
                    processedQueues.flat().length === 0
                )
                    break;
                await sleep(40);
                continue;
            }

            const pkgId = q[0];
            try {
                const len = warehouse.getShippingLineQueueLength(lane);
                if (len >= 5) {
                    await sleep(100);
                    continue;
                }
                await warehouse.ship(pkgId, lane);
                q.shift();
                if (DEBUG) console.log(`shipper ${lane}: shipped ${pkgId}`);
            } catch (err) {
                console.error(`shipper ${lane} error`, err?.message ?? err);
                await sleep(100);
            }
        }
        if (DEBUG) console.log(`shipper ${lane}: exiting`);
    }

    // Start tasks
    const unloaderTasks = Array.from({ length: UNLOAD_CONCURRENCY }, (_, i) =>
        unloader(i),
    );
    const pusherTask = pusher();
    const processorTasks = [0, 1, 2].map((i) => processor(i));
    const printerTask = printer();
    const shipperTasks = ["North", "South", "International"].map((l) =>
        shipper(l),
    );

    // Wait for unloaders to finish
    await Promise.all(unloaderTasks);
    unloadersDone = true;
    if (DEBUG) console.log(`unloaders finished, intake=${intake.length}`);

    // Wait for everything else
    await Promise.all([
        pusherTask,
        ...processorTasks,
        printerTask,
        ...shipperTasks,
    ]);

    if (DEBUG) console.log(`run complete: seen=${seen.size}`);
}

// Execute
await runFillLines();
