"""
Example 02 - the first easy win: stop moving the printer (Python)

Still sequential, but every package uses line 0. The printer never has to
travel between lines, so each package is quicker. No concurrency yet:
the other two lines and three of the four bays are still idle.
"""
import warehouse

LINE = 0


async def run(w: warehouse.Warehouse):
    while True:
        pkg = await w.unload()
        if pkg is None:
            break

        await w.pushToProcessingLine(pkg.id, LINE)
        await w.processPackage(pkg.id, LINE)
        lane = await w.print(pkg.id, LINE)
        await w.ship(pkg.id, lane)

    print("Done.")
