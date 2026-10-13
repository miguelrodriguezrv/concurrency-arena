"""
Example 03 - concurrent workers + locks (Python, asyncio)

Four workers run the whole pipeline concurrently. Having exactly 4 workers
means at most 4 unload() calls at a time - the worker pool IS the semaphore
for the 4 intake bays.

Shared resources are protected with asyncio.Lock:
  - one lock per processing line (one package on a line at a time)
  - one lock for the printer
  - one lock per shipping lane (check space + ship must be ONE step,
    otherwise two workers both see "4/5" and both ship -> rejected)

Better than sequential, but the printer still travels for almost every
package, and each line only ever holds one package.
"""
import asyncio
import warehouse

LANES = ("North", "South", "International")

line_locks = [asyncio.Lock() for _ in range(3)]
printer_lock = asyncio.Lock()
lane_locks = {lane: asyncio.Lock() for lane in LANES}


async def ship_when_there_is_room(w, pkg_id, lane):
    async with lane_locks[lane]:
        while w.getShippingLineQueueLength(lane) >= 5:
            await asyncio.sleep(0.05)  # the lane is full: wait for the truck
        await w.ship(pkg_id, lane)


async def worker(w: warehouse.Warehouse, name: str):
    while True:
        pkg = await w.unload()
        if pkg is None:
            return

        line = pkg.id % 3
        async with line_locks[line]:
            await w.pushToProcessingLine(pkg.id, line)
            await w.processPackage(pkg.id, line)
            async with printer_lock:
                lane = await w.print(pkg.id, line)
            await ship_when_there_is_room(w, pkg.id, lane)


async def run(w: warehouse.Warehouse):
    await asyncio.gather(*(worker(w, name) for name in "ABCD"))
    print("All workers finished.")
