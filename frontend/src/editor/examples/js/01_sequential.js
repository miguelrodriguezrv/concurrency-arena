/**
 * Warehouse Challenge — sequential baseline (JavaScript)
 *
 * This works, but it moves ONE package at a time through the whole pipeline:
 *
 *   unload → pushToProcessingLine → processPackage → print → ship
 *
 * Everything else in the warehouse sits idle while we wait. Run it once to see
 * the baseline, then make it faster. Open "Rules" for the limits and hints.
 *
 * The `warehouse` object is available globally. Every call returns a Promise.
 * A call that breaks a rule is REJECTED (it throws) — the warehouse never waits
 * for you, so waiting is your job.
 */

async function handlePackage(pkg) {
    // Spread packages over the three processing lines (0, 1, 2).
    const line = pkg.id % 3;

    await warehouse.pushToProcessingLine(pkg.id, line);
    await warehouse.processPackage(pkg.id, line);

    // The printer moves to `line` if it is somewhere else (slow!) and returns
    // the shipping lane this package has to go to.
    const lane = await warehouse.print(pkg.id, line);

    await warehouse.ship(pkg.id, lane);
}

console.log("Starting the sequential run...");

while (true) {
    const pkg = await warehouse.unload(); // { id, processingTime } or null
    if (pkg === null) break; // the trucks are empty

    await handlePackage(pkg);

    if (pkg.id % 10 === 0) console.log(`Handled package ${pkg.id}`);
}

console.log("All packages handed to the shipping lanes.");
