
## 1. Project Overview: The "Concurrency Arena"

A real-time, remote masterclass environment where you (the Instructor) can watch, run, and visualize your teammates' concurrent code in **Go, Python, and JS**.

* **Primary Goal:** Visualize "invisible" bugs (Race conditions, Deadlocks, Starvation).
* **Key Mechanic:** Real-time synchronization of code editors and a shared "Factory Floor" animation.
* **Privacy:** Hosted locally on your machine and exposed via **Cloudflare Tunnel** for the session.

---

## 2. The Language & Tech Stack

| Component | Technology | Responsibility |
| --- | --- | --- |
| **Relay Server** | **Go** (`net/http`, `gorilla/websocket`) | Managing connections, syncing code strings, and broadcasting the leaderboard. |
| **Frontend UI** | **React** (+ Zustand, Framer Motion) | Rendering the code editor and the "Factory Floor" animation. |
| **Go Sandbox** | **WASM** (`syscall/js`) | Running actual Go code in the browser. |
| **Python Sandbox** | **Pyodide** (WASM) | Running actual Python (`asyncio`) in the browser. |
| **JS Sandbox** | **Web Workers** | Running concurrent JS without blocking the UI. |
| **Tunneling** | **Cloudflare Tunnel** | Public URL access to your local machine. |

---

## 3. The "Factory Floor" Visualization

The UI behaves like a game engine that interprets events from the code runners.

### **The Visual Components**

* **The Spawner:** Generates task "blocks."
* **The Queue:** Shows blocks waiting to be picked up by a worker.
* **The Workers (5 Slots):** Visual lanes where blocks are "processed."
* **The Shared Memory Hub:** A central UI element that glows/flashes when variables are updated.

### **The Event Bridge (Low-JS Strategy)**

Instead of complex JS logic, the Go/Python runners emit simple events to a global bus:

* `TASK_ACQUIRED`: Move block from Queue to Worker.
* `MEM_ACCESS`: Flash the variable hub (shows who is touching data).
* `MEM_COLLISION`: Trigger a "Glitch" animation (indicates a Race Condition).
* `TASK_COMPLETE`: Move block to the "Success" pile.

---

## 4. Masterclass Features & Roles

### **Instructor View (The Command Center)**

* **The Grid:** Live mini-previews of every participant's code editor.
* **The Stage:** A primary editor where you "pull" a specific colleague's code to discuss it.
* **The Master Trigger:** A button to execute the "Staged" code through the main visualizer.
* **Admin Sync:** The ability to "push" a boilerplate or a "broken" snippet to everyone's screen simultaneously.

### **Participant View (The Arena)**

* **Code Editor:** A Monaco instance (VS Code engine) for writing their solution.
* **Local Runner:** A button to test their code against the "Factory Floor" locally before you pull it to the stage.
* **Live Leaderboard:** A sidebar showing everyone's current `Throughput` and `Correctness`.

---

## 5. The Challenge: "The 100-Block Sprint"

A standardized task to ensure all three languages are scored fairly.

* **The Goal:** Increment a shared counter to 100 while processing 100 blocks.
* **The Limit:** No more than 5 tasks can be "In Flight" at once (requires Semaphores/Channels).
* **The Trap:** A 100ms artificial delay between "Read" and "Write" of the counter (forces a Race Condition if not locked).
* **The Scoring:**
* **Accuracy:** Did the counter hit exactly 100?
* **Speed:** How close to the theoretical limit (2 seconds) did they get?
* **Design:** Did they use the idiomatic tool (Mutexes for Python/Go, Limiters for JS)?



---

## 6. Real-Time Sync Logic (Go Backend)

The backend handles the heavy lifting:

1. **WebSocket Handlers:** Manages a `map[string]*Client` of all participants.
2. **State Broadcaster:** Every time a participant types (debounced), the Go server receives the string and broadcasts it to the Instructor's dashboard.
3. **Metrics Collector:** Aggregates the `Tasks/Sec` from each client to update the leaderboard.

---

## 7. Implementation Roadmap

1. **Milestone 1 (The Relay):** Build the Go WebSocket server and a basic React page that can send/receive text.
2. **Milestone 2 (The Runners):** Integrate **WASM** for Go and **Pyodide** for Python. Verify they can "print" to the browser console.
3. **Milestone 3 (The Bridge):** Create the `concurrencyBus` and the Framer Motion "Block" animations.
4. **Milestone 4 (The Arena):** Build the Instructor's grid view and the "Stage" execution logic.
5. **Milestone 5 (The Tunnel):** Test the Cloudflare Tunnel with a colleague to ensure the remote sync is fast enough.
