"""
Warehouse Challenge - sequential baseline (Python)

This works, but it moves ONE package at a time through the whole pipeline:

    unload -> pushToProcessingLine -> processPackage -> print -> ship

Everything else in the warehouse sits idle while we wait. Run it once to see
the baseline, then make it faster. Open "Rules" for the limits and hints.

Every warehouse call is a coroutine (await it). A call that breaks a rule is
REJECTED (it raises) - the warehouse never waits for you, so waiting is your job.
"""
import warehouse


async def handle_package(w: warehouse.Warehouse, pkg: warehouse.Package):
    # Spread packages over the three processing lines (0, 1, 2).
    line = pkg.id % 3

    await w.pushToProcessingLine(pkg.id, line)
    await w.processPackage(pkg.id, line)

    # The printer moves to `line` if it is somewhere else (slow!) and returns
    # the shipping lane this package has to go to.
    lane = await w.print(pkg.id, line)

    await w.ship(pkg.id, lane)


async def run(w: warehouse.Warehouse):
    print("Starting the sequential run...")

    while True:
        pkg = await w.unload()  # Package(id, processingTime) or None
        if pkg is None:
            break  # the trucks are empty

        await handle_package(w, pkg)

        if pkg.id % 10 == 0:
            print(f"Handled package {pkg.id}")

    print("All packages handed to the shipping lanes.")
