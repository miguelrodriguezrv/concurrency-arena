/**
 * Error Logic Test Runner (Chaos Monkey)
 * 
 * This script is designed to intentionally violate warehouse rules
 * to verify our new penalty and error-handling logic.
 * 
 * Tests:
 * 1. Transient Penalties: Exceeding intake concurrency and capacity.
 * 2. Resource Penalties: Calling processPackage on a busy station.
 * 3. Fatal Errors: Attempting to ship a non-printed package.
 * 4. Kill Switch: Triggering 101 errors to force a fatal termination.
 */

async function runErrorTest() {
    console.log("--- STARTING ERROR LOGIC TEST ---");

    // --- TEST 1: INTAKE CONCURRENCY & CAPACITY (TRANSIENT PENALTY) ---
    console.log("\n[Test 1] Triggering intake concurrency/capacity penalty (4 concurrent limit)...");
    const intakeResults = await Promise.allSettled([
        warehouse.unload(), warehouse.unload(), warehouse.unload(), warehouse.unload(),
        warehouse.unload(), warehouse.unload(), warehouse.unload(), warehouse.unload()
    ]);
    // The first 4 should start, the next 4 should trigger a 2s penalty.
    console.log("Intake batch finished. Check if some took ~2s longer.");

    const pkgs = intakeResults
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => r.value);

    if (pkgs.length === 0) {
        console.error("Failed to unload any packages for further tests.");
        return;
    }

    // --- TEST 2: RESOURCE BUSY (PENALTY) ---
    console.log("\n[Test 2] Triggering station busy penalty...");
    const p1 = pkgs[0];
    // Push to line 0
    await warehouse.pushToProcessingLine(p1.id, 0);
    
    // Start processing twice
    console.log(`Processing package ${p1.id} on Line 0 twice...`);
    const procResults = await Promise.allSettled([
        warehouse.processPackage(p1.id, 0),
        warehouse.processPackage(p1.id, 0)
    ]);
    console.log("Station busy test finished. Second call should have been penalized 1s.");

    // --- TEST 3: FATAL LOGIC ERROR ---
    console.log("\n[Test 3] Triggering fatal logic error (Shipping non-printed package)...");
    try {
        // p1 is NOT printed yet
        await warehouse.ship(p1.id, "North");
    } catch (err) {
        console.log(`Caught expected FATAL error: ${err.message}`);
    }

    // --- TEST 4: KILL SWITCH (100+ ERRORS) ---
    console.log("\n[Test 4] Triggering 101+ errors to hit the kill switch...");
    console.log("This should result in a [FATAL] log and terminate the run.");
    
    for (let i = 0; i < 110; i++) {
        try {
            // Intentionally trigger "Intake full" or "Concurrency exceeded" errors repeatedly
            // without waiting for the penalty to clear.
            warehouse.unload().catch(() => {});
            
            if (i % 20 === 0) console.log(`Triggered ${i} errors...`);
        } catch (err) {
            console.log(`\n!!! RUN TERMINATED AS EXPECTED !!!`);
            console.log(`Final Error: ${err.message}`);
            break;
        }
        // Small sleep to allow the event emitter to process and log
        await new Promise(r => setTimeout(r, 5));
    }
}

await runErrorTest();
