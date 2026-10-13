"""
Example 07 - tuned (Python, asyncio)

Builds on 06, using what we know about each package as soon as it's
unloaded: its processingTime.

  - Slow packages (4-6 s) go to their own line (line 2). On a shared line
    a slow package blocks every quick package behind it from printing.
  - Quick packages go to line 0 or 1, whichever has the least WORK queued
    (sum of processing times), not just the fewest packages.
  - The printer serves full lines first: their stations are stuck until
    it comes.
  - SLOW_MS and MIN_BATCH_TO_MOVE were tuned by measuring. Try changing
    them: a lower SLOW_MS sends too much to line 2 and makes it the
    bottleneck.

Only a few percent faster than 06. There's room left: line 2 ends up with
more work than the others. Can you balance it better?
"""
import asyncio
import warehouse

BAYS = 4
BELT_CAPACITY = 8
LINE_CAPACITY = 5
LANE_CAPACITY = 4
MIN_BATCH_TO_MOVE = 2  # tuned
SLOW_MS = 3000  # processingTime >= this counts as slow


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

    def line_load(self, i):
        return sum(p.time for p in self.lines[i] if p.state != "processed")

    def full(self, i):
        return len(self.lines[i]) + self.reserved[i] >= LINE_CAPACITY

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
            # Slow packages get their own line, so they never block the quick
            # ones. Quick packages go to the line (0 or 1) with the least work.
            options = [2] if pkg.processingTime >= SLOW_MS else [0, 1]
            await f.changed.wait_for(lambda: any(f.has_room(i) for i in options))
            line = min((i for i in options if f.has_room(i)), key=f.line_load)
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
    """Where should the printer work next? A line, or None to wait."""
    if f.ready(at) > 0:
        return at  # keep batching on the current line
    candidates = [i for i in range(3) if f.ready(i) > 0]
    if not candidates:
        return None  # nothing ready anywhere
    # Most ready first; on a tie, a full line (its station is stuck until we come).
    best = max(candidates, key=lambda i: (f.ready(i), f.full(i)))
    # The next package here is almost done and no other line has a decent
    # batch (or is stuck full): waiting is cheaper than travelling.
    head_busy = bool(f.lines[at]) and f.lines[at][0].state == "processing"
    if head_busy and f.ready(best) < MIN_BATCH_TO_MOVE and not f.full(best):
        return None
    return best


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
