/**
 * Sequential JS example for the Concurrency Arena (updated).
 *
 * This example uses the validator-only numeric-package API:
 *  - unload() -> returns { id, processingTime }
 *  - pushToProcessingLine(packageId, processingLineId)
 *  - process(packageId, processingLineId)
 *  - print(packageId, processingLineId) -> returns shippingLine ("North"/"South"/"International")
 *  - ship(packageId, shippingLine)
 *
 * The example runs packages one-by-one (sequentially) so it's a simple
 * smoke-test of the runtime and produces clear lifecycle logs.
 *
 * Notes:
 *  - The Warehouse is validator-only. Calls will throw if constraints are violated.
 *  - The only inspection helper exposed is `getShippingLineQueueLength(shippingLine)`.
 *    We use that to avoid attempting to ship into a full lane.
 */

const TOTAL_PACKAGES = 20; // increase to 100 for a full run

function now() {
    return typeof performance !== "undefined"
        ? Math.round(performance.now())
        : Date.now();
}

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

async function processPackageSeq() {
    try {
        console.log(`[${now()}] SEQ: START unload`);
        // unload() returns the next package (public view) or null if deck exhausted
        const pkg = await warehouse.unload();
        if (!pkg) {
            console.log(
                `[${now()}] SEQ: deck exhausted, stopping sequential run`,
            );
            return "DECK_EXHAUSTED";
        }
        console.log(
            `[${now()}] SEQ: UNLOADED pkg=${pkg.id} processingTime=${pkg.processingTime}ms`,
        );

        // Choose a processing line deterministically (simple round-robin)
        const processingLine = pkg.id % 3;
        console.log(
            `[${now()}] SEQ: PUSH pkg=${pkg.id} -> processingLine=${processingLine}`,
        );
        await warehouse.pushToProcessingLine(pkg.id, processingLine);
        console.log(
            `[${now()}] SEQ: PUSHED pkg=${pkg.id} to processingLine=${processingLine}`,
        );

        console.log(
            `[${now()}] SEQ: PROCESS pkg=${pkg.id} on processingLine=${processingLine}`,
        );
        await warehouse.processPackage(pkg.id, processingLine);
        console.log(`[${now()}] SEQ: PROCESSED pkg=${pkg.id}`);

        console.log(
            `[${now()}] SEQ: PRINT pkg=${pkg.id} on processingLine=${processingLine}`,
        );
        const shippingLine = await warehouse.print(pkg.id, processingLine);
        console.log(
            `[${now()}] SEQ: PRINTED pkg=${pkg.id} -> shippingLine=${shippingLine}`,
        );

        // Before calling ship(), check shipping queue length to avoid immediate CapacityError.
        // The Warehouse exposes only getShippingLineQueueLength(). We still handle thrown errors
        // because another actor could fill the lane between the check and ship() call (TOCTOU).
        const MAX_SHIP_CAP = 5;
        while (
            warehouse.getShippingLineQueueLength(shippingLine) >= MAX_SHIP_CAP
        ) {
            console.log(
                `[${now()}] SEQ: shippingLine=${shippingLine} full (${warehouse.getShippingLineQueueLength(
                    shippingLine,
                )}), waiting...`,
            );
            await delay(200);
        }

        console.log(`[${now()}] SEQ: SHIP pkg=${pkg.id} -> ${shippingLine}`);
        await warehouse.ship(pkg.id, shippingLine);
        console.log(
            `[${now()}] SEQ: ENQUEUED FOR SHIP pkg=${pkg.id} -> ${shippingLine}`,
        );
    } catch (err) {
        // Validation errors from the Warehouse are expected if the student code violates constraints.
        // For this sequential example we treat any error as fatal and stop the run so it's obvious.
        console.error(
            `[${now()}] SEQ: ERROR during processing:`,
            err && err.message ? err.message : err,
        );
        throw err;
    }
}

async function runSequential() {
    console.log(
        `[${now()}] Sequential run starting (${TOTAL_PACKAGES} packages)`,
    );
    for (let i = 0; i < TOTAL_PACKAGES; i++) {
        const result = await processPackageSeq();
        if (result === "DECK_EXHAUSTED") break;
    }
    console.log(`[${now()}] Sequential run complete`);
}

// Execute immediately (the runner supports top-level await)
await runSequential();
