package main

// Example 02 — the first easy win: stop moving the printer (Go)
//
// Still sequential, but every package uses line 0. The printer never has to
// travel between lines, so each package is quicker. No concurrency yet:
// the other two lines and three of the four bays are still idle.

import (
	"fmt"
	"warehouse"
)

const line = 0

func Run(w warehouse.Warehouse) {
	for {
		pkg, err := w.Unload()
		if err != nil {
			fmt.Println("unload failed:", err)
			return
		}
		if pkg == nil {
			break
		}

		if err := w.PushToProcessingLine(pkg.ID, line); err != nil {
			fmt.Println(err)
			return
		}
		if err := w.ProcessPackage(pkg.ID, line); err != nil {
			fmt.Println(err)
			return
		}
		lane, err := w.Print(pkg.ID, line)
		if err != nil {
			fmt.Println(err)
			return
		}
		if err := w.Ship(pkg.ID, lane); err != nil {
			fmt.Println(err)
			return
		}
	}
	fmt.Println("Done.")
}
