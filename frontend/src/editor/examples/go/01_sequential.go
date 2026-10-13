package main

// Warehouse Challenge — sequential baseline (Go)
//
// This works, but it moves ONE package at a time through the whole pipeline:
//
//	Unload → PushToProcessingLine → ProcessPackage → Print → Ship
//
// Everything else in the warehouse sits idle while we wait. Run it once to see
// the baseline, then make it faster. Open "Rules" for the limits and hints.
//
// Every call blocks until it finishes. A call that breaks a rule is REJECTED
// (it returns an error) — the warehouse never waits for you, so waiting is
// your job.

import (
	"fmt"
	"warehouse"
)

func handlePackage(w warehouse.Warehouse, pkg *warehouse.Package) error {
	// Spread packages over the three processing lines (0, 1, 2).
	line := pkg.ID % 3

	if err := w.PushToProcessingLine(pkg.ID, line); err != nil {
		return err
	}
	if err := w.ProcessPackage(pkg.ID, line); err != nil {
		return err
	}

	// The printer moves to `line` if it is somewhere else (slow!) and returns
	// the shipping lane this package has to go to.
	lane, err := w.Print(pkg.ID, line)
	if err != nil {
		return err
	}

	return w.Ship(pkg.ID, lane)
}

// Run is the entry point of the Concurrency Arena.
func Run(w warehouse.Warehouse) {
	fmt.Println("Starting the sequential run...")

	for {
		pkg, err := w.Unload() // *Package{ID, ProcessingTime}, or nil when empty
		if err != nil {
			fmt.Println("unload failed:", err)
			return
		}
		if pkg == nil {
			break // the trucks are empty
		}

		if err := handlePackage(w, pkg); err != nil {
			fmt.Printf("package %d failed: %v\n", pkg.ID, err)
			return
		}

		if pkg.ID%10 == 0 {
			fmt.Printf("Handled package %d\n", pkg.ID)
		}
	}

	fmt.Println("All packages handed to the shipping lanes.")
}
