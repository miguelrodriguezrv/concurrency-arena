/**
 * Example 00 — what NOT to do: start everything at once (JavaScript)
 *
 * "Just make it async": fire all the work with Promise.all and hope.
 * Watch the warehouse floor: bays, belt, lines and printer reject calls
 * (red flashes), and after too many rejections the warehouse shuts down.
 *
 * The lesson: concurrency without limits doesn't make you faster, it breaks
 * the neighbours. Every shared resource needs something that makes you WAIT.
 */

async function handlePackage() {
    const pkg = await warehouse.unload(); // 100 at once → only 4 bays!
    if (pkg === null) return;
    const line = pkg.id % 3;
    await warehouse.pushToProcessingLine(pkg.id, line);
    await warehouse.processPackage(pkg.id, line); // one station per line!
    const lane = await warehouse.print(pkg.id, line); // one printer!
    await warehouse.ship(pkg.id, lane);
}

const results = await Promise.allSettled(
    Array.from({ length: 100 }, () => handlePackage()),
);

const failed = results.filter((r) => r.status === "rejected");
console.log(`${failed.length} of 100 packages failed`);
if (failed.length) console.log("first error:", failed[0].reason.message);
