package main

import (
	"fmt"
)

func main() {
	fmt.Println("Testing Go Warehouse API...")

	// 1. Unload a package
	pkg, err := Unload()
	if err != nil {
		fmt.Println("Unload error:", err)
		return
	}
	if pkg == nil {
		fmt.Println("No packages available")
		return
	}
	fmt.Printf("Unloaded package %d (processing time %dms)\n", pkg.ID, pkg.ProcessingTime)

	// 2. Push it to processing line 0
	err = PushToProcessingLine(pkg.ID, 0)
	if err != nil {
		fmt.Println("Push error:", err)
		return
	}
	fmt.Println("Pushed to processing line 0")

	// 3. Process it
	err = ProcessPackage(pkg.ID, 0)
	if err != nil {
		fmt.Println("Process error:", err)
		return
	}
	fmt.Println("Processed package")

	// 4. Print label
	lane, err := Print(pkg.ID, 0)
	if err != nil {
		fmt.Println("Print error:", err)
		return
	}
	fmt.Println("Printed label for lane:", lane)

	// 5. Ship it
	err = Ship(pkg.ID, lane)
	if err != nil {
		fmt.Println("Ship error:", err)
		return
	}
	fmt.Println("Shipped package successfully!")
}
