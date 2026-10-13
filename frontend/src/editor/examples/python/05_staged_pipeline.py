"""
Example 05 - staged pipeline (Python, asyncio)

Builds on 04, but splits the work into stages that hand packages to each
other. They share one state object guarded by an asyncio.Condition
("wait until something is true, then act - atomically"):

    4 unloaders  -> the line with the fewest packages (max 5 per line)
    3 processors -> one per line, process ahead: up to 5 packages per line
    1 printer    -> prints (and ships) whatever is ready, in turn

Unloaders never wait for printing anymore, and lines keep processing while
the printer is busy. But it's barely faster than 04: the printer still
travels for almost every label. The slowest stage sets the pace.

`async with cond: await cond.wait_for(check)` returns with the lock held,
so the check and the claim that follows are one atomic step.
"""
import asyncio
import warehouse

BAYS = 4
BELT_CAPACITY = 8
LINE_CAPACITY = 5
LANE_CAPACITY = 4


class Item:
    def __init__(self, id, time):
        self.id = id
        self.time = time
        self.state = "queued"  # queued | processing | processed


class Floor:
    """Our own view of the warehouse floor."""

    def __init__(self):
        self.lines = [[], [], []]  # packages per line, in order
        self.reserved = [0, 0, 0]  # pushes in flight per line
        self.on_belt = 0  # unloading or waiting on the intake belt
        self.trucks_empty = False
        self.changed = asyncio.Condition()

    def has_room(self, i):
        return len(self.lines[i]) + self.reserved[i] < LINE_CAPACITY

    def count(self, i):
        return len(self.lines[i]) + self.reserved[i]

    def next_queued(self, i):
        return next((p for p in self.lines[i] if p.state == "queued"), None)

    def ready(self, i):
        """How many packages at the END of line i are processed and printable."""
        n = 0
        for p in self.lines[i]:
            if p.state != "processed":
                break
            n += 1
        return n

    def all_done(self):
        return self.trucks_empty and self.on_belt == 0 and not any(self.lines)


async def unloader(w, f: Floor):
    while True:
        async with f.changed:
            await f.changed.wait_for(lambda: f.trucks_empty or f.on_belt < BELT_CAPACITY)
            if f.trucks_empty:
                return
            f.on_belt += 1  # claim a belt spot

        pkg = await w.unload()
        if pkg is None:
            async with f.changed:
                f.on_belt -= 1
                f.trucks_empty = True
                f.changed.notify_all()
            return

        async with f.changed:
            await f.changed.wait_for(lambda: any(f.has_room(i) for i in range(3)))
            # the line with the fewest packages
            line = min((i for i in range(3) if f.has_room(i)), key=f.count)
            f.reserved[line] += 1  # claim a line slot

        await w.pushToProcessingLine(pkg.id, line)

        async with f.changed:
            f.reserved[line] -= 1
            f.on_belt -= 1
            f.lines[line].append(Item(pkg.id, pkg.processingTime))
            f.changed.notify_all()


async def processor(w, f: Floor, line: int):
    while True:
        async with f.changed:
            await f.changed.wait_for(lambda: f.all_done() or f.next_queued(line))
            if f.all_done():
                return
            item = f.next_queued(line)
            item.state = "processing"

        await w.processPackage(item.id, line)

        async with f.changed:
            item.state = "processed"
            f.changed.notify_all()


def choose_line(f: Floor, at: int):
    """Where should the printer work next? A line, or None to wait.

    Fair round-robin: the next line (after the current one) that has a
    package ready. Every line gets served in turn... so the printer travels
    for almost every label.
    """
    for step in (1, 2, 0):
        line = (at + step) % 3
        if f.ready(line) > 0:
            return line
    return None


async def printer(w, f: Floor):
    at = 0  # the printer starts at line 0
    while True:
        async with f.changed:
            await f.changed.wait_for(lambda: f.all_done() or choose_line(f, at) is not None)
            if f.all_done():
                return
            line = choose_line(f, at)
            item = f.lines[line][0]

        lane = await w.print(item.id, line)
        at = line

        # Only this coordinator ships, so check-then-ship can't race here.
        while w.getShippingLaneQueueLength(lane) >= LANE_CAPACITY:
            await asyncio.sleep(0.02)
        await w.ship(item.id, lane)

        async with f.changed:
            f.lines[line].pop(0)
            f.changed.notify_all()


async def run(w: warehouse.Warehouse):
    f = Floor()
    await asyncio.gather(
        *(unloader(w, f) for _ in range(BAYS)),
        *(processor(w, f, line) for line in range(3)),
        printer(w, f),
    )
    print("Pipeline drained.")
