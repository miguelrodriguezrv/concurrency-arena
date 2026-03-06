## 1. System Architecture Overview

The system operates on an **Event-Driven Observer Pattern**. The student's code does not manipulate the UI directly; instead, it calls a "Mock API" that simulates physical delays and emits events to the frontend.

### **Component Roles**

* **The Executor:** A Web Worker (JS) or WASM (Go) environment where the student's code is injected.
* **The Mock API:** A wrapper injected into the student's scope that handles Mutex logic, rate limiting, and event dispatching.
* **The Relay (Go):** Receives events from the Executor and broadcasts them to the UI and Leaderboard.
* **The Frontend (React + Framer Motion):** Listens for events to trigger specific animations and update metrics.

---

## 2. The Mock API & Event Schema

To ensure the UI is reactive, every API call must emit a `Lifecycle Event`.

### **Event Object Structure**

```typescript
interface WarehouseEvent {
  type: 'INTAKE_START' | 'SCALE_LOCK' | 'PRINT_START' | 'SHIP_COMPLETE' | 'ERROR' | 'STALL';
  packageId: number;
  lineId?: number; // 0, 1, 2
  workerId: string;
  timestamp: number;
  metadata?: any;
}

```

### **API Method Implementation Logic**

| Method | Internal Logic | Frontend Event |
| --- | --- | --- |
| `unload(id)` | Increments `activeUnloaders`. If `> 4`, throws Error. | `INTAKE_START` |
| `lockScale(line)` | Standard Mutex `acquire()`. | `SCALE_LOCK_ACQUIRED` |
| `movePrinter(line)` | Calculates distance. `await delay(abs(diff) * 500)`. | `PRINTER_MOVE` |
| `print(pkg)` | Checks `ScaleLock` + `PrinterLock`. | `PRINT_SUCCESS` |
| `ship(pkg, lane)` | `await delay(300)`. | `SHIP_ANIMATION` |

---

## 3. The "Deterministic Deck" & State Tracking

To ensure fair scoring, the Executor uses a static seed.

* **The Deck:** A pre-generated array of 100 objects: `{ id: 0, weight: 1.2, targetLane: 'North' }`.
* **The Clock:** We use `performance.now()` in the Executor to track the "Wall Clock Time."
* **State Tracker:** A singleton in the Executor that monitors:
* `currentPrinterLine`: Number
* `printerLockedBy`: WorkerID
* `activeLocks`: Map of ScaleID to WorkerID



---

## 4. Frontend Implementation (Framer Motion)

The UI maps the `WarehouseEvent` stream to physical coordinates.

### **Coordinate System**

* **Docking Area:** `x: 0, y: [0, 100, 200, 300]` (4 slots)
* **Buffer/Belt:** `x: 200, y: dynamic`
* **Scales:** `x: 400, y: [50, 150, 250]` (3 lines)
* **Printer:** `x: 450, y: currentScaleY`

### **Animation Triggers**

* **On `INTAKE_START`:** Create a new `Box` component at Dock coordinates.
* **On `SCALE_LOCK`:** Move `Box` from Dock to corresponding Scale coordinate using `layoutId`.
* **On `PRINT_SUCCESS`:** Trigger a "flash" or "stamping" animation on the Printer sprite.
* **On `ERROR`:** Shake the corresponding UI element and turn it red for 1000ms.

---

## 5. Metrics & Scoring Calculation

The "Relay" service aggregates events into a final score.

### **Metric Collection**

1. **Total Time ($T_{total}$):** `FinalShipTimestamp - FirstUnloadTimestamp`.
2. **Printer Efficiency ($E_{p}$):** `(TotalPrintCount * 50ms) / (TotalTimePrinterWasLocked)`.
3. **Throughput ($TP$):** `100 / T_{total}`.

### **The Final Mastery Score**

$$Score = TP \times E_{p} \times 10,000$$

*Penalty:* For every `429 Rate Limit` or `SafetyViolation`, subtract $5\%$ from the final score.

---

## 6. Deadlock Detection Implementation

Since the code runs in a Worker, we cannot rely on the browser to detect a hang.

* **Heartbeat Monitor:** The Executor sends a heartbeat every 500ms.
* **Stall Detection:** If the "Printer Queue" is non-empty AND the "Processed Count" has not increased for 3 seconds while locks are held, the Relay emits a `STALL` event.
* **UI Representation:** In React, find the two workers involved in the circular wait and draw a **pulsing red SVG line** between them.

---

## Next Step for Implementation

Would you like me to write the **TypeScript interface for the `WarehouseAPI` class** that includes the internal Mutex logic? This will be the actual code you drop into the Worker to act as the "Engine."
