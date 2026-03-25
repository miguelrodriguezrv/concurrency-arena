
/**
 * JavaScript Warehouse Challenge: Sequential Solution
 *
 * Your goal is to process all packages from the intake belt.
 * This version processes packages one-by-one, which is slow.
 * Can you make it concurrent to improve your throughput?
 */

console.log("Starting JavaScript Warehouse Challenge...");

async function run() {
  while (true) {
    // 1. Unload a package from the intake belt
    const pkg = await warehouse.unload();
    if (pkg === null) {
      console.log("No more packages to unload. Challenge complete!");
      break;
    }

    console.log(`Unloaded package ${pkg.id}`);

    // 2. Push to one of the 3 processing lines (0, 1, or 2)
    const lineId = pkg.id % 3;
    await warehouse.pushToProcessingLine(pkg.id, lineId);

    // 3. Process the package on that line
    await warehouse.processPackage(pkg.id, lineId);

    // 4. Print the label and get the shipping lane
    const lane = await warehouse.print(pkg.id, lineId);

    // 5. Ship it!
    await warehouse.ship(pkg.id, lane);
  }
}

// In the Arena JS runner, top-level await is supported.
await run();
