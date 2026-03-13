# Concurrency Arena — Rules

Welcome to the Concurrency Arena. Your goal is to empty the trucks by moving every package
through the warehouse pipeline correctly and as quickly as possible. The rules below explain
what you are allowed to do, why the constraints exist, and recommended patterns to build a
robust solution.

## Objective

Process all packages through the pipeline (Intake → Induction → Processing → Print → Ship).
Correctness is required: every package must be shipped. Scoring rewards faster completion and
efficient printer usage.

## How the Warehouse Works

- `unload()` gives you a small public package object (`{ id, processingTime }`) and places the package on the intake belt.
- You push packages to one of three processing lines where they wait to be processed. Processing takes the package's `processingTime` (deterministic per package).
- The shared printer physically visits a processing line and labels a package. The act of printing assigns the package's shipping lane (North/South/International) — that lane is what determines where the package must be shipped.
- `ship()` enqueues a package to a shipping lane; shipping happens in the background at a steady rate. `ship()` returns once the package is enqueued.

These behaviors reflect physical constraints: bays, queues, a single printer that must be moved,
and limited loaders at shipping lanes.

## Resource Constraints

- Unloading: at most **4** concurrent `unload()` operations. Extra simultaneous calls throw a `CapacityError`.
- Intake belt: queue capacity of **10** packages. Unloading extra packages throw a `CapacityError`.  
- Processing lines: **3** lines (ids `0`, `1`, `2`), each with queue capacity **5**. `process()` enforces head-of-line semantics and station availability.
- Printer: a single printer. `print()` requires the package be ready on its processing line and the printer not be busy. Moving the printer between lines adds a travel penalty (time).
- Shipping lanes: each lane queue capacity **5**. Shipping removes items in the background at a fixed rate; `ship()` only enqueues (small enqueue delay) and returns immediately.

Violating these constraints causes the Warehouse to throw an error immediately and emit an
`ERROR` event. The runtime does not wait for you — you must implement waiting/retry logic.

## What you must implement

- Implement concurrency primitives or patterns (Semaphore, Mutex, BoundedQueue, Worker Pools) so your code does not rely on the Warehouse to block for you.
- Treat thrown errors as signals: retry, requeue, or choose an alternate line rather than crashing.
- Prefer short-lived critical sections: enqueue work for later stages so workers can return to unloading quickly.

Recommended minimal architecture:

- Unloader pool guarded by a Semaphore(4).
- Per-line bounded queues and processors that ensure head-of-line `process()` calls.
- A printer coordinator (mutex + movement strategy) to batch by line.

## Failures & Penalties

- Any call that violates the Warehouse rules throws synchronously and emits an `ERROR` event.
- Deadlocks (workers indefinitely waiting on locks) will stall your run and invalidate results.
- The Runner may apply penalties (timeouts or reboots) on repeated or serious validation errors.

## Scoring (high level)

- Primary: complete all packages correctly.
- Secondary: reduce total elapsed time and minimize printer travel/idle time. Efficient batching and handoffs improve score.

## Useful APIs (student-facing)

- `await warehouse.unload()` → `{ id, processingTime }`
- `await warehouse.pushToProcessingLine(pkg, lineId)`
- `await warehouse.process(pkg, lineId)`
- `await warehouse.print(pkg, lineId)` → returns `"North" | "South" | "International"`
- `await warehouse.ship(packageId, lane)`
- `warehouse.getShippingLineQueueLength(lane)` — optimistic check only (TOCTOU races possible)

## Quick tips

- Use a semaphore to limit concurrent `unload()` calls.
- Hand off packages via queues so workers can return to intake quickly.
- Batch `print()` calls per line to reduce printer travel penalty.
- Handle thrown errors gracefully (retry/backoff or requeue).

Good luck — aim for correctness first, then optimize for speed and printer efficiency.
