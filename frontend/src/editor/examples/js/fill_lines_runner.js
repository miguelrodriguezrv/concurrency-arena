/**
 * Fill-lines runner (Line-Sticky Strategy)
 *
 * Strategy:
 * 1.  Fill: Saturate Line 0, then 1, then 2.
 * 2.  Process: (Parallel) All lines constantly process any unprocessed packages.
 * 3.  Flush: The printer stays on a line as long as it has processed packages,
 *     coordinating with the ship() call to "drain" the line sequentially.
 */

/* Tunables */
const TOTAL_PACKAGES = 100;
const UNLOAD_CONCURRENCY = 4;
const MAX_WAREHOUSE_INTAKE = 8;
const MAX_LINE_CAPACITY = 5;
const DEBUG = true;

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function runFillLines() {
    // 1. Mirrored State
    const intake = [];
    const seenIds = new Set();
    const processingLines = [[], [], []]; // Array of { id, processed, printed, lane }
    let warehouseIntakeOnBelt = 0;
    let localUnloadersInFlight = 0;
    let shippedCount = 0;

    // 2. Event Mirroring
    warehouse.onEvent((ev) => {
        try {
            if (ev.type === "INTAKE_DONE") {
                const q = ev.metadata?.queueLengthAfter;
                if (typeof q === "number") warehouseIntakeOnBelt = q;
            } else if (ev.type === "INDUCTION_DONE") {
                const { packageId, processingLineId } = ev;
                const line = processingLines[processingLineId];
                if (!line.some((p) => p.id === packageId)) {
                    line.push({ id: packageId, processed: false, printed: false });
                }
                // Decrement intake count mirror
                warehouseIntakeOnBelt = Math.max(0, warehouseIntakeOnBelt - 1);
            } else if (ev.type === "PROCESS_DONE") {
                const { packageId, processingLineId } = ev;
                const pkg = processingLines[processingLineId].find((p) => p.id === packageId);
                if (pkg) pkg.processed = true;
            } else if (ev.type === "PRINT_SUCCESS") {
                const { packageId, processingLineId, shippingLine } = ev;
                const pkg = processingLines[processingLineId].find((p) => p.id === packageId);
                if (pkg) {
                    pkg.printed = true;
                    pkg.lane = shippingLine;
                }
            } else if (ev.type === "SHIP_ENQUEUED") {
                const { packageId } = ev;
                for (const line of processingLines) {
                    const idx = line.findIndex((p) => p.id === packageId);
                    if (idx !== -1) {
                        line.splice(idx, 1);
                        break;
                    }
                }
            } else if (ev.type === "SHIP_COMPLETE") {
                shippedCount++;
            }
        } catch (e) {
            // ignore
        }
    });

    // 3. Unloader: fills the intake buffer (Up to 4 concurrent)
    async function unloaderTask(id) {
        while (seenIds.size < TOTAL_PACKAGES) {
            // Mirror-based soft cap to avoid warehouse penalties
            if (warehouseIntakeOnBelt + localUnloadersInFlight >= MAX_WAREHOUSE_INTAKE) {
                await sleep(100);
                continue;
            }

            localUnloadersInFlight++;
            try {
                const pkg = await warehouse.unload();
                if (!pkg) break;
                if (!seenIds.has(pkg.id)) {
                    seenIds.add(pkg.id);
                    intake.push(pkg);
                }
            } catch (err) {
                await sleep(200);
            } finally {
                localUnloadersInFlight = Math.max(0, localUnloadersInFlight - 1);
            }
        }
        if (DEBUG) console.log(`unloader ${id} finished`);
    }

    // 4. Pusher: Fills lines sequentially (0 -> 1 -> 2)
    async function pusherTask() {
        let lineIdx = 0;
        while (shippedCount < TOTAL_PACKAGES) {
            const pkg = intake[0];
            if (!pkg) {
                await sleep(50);
                continue;
            }

            // Fill one line completely before moving to the next
            if (processingLines[lineIdx].length >= MAX_LINE_CAPACITY) {
                lineIdx = (lineIdx + 1) % 3;
                // If all lines are full, wait
                if (processingLines.every(l => l.length >= MAX_LINE_CAPACITY)) {
                    await sleep(100);
                    continue;
                }
                continue;
            }

            try {
                await warehouse.pushToProcessingLine(pkg.id, lineIdx);
                intake.shift();
                // If line just became full, rotate for the next push
                if (processingLines[lineIdx].length >= MAX_LINE_CAPACITY) {
                    lineIdx = (lineIdx + 1) % 3;
                }
            } catch (err) {
                await sleep(100);
            }
        }
        if (DEBUG) console.log("pusher finished");
    }

    // 5. Line Processors: Constantly processing any available package on their line
    async function lineProcessorTask(lineId) {
        while (shippedCount < TOTAL_PACKAGES) {
            const line = processingLines[lineId];
            const target = line.find(p => !p.processed);

            if (!target) {
                await sleep(50);
                continue;
            }

            try {
                // We don't need to wait for head-of-line here!
                await warehouse.processPackage(target.id, lineId);
            } catch (err) {
                await sleep(100);
            }
        }
        if (DEBUG) console.log(`processor ${lineId} finished`);
    }

    // 6. Master Controller (Printer & Shipper): Coordinates the "Flush"
    async function flushTask() {
        let currentLineId = 0;
        while (shippedCount < TOTAL_PACKAGES) {
            const line = processingLines[currentLineId];

            // Does this line have a head ready to be printed and shipped?
            const head = line[0];
            if (head && head.processed) {
                try {
                    // Print the head
                    if (!head.printed) {
                        const lane = await warehouse.print(head.id, currentLineId);
                        // Status is updated via event (head.printed = true, head.lane = lane)
                        // But for immediate consistency in this loop, we set it here
                        head.printed = true;
                        head.lane = lane;
                    }

                    // Once printed, wait for shipping capacity and ship it
                    const lane = head.lane;
                    if (warehouse.getShippingLineQueueLength(lane) < 5) {
                        await warehouse.ship(head.id, lane);
                        // Once shipped, the head will be removed from processingLines[i]
                        // by the SHIP_ENQUEUED event listener.
                        // We loop back to see the NEW head of the same line.
                        continue;
                    } else {
                        // Lane full, wait briefly but stay on this line
                        await sleep(100);
                        continue;
                    }
                } catch (err) {
                    await sleep(100);
                }
            } else {
                // Line head is not ready (either line is empty or head still processing).
                // Pick the line with the most processed packages to minimize printer travel later.
                let bestLine = currentLineId;
                let maxProcessed = 0;

                for (let i = 0; i < 3; i++) {
                    const count = processingLines[i].filter(p => p.processed).length;
                    if (count > maxProcessed) {
                        maxProcessed = count;
                        bestLine = i;
                    }
                }

                if (bestLine !== currentLineId && maxProcessed > 0) {
                    currentLineId = bestLine;
                } else {
                    await sleep(50);
                }
            }
        }
        if (DEBUG) console.log("flush controller finished");
    }

    // Execute all tasks
    await Promise.all([
        ...Array.from({ length: UNLOAD_CONCURRENCY }, (_, i) => unloaderTask(i)),
        pusherTask(),
        ...[0, 1, 2].map(id => lineProcessorTask(id)),
        flushTask()
    ]);

    if (DEBUG) console.log("All packages shipped successfully!");
}

await runFillLines();
