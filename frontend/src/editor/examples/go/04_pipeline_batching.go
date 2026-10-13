package main

// Example 04 — staged pipeline with a printer coordinator (Go)
//
// Each stage has its own goroutines. They share one state struct guarded by
// a sync.Mutex plus a sync.Cond ("wait until something is true, then act
// while still holding the lock"):
//
//	4 unloaders  → line with the least queued work (max 5 per line)
//	3 processors → one per line, process packages in order
//	1 printer    → batches labels on ONE line before moving, ships each
//	               package, and only travels when it's worth it.
//
// Rule of thumb: check and claim under the same Lock(); do slow warehouse
// calls with the lock released.

import (
	"fmt"
	"sync"
	"time"
	"warehouse"
)

const (
	bays           = 4
	beltCapacity   = 8
	lineCapacity   = 5
	laneCapacity   = 4
	minBatchToMove = 3 // tune me!
)

type item struct {
	id, time int
	state    string // "queued" | "processing" | "processed"
}

type floor struct {
	mu          sync.Mutex
	changed     *sync.Cond
	lines       [3][]*item // packages per line, in order
	reserved    [3]int     // pushes in flight per line
	onBelt      int        // unloading or waiting on the intake belt
	trucksEmpty bool
}

func (f *floor) hasRoom(i int) bool { return len(f.lines[i])+f.reserved[i] < lineCapacity }

func (f *floor) lineLoad(i int) int {
	t := 0
	for _, p := range f.lines[i] {
		if p.state != "processed" {
			t += p.time
		}
	}
	return t
}

func (f *floor) nextQueued(i int) *item {
	for _, p := range f.lines[i] {
		if p.state == "queued" {
			return p
		}
	}
	return nil
}

// ready: how many packages at the END of line i are processed and printable.
func (f *floor) ready(i int) int {
	n := 0
	for _, p := range f.lines[i] {
		if p.state != "processed" {
			break
		}
		n++
	}
	return n
}

func (f *floor) allDone() bool {
	return f.trucksEmpty && f.onBelt == 0 &&
		len(f.lines[0])+len(f.lines[1])+len(f.lines[2]) == 0
}

// bestLine returns the line with room and the least unprocessed work, or -1.
func (f *floor) bestLine() int {
	best := -1
	for i := 0; i < 3; i++ {
		if f.hasRoom(i) && (best == -1 || f.lineLoad(i) < f.lineLoad(best)) {
			best = i
		}
	}
	return best
}

func unloader(w warehouse.Warehouse, f *floor, wg *sync.WaitGroup) {
	defer wg.Done()
	for {
		f.mu.Lock()
		for !f.trucksEmpty && f.onBelt >= beltCapacity {
			f.changed.Wait()
		}
		if f.trucksEmpty {
			f.mu.Unlock()
			return
		}
		f.onBelt++ // claim a belt spot
		f.mu.Unlock()

		pkg, err := w.Unload()
		if err != nil || pkg == nil {
			if err != nil {
				fmt.Println("unload failed:", err)
			}
			f.mu.Lock()
			f.onBelt--
			f.trucksEmpty = true
			f.changed.Broadcast()
			f.mu.Unlock()
			return
		}

		f.mu.Lock()
		line := f.bestLine()
		for line == -1 {
			f.changed.Wait()
			line = f.bestLine()
		}
		f.reserved[line]++ // claim a line slot
		f.mu.Unlock()

		if err := w.PushToProcessingLine(pkg.ID, line); err != nil {
			fmt.Println("push failed:", err)
		}

		f.mu.Lock()
		f.reserved[line]--
		f.onBelt--
		f.lines[line] = append(f.lines[line], &item{id: pkg.ID, time: pkg.ProcessingTime, state: "queued"})
		f.changed.Broadcast()
		f.mu.Unlock()
	}
}

func processor(w warehouse.Warehouse, f *floor, line int, wg *sync.WaitGroup) {
	defer wg.Done()
	for {
		f.mu.Lock()
		for !f.allDone() && f.nextQueued(line) == nil {
			f.changed.Wait()
		}
		if f.allDone() {
			f.mu.Unlock()
			return
		}
		it := f.nextQueued(line)
		it.state = "processing"
		f.mu.Unlock()

		if err := w.ProcessPackage(it.id, line); err != nil {
			fmt.Println("process failed:", err)
		}

		f.mu.Lock()
		it.state = "processed"
		f.changed.Broadcast()
		f.mu.Unlock()
	}
}

// chooseLine: where should the printer work next? A line, or -1 to wait.
func (f *floor) chooseLine(at int) int {
	if f.ready(at) > 0 {
		return at // keep batching on the current line
	}
	best := 0
	for i := 1; i < 3; i++ {
		if f.ready(i) > f.ready(best) {
			best = i
		}
	}
	if f.ready(best) == 0 {
		return -1 // nothing ready anywhere
	}
	// The next package here is already being processed and no other line has
	// a decent batch: waiting is cheaper than travelling there and back.
	headBusy := len(f.lines[at]) > 0 && f.lines[at][0].state == "processing"
	if headBusy && f.ready(best) < minBatchToMove {
		return -1
	}
	return best
}

func printer(w warehouse.Warehouse, f *floor, wg *sync.WaitGroup) {
	defer wg.Done()
	at := 0 // the printer starts at line 0
	for {
		f.mu.Lock()
		line := f.chooseLine(at)
		for !f.allDone() && line == -1 {
			f.changed.Wait()
			line = f.chooseLine(at)
		}
		if f.allDone() {
			f.mu.Unlock()
			return
		}
		it := f.lines[line][0]
		f.mu.Unlock()

		lane, err := w.Print(it.id, line)
		if err != nil {
			fmt.Println("print failed:", err)
			return
		}
		at = line

		// Only this coordinator ships, so check-then-ship can't race here.
		for w.GetShippingLineQueueLength(lane) >= laneCapacity {
			time.Sleep(20 * time.Millisecond)
		}
		if err := w.Ship(it.id, lane); err != nil {
			fmt.Println("ship failed:", err)
			return
		}

		f.mu.Lock()
		f.lines[line] = f.lines[line][1:]
		f.changed.Broadcast()
		f.mu.Unlock()
	}
}

func Run(w warehouse.Warehouse) {
	f := &floor{}
	f.changed = sync.NewCond(&f.mu)

	var wg sync.WaitGroup
	for i := 0; i < bays; i++ {
		wg.Add(1)
		go unloader(w, f, &wg)
	}
	for line := 0; line < 3; line++ {
		wg.Add(1)
		go processor(w, f, line, &wg)
	}
	wg.Add(1)
	go printer(w, f, &wg)

	wg.Wait()
	fmt.Println("Pipeline drained.")
}
