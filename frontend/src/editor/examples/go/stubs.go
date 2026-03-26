package warehouse

/**
 * NOTE: This file is merely here to satisfy the Go language server (gopls)
 * when editing the local examples. The actual implementations are provided
 * at runtime by the Yaegi interpreter via the WASM bridge.
 */

type Package struct {
	ID             int
	ProcessingTime int
}

type Warehouse interface {
	Unload() (*Package, error)
	PushToProcessingLine(packageId int, processingLineId int) error
	ProcessPackage(packageId int, processingLineId int) error
	Print(packageId int, processingLineId int) (string, error)
	Ship(packageId int, shippingLine string) error
	GetShippingLineQueueLength(shippingLine string) int
}
