//go:build js && wasm

// This file is intended to be built for WebAssembly (js/wasm).
package main

import (
	"errors"
	"fmt"
	"os"
	"reflect"
	"syscall/js"

	"github.com/traefik/yaegi/interp"
	"github.com/traefik/yaegi/stdlib"
)

// This Go code is compiled to WASM and runs in the browser.
// It uses the Yaegi interpreter to execute arbitrary Go source code
// provided by the student, allowing for real concurrent Go execution in the UI.

func await(promise js.Value) (js.Value, error) {
	ch := make(chan struct {
		val js.Value
		err error
	})

	success := js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		var val js.Value
		if len(args) > 0 {
			val = args[0]
		}
		ch <- struct {
			val js.Value
			err error
		}{val, nil}
		return nil
	})

	failure := js.FuncOf(func(this js.Value, args []js.Value) interface{} {
		var errStr string
		if len(args) > 0 {
			arg := args[0]
			if arg.Type() == js.TypeObject && arg.Get("message").Truthy() {
				errStr = arg.Get("message").String()
			} else {
				errStr = arg.String()
			}
		} else {
			errStr = "promise rejected"
		}
		ch <- struct {
			val js.Value
			err error
		}{js.Undefined(), errors.New(errStr)}
		return nil
	})

	promise.Call("then", success).Call("catch", failure)

	result := <-ch
	success.Release()
	failure.Release()

	return result.val, result.err
}

type Package struct {
	ID             int
	ProcessingTime int
}

func getWarehouse() js.Value {
	return js.Global().Get("__warehouse")
}

// WarehouseManager implements the warehouse.Warehouse interface by calling JS functions.
type WarehouseManager struct{}

func (w *WarehouseManager) Unload() (*Package, error) {
	wh := getWarehouse()
	if !wh.Truthy() {
		return nil, errors.New("warehouse runtime not available")
	}
	promise := wh.Call("unload")
	val, err := await(promise)
	if err != nil {
		return nil, err
	}
	if val.IsNull() || val.IsUndefined() {
		return nil, nil // No more packages
	}

	return &Package{
		ID:             val.Get("id").Int(),
		ProcessingTime: val.Get("processingTime").Int(),
	}, nil
}

func (w *WarehouseManager) PushToProcessingLine(packageId int, processingLineId int) error {
	wh := getWarehouse()
	if !wh.Truthy() {
		return errors.New("warehouse runtime not available")
	}
	promise := wh.Call("pushToProcessingLine", packageId, processingLineId)
	_, err := await(promise)
	return err
}

func (w *WarehouseManager) ProcessPackage(packageId int, processingLineId int) error {
	wh := getWarehouse()
	if !wh.Truthy() {
		return errors.New("warehouse runtime not available")
	}
	promise := wh.Call("processPackage", packageId, processingLineId)
	_, err := await(promise)
	return err
}

func (w *WarehouseManager) Print(packageId int, processingLineId int) (string, error) {
	wh := getWarehouse()
	if !wh.Truthy() {
		return "", errors.New("warehouse runtime not available")
	}
	promise := wh.Call("print", packageId, processingLineId)
	val, err := await(promise)
	if err != nil {
		return "", err
	}
	return val.String(), nil
}

func (w *WarehouseManager) Ship(packageId int, shippingLine string) error {
	wh := getWarehouse()
	if !wh.Truthy() {
		return errors.New("warehouse runtime not available")
	}
	promise := wh.Call("ship", packageId, shippingLine)
	_, err := await(promise)
	return err
}

func (w *WarehouseManager) GetShippingLineQueueLength(shippingLine string) int {
	wh := getWarehouse()
	if !wh.Truthy() {
		return 0
	}
	return wh.Call("getShippingLineQueueLength", shippingLine).Int()
}

func main() {
	fmt.Println("Go WASM Runner (Yaegi Engine) Initialized")

	// Register the global function that the JS side will call
	js.Global().Set("runGoSource", js.FuncOf(runGoSource))

	// Signal to JS that the Go runtime is alive and registered runGoSource
	if signal := js.Global().Get("signalExecutorReady"); signal.Type() == js.TypeFunction {
		signal.Invoke()
	}

	// Keep the Go program alive
	select {}
}

const warehouseSource = `
package warehouse

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
`

// runGoSource takes (sourceCode string) and returns a Promise
func runGoSource(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return "Error: No source code provided"
	}

	sourceCode := args[0].String()

	handler := js.FuncOf(func(this js.Value, promiseArgs []js.Value) interface{} {
		resolve := promiseArgs[0]
		reject := promiseArgs[1]

		go func() {
			// Handle potential interpreter panics gracefully
			defer func() {
				if r := recover(); r != nil {
					errStr := fmt.Sprintf("Go Interpreter Panic: %v", r)
					fmt.Fprintln(os.Stderr, errStr)
					reject.Invoke(errStr)
				}
			}()

			// Initialize Yaegi Interpreter
			i := interp.New(interp.Options{
				Stdout: os.Stdout,
				Stderr: os.Stderr,
			})

			// Use the standard library
			if err := i.Use(stdlib.Symbols); err != nil {
				reject.Invoke(fmt.Sprintf("Failed to load stdlib: %v", err))
				return
			}

			// Define the internal API for the student to use.
			apiSymbols := make(map[string]map[string]reflect.Value)

			// Map the Go bridge functions to the interpreter via a raw internal package.
			// Yaegi requires a "path/name" format for export paths.
			apiSymbols["warehouse_internal/warehouse_internal"] = map[string]reflect.Value{
				"UnloadRaw": reflect.ValueOf(func() (int, int, bool, error) {
					p, err := (&WarehouseManager{}).Unload()
					if err != nil {
						return 0, 0, false, err
					}
					if p == nil {
						return 0, 0, false, nil
					}
					return p.ID, p.ProcessingTime, true, nil
				}),
				"PushToProcessingLine":       reflect.ValueOf((&WarehouseManager{}).PushToProcessingLine),
				"ProcessPackage":             reflect.ValueOf((&WarehouseManager{}).ProcessPackage),
				"Print":                      reflect.ValueOf((&WarehouseManager{}).Print),
				"Ship":                       reflect.ValueOf((&WarehouseManager{}).Ship),
				"GetShippingLineQueueLength": reflect.ValueOf((&WarehouseManager{}).GetShippingLineQueueLength),
			}

			if err := i.Use(apiSymbols); err != nil {
				reject.Invoke(fmt.Sprintf("Failed to inject API: %v", err))
				return
			}

			// 1. Materialize the official 'warehouse' package inside the interpreter.
			// This package defines the types natively so the interpreter "owns" them.
			const warehouseBridgeSource = `
package warehouse
import "warehouse_internal/warehouse_internal"

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

type manager struct{}

func (m *manager) Unload() (*Package, error) {
	id, time, ok, err := warehouse_internal.UnloadRaw()
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, nil
	}
	return &Package{ID: id, ProcessingTime: time}, nil
}

func (m *manager) PushToProcessingLine(id, line int) error {
	return warehouse_internal.PushToProcessingLine(id, line)
}

func (m *manager) ProcessPackage(id, line int) error {
	return warehouse_internal.ProcessPackage(id, line)
}

func (m *manager) Print(id, line int) (string, error) {
	return warehouse_internal.Print(id, line)
}

func (m *manager) Ship(id int, lane string) error {
	return warehouse_internal.Ship(id, lane)
}

func (m *manager) GetShippingLineQueueLength(lane string) int {
	return warehouse_internal.GetShippingLineQueueLength(lane)
}

func NewWarehouseManager() Warehouse {
	return &manager{}
}
`
			if _, err := i.Eval(warehouseBridgeSource); err != nil {
				reject.Invoke(fmt.Sprintf("Failed to materialize warehouse bridge: %v", err))
				return
			}

			// Evaluate the student's code
			_, err := i.Eval(sourceCode)

			if err != nil {
				fmt.Printf("Go Runtime Error: %v\n", err)
				reject.Invoke(err.Error())
				return
			}

			// Look for the Run function and call it if it exists
			v, err := i.Eval("Run")
			if err == nil && v.Kind() == reflect.Func {
				// Call Run with a warehouse.Warehouse interface satisfied by our manager.
				// First, ensure warehouse is imported at the top level (safe to call multiple times in Yaegi)
				i.Eval("import \"warehouse\"")

				// Now call Run as a simple expression
				if _, err = i.Eval("Run(warehouse.NewWarehouseManager())"); err != nil {
					fmt.Printf("Go Runtime Error in Run(): %v\n", err)
					reject.Invoke(err.Error())
					return
				}
			} else {
				// Fallback to calling main
				v, err = i.Eval("main")
				if err == nil && v.Kind() == reflect.Func {
					if _, err = i.Eval("main()"); err != nil {
						fmt.Printf("Go Runtime Error in main(): %v\n", err)
						reject.Invoke(err.Error())
						return
					}
				}
			}

			// Success
			resolve.Invoke(true)
		}()

		return nil
	})

	promiseClass := js.Global().Get("Promise")
	return promiseClass.New(handler)
}
