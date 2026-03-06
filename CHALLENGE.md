# 🏭 The Concurrency Arena: High-Throughput Fulfillment

## 1. The Scenario

You have been tasked with optimizing the control logic for a modern, automated warehouse. There are **100 packages** currently sitting in delivery trucks that need to be unloaded, weighed, labeled, and shipped.

The warehouse is highly automated but suffers from **physical resource constraints**. A naive, sequential approach will be far too slow to meet the daily quota. Your goal is to implement a high-performance concurrent pipeline that maximizes throughput while respecting the hardware's limits.

---

## 2. The Workflow (The Pipeline)

Every package must pass through these four stages in order:

### **Stage A: The Intake Dock**

Packages are pulled from the trucks.

* **Action:** `await warehouse.unload(id)`
* **Constraint:** The dock only has **4 physical bays**. If you attempt to unload more than 4 packages simultaneously, the system will trigger a `PhysicalCollisionError`.

### **Stage B: The Scale**

Packages move onto one of the **3 conveyor lines**, each equipped with its own scale.

* **Action:** `await warehouse.lockScale(lineId)` followed by `await warehouse.weigh(package)`
* **Constraint:** Only one package can be on a specific line's scale at a time.

### **Stage C: The Mobile Printer**

The package is labeled. This is the primary system bottleneck.

* **Action:** `await warehouse.lockPrinter()` and `await warehouse.movePrinterTo(lineId)`, then `const lane = await warehouse.print(package)`
* **The "Handshake":** To prevent mislabeling, you must hold **BOTH** the `ScaleLock` and the `PrinterLock` to execute the `print()` command.
* **The Penalty:** Moving the printer between lines is slow (**500ms**). **Batching** packages on the same line is critical for a high score.

### **Stage D: The Shipping Lane**

The `print()` function returns a `laneID` (North, South, or International). The package must be delivered to that specific exit.

* **Action:** `await warehouse.ship(package, laneId)`
* **Constraint:** Each shipping lane has a single loader. You must acquire the `laneLock(laneId)` before shipping.
* **The Lesson:** If your workers stay "attached" to the package during the 300ms shipping process, they cannot go back to help at the Intake.

---

## 3. The Rules of the Arena

1. **Deterministic Load:** Every participant processes the exact same "deck" of 100 packages.
2. **Safety First:** Any uncaught error (Rate Limit breach, Safety Violation) results in a **5-second penalty** for a system reboot.
3. **Deadlock Awareness:** The system does not automatically resolve deadlocks. If your workers are stuck waiting for each other, your run will stall and fail.
4. **No Cheating:** The final "Total Processed" count must be exactly 100. Any race conditions that corrupt the counter will invalidate the run.

---

## 4. Scoring Criteria

The Leaderboard is calculated using the **Mastery Index**:

$$Score = \left( \frac{\text{Total Packages}}{\text{Total Time}} \right) \times \left( \frac{\text{Time Spent Printing}}{\text{Total Time Printer was Locked}} \right)$$

* **Throughput:** How fast did you empty the trucks?
* **Efficiency:** How much time did the Printer spend *working* vs. *moving*?
* **Utilization:** How well did you keep all 3 lines fed without hitting the Intake rate limit?

---

## 5. Tips for Success

* **Junior Strategy:** Use basic `async/await` or Goroutines but watch out for the 4-bay limit at the Intake.
* **Medior Strategy:** Implement a **Semaphore** for the Intake and a **Mutex** for the Printer.
* **Senior Strategy:** De-couple the stages. Use **Worker Pools** for unloading and a **Coordinator** to batch Printer movements. Use **Async Handoffs** (Queues/Channels) to move packages into Shipping Lanes so your main workers can get back to the Intake immediately.
