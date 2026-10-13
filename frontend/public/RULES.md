<!--
  Shown in the "Rules" modal, one file for all languages (see RulesModal.tsx):
  Placeholders in double braces are filled in per language, "lang:<id>" comment blocks
  only show on that language's tab, and "details: <title>" comment blocks
  become collapsible sections.
-->

**100 packages are waiting in the trucks. Ship them all, as fast as you can.**

1. Press **Run**. The starter code works, but handles one package at a time. That's your baseline.
2. Make it faster by doing several things **at the same time**.
3. Your score is **packages per minute**. Only runs that ship all 100 count.

### Every package goes through 5 steps

| Call | What it does |
|---|---|
| {{c.unload}} | Take a package off a truck ({{null}} when the trucks are empty) |
| {{c.push}} | Put it on line 0, 1 or 2 |
| {{c.process}} | Process it (takes the package's {{n.processingTime}}) |
| {{c.print}} | Label it. This tells you its shipping lane |
| {{c.ship}} | Send it to that lane |

### The limits

- **4** unloads at a time
- **5** packages per line, and each line processes **1** at a time
- **1** printer, and moving it to another line is slow
- **5** packages waiting per shipping lane

Break a limit and the call {{rejects}} and costs you time. The warehouse never waits for you: **waiting is your job.** The floor view shows every limit and flashes red when a call is rejected.

### Two things to know

- {{n.print}} and {{n.ship}} take packages **in order**: the oldest one on the line goes first.
- Ship each package to the lane {{n.print}} returned.

<!-- details: Hints (with code) -->

### How far can you get?

| Level | Idea | ~Time |
|---|---|---|
| 0 | The starter: one package at a time | ~5 min |
| 1 | Put every package on the same line, so the printer never moves | ~3 min |
| 2 | 4 workers handling whole packages, with locks on lines, printer and lanes | ~2.5 min |
| 3 | Separate stages: unloaders → one worker per line → one printer coordinator | ~2.5 min |
| 4 | Level 3, plus the printer **batches**: it prints several packages on one line before moving | ~1 min |

Level 3 alone isn't much faster than level 2. The big jump comes when the pipeline and batching work together.

### Limit something to 4 at a time

The simplest semaphore is a worker pool: start exactly 4 unloaders.

<!-- lang:js -->
```js
async function unloader() {
    while (true) {
        const pkg = await warehouse.unload();
        if (pkg === null) return;
        // hand pkg to the next stage, then come back for more
    }
}
await Promise.all([unloader(), unloader(), unloader(), unloader()]);
```
<!-- /lang -->
<!-- lang:python -->
```python
async def unloader(w):
    while (pkg := await w.unload()) is not None:
        ...  # hand pkg to the next stage, then come back for more

await asyncio.gather(*(unloader(w) for _ in range(4)))
```
<!-- /lang -->
<!-- lang:go -->
```go
var wg sync.WaitGroup
for i := 0; i < 4; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for {
            pkg, err := w.Unload()
            if err != nil || pkg == nil {
                return
            }
            // hand pkg to the next stage, then come back for more
        }
    }()
}
wg.Wait()
```
<!-- /lang -->

### One at a time (the printer)

<!-- lang:js -->
JavaScript has no built-in mutex, but one fits in a few lines:

```js
class Mutex {
    #last = Promise.resolve();
    run(fn) {
        const result = this.#last.then(fn);
        this.#last = result.catch(() => {});
        return result;
    }
}

const printer = new Mutex();
const lane = await printer.run(() => warehouse.print(id, line));
```
<!-- /lang -->
<!-- lang:python -->
```python
printer = asyncio.Lock()

async with printer:
    lane = await w.print(pkg_id, line)
```
<!-- /lang -->
<!-- lang:go -->
```go
var printer sync.Mutex

printer.Lock()
lane, err := w.Print(id, line)
printer.Unlock()
```
<!-- /lang -->

Even simpler: let **one** task be the only one that ever prints (a *printer coordinator*). Then nobody has to fight over a lock.

### Hand work to the next stage

Don't make an unloader wait until its package is printed. Hand it over and go back to the trucks.

<!-- lang:js -->
```js
class Queue {
    items = [];
    waiting = [];
    put(x) {
        const wake = this.waiting.shift();
        wake ? wake(x) : this.items.push(x);
    }
    get() {
        if (this.items.length) return Promise.resolve(this.items.shift());
        return new Promise((resolve) => this.waiting.push(resolve));
    }
}

const toLine = [new Queue(), new Queue(), new Queue()];
toLine[line].put(pkg);                  // unloader: hand off, move on
const next = await toLine[line].get();  // line worker: wait for work
```
<!-- /lang -->
<!-- lang:python -->
```python
to_line = [asyncio.Queue(maxsize=5) for _ in range(3)]

await to_line[line].put(pkg)       # unloader: hand off (waits if full)
pkg = await to_line[line].get()    # line worker: wait for work
```
<!-- /lang -->
<!-- lang:go -->
```go
toLine := [3]chan *warehouse.Package{}
for i := range toLine {
    toLine[i] = make(chan *warehouse.Package, 5)
}

toLine[line] <- pkg          // unloader: hand off (blocks if full)
for pkg := range toLine[line] {  // line worker: wait for work
    // ...
}
```
<!-- /lang -->

### Check and claim in one step

"There's room on line 1" can stop being true while you wait for something else. Keep your own count, and **check and take** a slot in one step. Only then make the slow call. Give the slot back when the package ships.

<!-- lang:js -->
Code between two `await`s never interleaves with other tasks, so check and claim with no `await` in between:

```js
// ✗ another task can take the slot during the await
if (room[line] > 0) {
    await somethingElse();
    room[line]--;
}

// ✓ check + claim together, then the slow call
if (room[line] > 0) {
    room[line]--;
    await warehouse.pushToProcessingLine(pkg.id, line);
}
```
<!-- /lang -->
<!-- lang:python -->
```python
cond = asyncio.Condition()

async with cond:
    await cond.wait_for(lambda: room[line] > 0)
    room[line] -= 1                     # claimed while holding the lock
await w.pushToProcessingLine(pkg.id, line)

# later, when the package has shipped:
async with cond:
    room[line] += 1
    cond.notify_all()
```
<!-- /lang -->
<!-- lang:go -->
```go
var mu sync.Mutex
cond := sync.NewCond(&mu)

mu.Lock()
for room[line] == 0 {
    cond.Wait() // sleeps, wakes on Broadcast()
}
room[line]-- // claimed while holding the lock
mu.Unlock()
err := w.PushToProcessingLine(pkg.ID, line)

// later, when the package has shipped:
mu.Lock()
room[line]++
cond.Broadcast()
mu.Unlock()
```
<!-- /lang -->

### Batch the printer

Moving the printer costs more than four labels. While it works on one line, the other lines keep processing. When it moves, several packages are ready in a row. Stay on a line while it has work, and only move when another line has a batch waiting.

### Don't swallow errors

A package whose call failed is still on the floor. If nobody deals with it, it blocks its line and the run ends **incomplete**.

<!-- /details -->

<!-- details: Full rules: timings, penalties, edge cases -->

### Timings and limits

| Step | Call | Takes | Limit |
|---|---|---|---|
| Unload | {{n.unload}} | 300 ms | 4 at the same time |
| Intake belt | (between unload and push) | – | 8 packages, counting the ones being unloaded |
| Put on a line | {{n.push}} | 80 ms | 5 packages per line |
| Process | {{n.process}} | the package's {{n.processingTime}} (400–2000 ms) | 1 at a time per line |
| Label | {{n.print}} | 250 ms, **+1200 ms** if the printer moves | 1 printer |
| Ship | {{n.ship}} | 80 ms | 5 waiting per lane. Each lane loads one package into its truck every 1000 ms |

### Details

1. **{{n.process}} works on any package on its line.** {{n.print}} and {{n.ship}} only work on the package at the **end of the line**: the oldest one still there.
2. **A package keeps its line slot until it's shipped.** If its lane is full, the end of the line is stuck until the truck makes room.
3. **The printer stays where it was last used.** Printing on the same line again is cheap.
4. **Rejections cost time.** Over a limit (bays, belt, line or lane full): **1 s** before the call {{rejects}}. Station or printer busy: **0.5 s**. Wrong state (e.g. printing an unprocessed package): immediately.
5. **After 100 rejected calls the warehouse shuts down** and the run doesn't count. Retrying blindly in a loop gets you there fast.
6. **The run ends when all 100 packages have shipped.** If your code returns while packages are still in the trucks or on the floor, the run is **incomplete**.
7. {{n.queueLength}} tells you how many packages wait in a lane (0–5). Another task can change it right after you look.

### Score

Packages per minute, from the first unload until the last package leaves on its truck. Your best complete run goes to the leaderboard. The result card also shows **printer efficiency**: time printing vs. time travelling.

### Speed 1× / 2× / 4×

The speed buttons next to *Run* make the warehouse run faster in real time. Times and scores are measured in **warehouse time**, so a run scores the same at any speed. Your own waits ({{sleep}}) are real time, so they cost relatively more at higher speeds. Wait **for events** (a lock, a queue, a condition) instead of polling with sleeps.

<!-- /details -->

<!-- details: API reference -->

<!-- lang:js -->
`warehouse` is a global. Every call returns a Promise, and top-level `await` works.

```js
const pkg  = await warehouse.unload();               // { id, processingTime } | null
await warehouse.pushToProcessingLine(pkg.id, line);  // line: 0 | 1 | 2
await warehouse.processPackage(pkg.id, line);
const lane = await warehouse.print(pkg.id, line);    // "North" | "South" | "International"
await warehouse.ship(pkg.id, lane);
warehouse.getShippingLineQueueLength(lane);          // 0..5 (no await)
```

A rejected call throws an `Error`. Catch it with `try / catch`.
<!-- /lang -->
<!-- lang:python -->
Write `async def run(w)`. The warehouse calls it for you.

```python
pkg  = await w.unload()                     # Package(id, processingTime) | None
await w.pushToProcessingLine(pkg.id, line)  # line: 0 | 1 | 2
await w.processPackage(pkg.id, line)
lane = await w.print(pkg.id, line)          # "North" | "South" | "International"
await w.ship(pkg.id, lane)
w.getShippingLineQueueLength(lane)          # 0..5 (no await)
```

A rejected call raises an exception. Catch it with `try / except Exception`. Useful tools: `asyncio.gather`, `asyncio.Lock`, `asyncio.Semaphore`, `asyncio.Queue`, `asyncio.Condition`.
<!-- /lang -->
<!-- lang:go -->
Write `func Run(w warehouse.Warehouse)`. The warehouse calls it for you. Every method blocks until it's done.

```go
pkg, err := w.Unload()                      // *Package{ID, ProcessingTime}, or nil, nil when empty
err = w.PushToProcessingLine(pkg.ID, line)  // line: 0, 1 or 2
err = w.ProcessPackage(pkg.ID, line)
lane, err := w.Print(pkg.ID, line)          // "North" | "South" | "International"
err = w.Ship(pkg.ID, lane)
n := w.GetShippingLineQueueLength(lane)     // 0..5
```

A rejected call returns an `error`. Useful tools: goroutines, `sync.WaitGroup`, `sync.Mutex`, `sync.Cond`, channels.
<!-- /lang -->

<!-- /details -->
