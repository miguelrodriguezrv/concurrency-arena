# Concurrency Arena — Warehouse: 5-Stage Validator-Only Specification

This document is the canonical specification for the updated Warehouse pipeline and the contract between student code and the Warehouse runtime.

Key points
- The Warehouse simulates physical resources and enforces constraints by validating calls. It is validator-only: calls that would violate rules throw an Error immediately and emit an `ERROR` event.
- The Warehouse does not block/wait for resources on behalf of students. Students must implement their own semaphores/queues/mutexes when they want to wait instead of being rejected.
- There is no explicit `worker` entity in the API. Students may run as many concurrent workers as they like.

Contents
- Overview
- Package model (public vs private)
- Stages (API signatures, timings, validation rules)
- Minimal inspection API
- Events
- Error semantics
- Student responsibilities & recommended patterns
- Determinism
- Quick snippets / tests

---

## Overview (terminology)

Stages (strict order):
1. Intake — `unload()` (IntakeLine)
2. Induction — `pushToProcessingLine(pkg, processingLineId)` (ProcessingLine 0, 1, 2)
3. Processing — `process(pkg, processingLineId)`
4. Labeling — `print(pkg, processingLineId)` → returns a `ShippingLine`
5. Shipping — `ship(packageId, shippingLine)`

Naming conventions (use these exact terms in code and docs):
- IntakeLine — single intake conveyor where `unload()` places packages.
- ProcessingLine — three processing conveyors (indices `0`, `1`, `2`) where packages queue and are processed at the head.
- ShippingLine — three shipping queues (identifiers: `North`, `South`, `International`).

---

## Package model

Public (visible to students)
- `unload()` returns a minimal `Package` object:
  - `id: number`
  - `processingTime: number` (ms, deterministic per deck; range 500–3000)

Private / internal (Warehouse-only)
- Each package has private tracking fields used for validation. These are NOT exposed to student code:
  - `targetLane: "North" | "South" | "International"` — assigned deterministically when the deck is created; only revealed by `print()`.
  - `location: string` — one of:
    - `"deck"`, `"intake"`, `"processingLine0"`, `"processingLine1"`, `"processingLine2"`, `"shippingLineNorth"`, `"shippingLineSouth"`, `"shippingLineInternational"`, `"shipped"`.
    - This always represents the package's current physical location inside the Warehouse.
  - `status: string` — one of:
    - `"unprocessed"`, `"unloaded"`, `"processed"`, `"printed"`, `"shipped"`.
    - This records the logical progression (what has happened to the package).
  - `lineId?: number` — if applicable, the processing line index (0..2).
  - `timestamps?: { unloadedAt?, pushedAt?, processingStartedAt?, printedAt?, shippedAt? }` — optional telemetry.

Validation uses both `location` and `status` to ensure packages cannot skip stages.

---

## Stages (APIs, delays, constraints, validation)

All APIs are async and validator-only (throw immediately on rule violations). They also emit events describing lifecycle stages.

Constants (current defaults)
- Intake concurrency: 4 simultaneous `unload()` calls allowed.
- ProcessingLine capacity: 5 per line (queued items).
- ShippingLine capacity: 5 per shipping line.
- Timings:
  - `unload()`: 200 ms
  - `pushToProcessingLine()`: 50 ms
  - `process()`: `pkg.processingTime` (per-package)
  - `print()`: 100 ms base + 500 ms travel penalty if printer moves between lines
  - Shipping (background removal): one shipped item per ShippingLine every 500 ms
  - `ship()` call itself: small enqueue delay (10–50 ms); resolves immediately after enqueue

APIs

1) Intake — unload
- Signature:
  - `async unload(): Promise<{ id: number; processingTime: number }>`
- Behavior & validation:
  - Simulate 200 ms.
  - If there are already 4 concurrent `unload()` operations in progress, throw a `CapacityError` immediately and emit `ERROR`.
  - On success, create/return a `Package` with public fields only, and set the internal `location` to `"intake"` and `status` to `"unloaded"`.

2) Induction — pushToProcessingLine
- Signature:
  - `async pushToProcessingLine(pkg: Package, processingLineId: 0|1|2): Promise<void>`
- Behavior & validation:
  - Simulate 50 ms.
  - Validate:
    - `pkg` was produced by `unload()` and its internal `location` is `"intake"` and `status === "unloaded"`.
    - `processingLineId` is 0, 1, or 2.
    - The ProcessingLine's queue length < capacity (5). If full, throw `CapacityError`.
  - On success: append to the specified ProcessingLine's queue, set `location` to `"processingLine{n}"` and set `lineId = n`. Update `timestamps.pushedAt`.

3) Processing — process
- Signature:
  - `async process(pkg: Package, processingLineId: 0|1|2): Promise<void>`
- Behavior & validation:
  - Validate:
    - `pkg` must be in `location === "processingLine{n}"` with `lineId === processingLineId`.
    - `pkg` must be the head of that ProcessingLine's queue (physical head). If not head, throw `ValidationError`.
    - The line's processing station must not be busy; if busy, throw `ResourceBusyError`.
  - On success: mark station as busy, set `location` to `"processingLine{n}"` and `status` to an in-processing state, set `processingStartedAt`, then await `pkg.processingTime`. After completion set `status = "processed"` and clear the station busy flag. Emit the appropriate `PROCESS_START` and `PROCESS_DONE` events.

4) Labeling — print
- Signature:
  - `async print(pkg: Package, processingLineId: 0|1|2): Promise<"North" | "South" | "International">`
- Behavior & validation:
  - Validate:
    - `pkg` must be in `location === "processingLine{n}"` and `status === "processed"` and `lineId === processingLineId`.
    - The printer must not be busy; if busy, throw `ResourceBusyError`.
  - Behavior:
    - Compute travel penalty: if current printer position !== `processingLineId`, add 500 ms.
    - Wait travel penalty + 100 ms base, update printer position to `processingLineId`.
    - Set `status = "printed"`, set `printedAt`, emit `PRINT_START` and `PRINT_SUCCESS`.
    - Return the package's private `targetLane` (one of `North`, `South`, `International`) to the caller. Do NOT reveal any other private fields.

5) Shipping — ship
- Signature:
  - `async ship(packageId: number, shippingLine: "North"|"South"|"International"): Promise<void>`
- Behavior & validation:
  - Quick enqueue: small internal delay (10–50 ms), then return immediately once the package is enqueued.
  - Validate:
    - The package must exist and must have been `printed`. The package's private `targetLane` must equal the provided `shippingLine`. If not, throw `HandshakeError`.
    - If the ShippingLine queue is full (>= capacity 5), throw `CapacityError`.
  - On success: set package `location` to the shipping queue (e.g., `"shippingLineNorth"`), update status to indicate queued for shipping, emit `SHIP_ENQUEUED` event.
  - Background behavior: the Warehouse processes each ShippingLine in the background, removing (shipping) the head item at a rate of one every 500 ms. When removed, the Warehouse sets `status = "shipped"` and `location = "shipped"` and emits `SHIP_START`/`SHIP_COMPLETE` events.

Notes
- `ship()` resolves after enqueue. If students want to "stay attached", they must implement their own mechanism for awaiting a promise resolved on actual shipping; the Warehouse API only returns after enqueue.

---

## Minimal inspection API

To keep the runtime lean and avoid encouraging students to gate every call on Warehouse state, the only read-only inspection helper exposed is:

- `getShippingLineQueueLength(shippingLine: "North"|"South"|"International"): number`

This returns the current queue length (0..capacity) for the specified ShippingLine so students can avoid trying to `ship()` into a full lane. It does NOT guarantee that a subsequent `ship()` will succeed (TOCTOU races are expected).

No other inspection helpers (e.g., line queue lengths or package private fields) are provided.

---

## Events (summary)

The Warehouse emits events via an EventEmitter for visualization and debugging. Important events and typical payloads:

- `INTAKE_START` / `INTAKE_DONE` — { packageId }
- `INDUCTION_START` / `INDUCTION_DONE` — { packageId, processingLineId, queueLengthAfter }
- `PROCESS_START` / `PROCESS_DONE` — { packageId, processingLineId }
- `PRINT_START` / `PRINT_SUCCESS` — { packageId, processingLineId, atPrinterLine?, laneId }
- `SHIP_ENQUEUED` — { packageId, laneId, queueLength }
- `SHIP_START` / `SHIP_COMPLETE` — { packageId, laneId, metadata: { processedCount } }
- `ERROR` — { packageId?, processingLineId?, laneId?, message, details? }
- `HEARTBEAT` — periodic alive event for watchdog

Timestamps should use `performance.now()` (do not use fallbacks).

---

## Errors and consequences

On a validation failure the Warehouse:
1. Emits an `ERROR` event with metadata.
2. Throws an `Error` synchronously from the API call.

Suggested typed errors (implementation detail):
- `ValidationError` — wrong location/status or invalid input
- `CapacityError` — intake/processing/shipping capacity exceeded
- `ResourceBusyError` — printer or processing station already in use
- `HandshakeError` — `ship()` called with wrong ShippingLine for the package

The Runner/Executor decides punitive measures (e.g., soft penalty vs. hard abort) when `ERROR` events occur.

---

## Student responsibilities & recommended approach

Because the Warehouse is validator-only:
- Students must implement concurrency primitives (Semaphore, Mutex, BoundedQueue) or worker pools to avoid throws.
- Typical architecture:
  - An Unloader pool guarded by a Semaphore(4) to gate calls to `unload()`.
  - Per-ProcessingLine queues of capacity 5 and worker(s) that pop and call `process()` (ensuring head-of-line semantics).
  - A local printer coordinator or mutex to ensure only one `print()` call reaches the Warehouse at a time; coordinate movement to minimize travel penalty.
  - Use `getShippingLineQueueLength()` to avoid enqueuing into a full ShippingLine.

Handle thrown errors robustly: retry with backoff, pick alternate lines, or requeue work.

---

## Determinism

- `processingTime` and `targetLane` are deterministically derived from `package.id` so runs are reproducible; tune the PRNG seed / mapping for fairness.

---

## Quick snippets / tests

Example: fire 5 concurrent `unload()` calls (expect at most 4 succeed; 5th throws with CapacityError):

```js
(async () => {
  const promises = Array.from({length:5}, () =>
    warehouse.unload().then(pkg => ({ ok: true, pkg })).catch(err => ({ ok: false, message: err?.message || String(err) }))
  );
  const results = await Promise.all(promises);
  console.log('concurrent unload results:', results);
})();
```

Example: check a shipping line length before enqueueing (optimistic, still must handle throws):

```js
const len = warehouse.getShippingLineQueueLength('North');
if (len < 5) {
  try {
    await warehouse.ship(pkg.id, 'North');
  } catch (err) {
    console.warn('ship failed despite optimistic check:', err.message);
  }
} else {
  // choose alternative or retry later
}
```
