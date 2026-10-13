"""
Example 03 - unload ahead (Python, asyncio)

Builds on 02 (everything on line 0, so the printer never moves).

Unloading takes 600 ms, and in 02 the worker waits for it every time.
Here an unloader task keeps a few packages ready on the intake belt and
hands them to the worker through a small bounded queue:

    unloader --> [ asyncio.Queue, max 4 ] --> worker (push, process, print, ship)

Producer / consumer: the unloader works while the worker is busy, and the
queue's maxsize stops it from piling up more than the belt can hold.
"""
import asyncio
import warehouse

LINE = 0


async def unloader(w, belt: asyncio.Queue):
    while (pkg := await w.unload()) is not None:
        await belt.put(pkg)  # waits while the queue is full
    await belt.put(None)  # "no more work"


async def worker(w, belt: asyncio.Queue):
    while (pkg := await belt.get()) is not None:
        await w.pushToProcessingLine(pkg.id, LINE)
        await w.processPackage(pkg.id, LINE)
        lane = await w.print(pkg.id, LINE)
        await w.ship(pkg.id, lane)


async def run(w: warehouse.Warehouse):
    # At most 4 waiting + 1 being unloaded + 1 being pushed = 6 on the belt (limit 8).
    belt = asyncio.Queue(maxsize=4)
    await asyncio.gather(unloader(w, belt), worker(w, belt))
    print("Done.")
