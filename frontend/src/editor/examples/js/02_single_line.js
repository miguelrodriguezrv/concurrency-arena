/**
 * Example 02 — the first easy win: stop moving the printer (JavaScript)
 *
 * Still sequential, but every package uses line 0. The printer never has to
 * travel between lines, so each package is quicker. No concurrency yet:
 * the other two lines and three of the four bays are still idle.
 */

const LINE = 0;

while (true) {
    const pkg = await warehouse.unload();
    if (pkg === null) break;

    await warehouse.pushToProcessingLine(pkg.id, LINE);
    await warehouse.processPackage(pkg.id, LINE);
    const lane = await warehouse.print(pkg.id, LINE);
    await warehouse.ship(pkg.id, lane);
}

console.log("Done.");
