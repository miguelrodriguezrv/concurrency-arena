"""
Example 04 - one worker per line (Python, asyncio)

Builds on 03 (an unloader keeps packages ready in a bounded queue).

Now three workers, one per processing line, take packages from the same
queue. Each line has exactly one worker, so a line never needs a lock.
What IS shared needs one (asyncio.Lock):
  - the printer: only one print() at a time
  - each shipping lane: "is there room?" + ship() must be ONE step,
    otherwise two workers both see "3/4" and both ship -> rejected

Much faster than one line, but the printer now travels for almost every
label, and it's the bottleneck. Watch it bounce between lines.
"""
import asyncio
import warehouse

UNLOADERS = 2
LANE_CAPACITY = 4
LANES = ("North", "South", "International")

printer = asyncio.Lock()
lane_locks = {lane: asyncio.Lock() for lane in LANES}


async def unloader(w, belt: asyncio.Queue):
    while (pkg := await w.unload()) is not None:
        await belt.put(pkg)


async def ship_when_there_is_room(w, pkg_id, lane):
    async with lane_locks[lane]:
        while w.getShippingLaneQueueLength(lane) >= LANE_CAPACITY:
            await asyncio.sleep(0.05)  # the lane is full: wait for the truck
        await w.ship(pkg_id, lane)


async def line_worker(w, belt: asyncio.Queue, line: int):
    while (pkg := await belt.get()) is not None:
        await w.pushToProcessingLine(pkg.id, line)
        await w.processPackage(pkg.id, line)
        async with printer:
            lane = await w.print(pkg.id, line)
        await ship_when_there_is_room(w, pkg.id, lane)


async def run(w: warehouse.Warehouse):
    # 3 waiting + 2 being unloaded + 3 being pushed = 8 on the belt (the limit).
    belt = asyncio.Queue(maxsize=3)
    workers = [asyncio.create_task(line_worker(w, belt, line)) for line in range(3)]

    await asyncio.gather(*(unloader(w, belt) for _ in range(UNLOADERS)))
    for _ in workers:
        await belt.put(None)  # one "no more work" per worker
    await asyncio.gather(*workers)
    print("All workers finished.")
