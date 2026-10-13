package main

// Example 03 — unload ahead (Go)
//
// Builds on 02 (everything on line 0, so the printer never moves).
//
// Unloading takes 600 ms, and in 02 the worker waits for it every time.
// Here an unloader goroutine keeps a few packages ready on the intake belt
// and hands them to the worker through a buffered channel:
//
//	unloader ──► [ chan, buffer 4 ] ──► worker (push, process, print, ship)
//
// Producer / consumer: the unloader works while the worker is busy, and the
// channel's buffer stops it from piling up more than the belt can hold.

import (
	"fmt"
	"warehouse"
)

const line = 0

func unloader(w warehouse.Warehouse, belt chan<- *warehouse.Package) {
	defer close(belt) // "no more work": the worker's range loop ends
	for {
		pkg, err := w.Unload()
		if err != nil {
			fmt.Println("unload failed:", err)
			return
		}
		if pkg == nil {
			return
		}
		belt <- pkg // blocks while the buffer is full
	}
}

func worker(w warehouse.Warehouse, belt <-chan *warehouse.Package) error {
	for pkg := range belt {
		if err := w.PushToProcessingLine(pkg.ID, line); err != nil {
			return err
		}
		if err := w.ProcessPackage(pkg.ID, line); err != nil {
			return err
		}
		lane, err := w.Print(pkg.ID, line)
		if err != nil {
			return err
		}
		if err := w.Ship(pkg.ID, lane); err != nil {
			return err
		}
	}
	return nil
}

func Run(w warehouse.Warehouse) {
	// At most 4 buffered + 1 being unloaded + 1 being pushed = 6 on the belt (limit 8).
	belt := make(chan *warehouse.Package, 4)
	go unloader(w, belt)
	if err := worker(w, belt); err != nil {
		fmt.Println("worker failed:", err)
		return
	}
	fmt.Println("Done.")
}
