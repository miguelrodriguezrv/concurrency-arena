package main

// Example 04 — one worker per line (Go)
//
// Builds on 03 (an unloader keeps packages ready in a buffered channel).
//
// Now three goroutines, one per processing line, take packages from the
// same channel. Each line has exactly one worker, so a line never needs a
// lock. What IS shared needs one (sync.Mutex):
//   - the printer: only one Print() at a time
//   - each shipping lane: "is there room?" + Ship() must be ONE step,
//     otherwise two workers both see "3/4" and both ship → rejected
//
// Much faster than one line, but the printer now travels for almost every
// label, and it's the bottleneck. Watch it bounce between lines.

import (
	"fmt"
	"sync"
	"time"
	"warehouse"
)

const (
	unloaders    = 2
	laneCapacity = 4
)

var (
	printer   sync.Mutex
	laneLocks = map[string]*sync.Mutex{
		"North":         &sync.Mutex{},
		"South":         &sync.Mutex{},
		"International": &sync.Mutex{},
	}
)

func unloader(w warehouse.Warehouse, belt chan<- *warehouse.Package, wg *sync.WaitGroup) {
	defer wg.Done()
	for {
		pkg, err := w.Unload()
		if err != nil {
			fmt.Println("unload failed:", err)
			return
		}
		if pkg == nil {
			return
		}
		belt <- pkg
	}
}

func shipWhenThereIsRoom(w warehouse.Warehouse, id int, lane string) error {
	laneLocks[lane].Lock()
	defer laneLocks[lane].Unlock()
	for w.GetShippingLaneQueueLength(lane) >= laneCapacity {
		time.Sleep(50 * time.Millisecond) // the lane is full: wait for the truck
	}
	return w.Ship(id, lane)
}

func lineWorker(w warehouse.Warehouse, line int, belt <-chan *warehouse.Package, wg *sync.WaitGroup) {
	defer wg.Done()
	for pkg := range belt {
		if err := w.PushToProcessingLine(pkg.ID, line); err != nil {
			fmt.Println("push failed:", err)
			return
		}
		if err := w.ProcessPackage(pkg.ID, line); err != nil {
			fmt.Println("process failed:", err)
			return
		}
		printer.Lock()
		lane, err := w.Print(pkg.ID, line)
		printer.Unlock()
		if err != nil {
			fmt.Println("print failed:", err)
			return
		}
		if err := shipWhenThereIsRoom(w, pkg.ID, lane); err != nil {
			fmt.Println("ship failed:", err)
			return
		}
	}
}

func Run(w warehouse.Warehouse) {
	// 3 buffered + 2 being unloaded + 3 being pushed = 8 on the belt (the limit).
	belt := make(chan *warehouse.Package, 3)

	var unloading sync.WaitGroup
	for i := 0; i < unloaders; i++ {
		unloading.Add(1)
		go unloader(w, belt, &unloading)
	}
	go func() {
		unloading.Wait()
		close(belt) // the last unloader out closes the channel
	}()

	var working sync.WaitGroup
	for line := 0; line < 3; line++ {
		working.Add(1)
		go lineWorker(w, line, belt, &working)
	}
	working.Wait()
	fmt.Println("All workers finished.")
}
