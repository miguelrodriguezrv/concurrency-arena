package main

// Example 03 — concurrent workers + locks (Go)
//
// Four goroutines run the whole pipeline in parallel. Having exactly 4
// workers means at most 4 Unload() calls at a time — the worker pool IS the
// semaphore for the 4 intake bays.
//
// Shared resources are protected with sync.Mutex:
//   - one mutex per processing line (one package on a line at a time)
//   - one mutex for the printer
//   - one mutex per shipping lane (check space + ship must be ONE step,
//     otherwise two workers both see "3/4" and both ship → rejected)
//
// Better than sequential, but the printer still travels for almost every
// package, and each line only ever holds one package.

import (
	"fmt"
	"sync"
	"time"
	"warehouse"
)

var (
	lineLocks   [3]sync.Mutex
	printerLock sync.Mutex
	laneLocks   = map[string]*sync.Mutex{
		"North":         &sync.Mutex{},
		"South":         &sync.Mutex{},
		"International": &sync.Mutex{},
	}
)

func shipWhenThereIsRoom(w warehouse.Warehouse, id int, lane string) error {
	laneLocks[lane].Lock()
	defer laneLocks[lane].Unlock()
	for w.GetShippingLaneQueueLength(lane) >= 4 {
		time.Sleep(50 * time.Millisecond) // the lane is full: wait for the truck
	}
	return w.Ship(id, lane)
}

func handle(w warehouse.Warehouse, pkg *warehouse.Package) error {
	line := pkg.ID % 3
	lineLocks[line].Lock()
	defer lineLocks[line].Unlock()

	if err := w.PushToProcessingLine(pkg.ID, line); err != nil {
		return err
	}
	if err := w.ProcessPackage(pkg.ID, line); err != nil {
		return err
	}

	printerLock.Lock()
	lane, err := w.Print(pkg.ID, line)
	printerLock.Unlock()
	if err != nil {
		return err
	}

	return shipWhenThereIsRoom(w, pkg.ID, lane)
}

func worker(w warehouse.Warehouse, name string, wg *sync.WaitGroup) {
	defer wg.Done()
	for {
		pkg, err := w.Unload()
		if err != nil {
			fmt.Println(name, "unload failed:", err)
			return
		}
		if pkg == nil {
			return
		}
		if err := handle(w, pkg); err != nil {
			fmt.Printf("%s: package %d failed: %v\n", name, pkg.ID, err)
			return
		}
	}
}

func Run(w warehouse.Warehouse) {
	var wg sync.WaitGroup
	for _, name := range []string{"A", "B", "C", "D"} {
		wg.Add(1)
		go worker(w, name, &wg)
	}
	wg.Wait()
	fmt.Println("All workers finished.")
}
