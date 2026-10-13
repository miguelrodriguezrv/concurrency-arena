package warehouse

/**
 * NOTE: This file is merely here to satisfy the Go language server (gopls)
 * when editing the local examples. The actual implementations are provided
 * at runtime by the Yaegi interpreter via the WASM bridge.
 */

type Package struct {
	ID             int
	ProcessingTime int // ms of warehouse time ProcessPackage will take
}

// Every method blocks until done. Breaking a rule returns an error.
type Warehouse interface {
	// Unload returns nil, nil when the trucks are empty. Max 4 at once.
	Unload() (*Package, error)
	PushToProcessingLine(packageId int, processingLineId int) error
	ProcessPackage(packageId int, processingLineId int) error
	Print(packageId int, processingLineId int) (string, error)
	Ship(packageId int, shippingLane string) error
	GetShippingLaneQueueLength(shippingLane string) int
}
