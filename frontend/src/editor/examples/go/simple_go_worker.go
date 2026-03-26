package main

import (
	"fmt"
	"warehouse"
)

// The Run function is the entry point for the Concurrency Arena.
// The 'w' object (warehouse.Warehouse interface) provides all available methods.
// This sequential version unloads, processes, and ships one by one.
// Can you make it concurrent to improve throughput?
func Run(w warehouse.Warehouse) {
	fmt.Println("Starting warehouse worker...")

	for {
		// 1. Unload a package
		pkg, err := w.Unload()
		if err != nil {
			fmt.Println("Unload error:", err)
			break
		}
		if pkg == nil {
			fmt.Println("No more packages to unload. Challenge complete!")
			break
		}
		fmt.Printf("Unloaded package %d\n", pkg.ID)

		// 2. Push to processing line (0, 1, or 2)
		lineID := pkg.ID % 3
		w.PushToProcessingLine(pkg.ID, lineID)

		// 3. Process it (blocking)
		w.ProcessPackage(pkg.ID, lineID)

		// 4. Print label and ship
		lane, _ := w.Print(pkg.ID, lineID)
		w.Ship(pkg.ID, lane)

		fmt.Printf("Shipped package %d to lane %s\n", pkg.ID, lane)
	}
}
