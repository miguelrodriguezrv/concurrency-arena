package main

/**
 * NOTE: This file is merely here to satisfy the Go language server (gopls)
 * when editing the local examples. The actual implementations are provided
 * at runtime by the Yaegi interpreter via the WASM bridge.
 */

type Package struct {
	ID             int
	ProcessingTime int
}

func Unload() (*Package, error) {
	return nil, nil
}

func PushToProcessingLine(packageId int, processingLineId int) error {
	return nil
}

func ProcessPackage(packageId int, processingLineId int) error {
	return nil
}

func Print(packageId int, processingLineId int) (string, error) {
	return "", nil
}

func Ship(packageId int, shippingLine string) error {
	return nil
}

func GetShippingLineQueueLength(shippingLine string) int {
	return 0
}
