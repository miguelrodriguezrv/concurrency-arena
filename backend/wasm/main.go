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

func Unload() (*Package, error) {
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

func PushToProcessingLine(packageId int, processingLineId int) error {
	wh := getWarehouse()
	if !wh.Truthy() {
		return errors.New("warehouse runtime not available")
	}
	promise := wh.Call("pushToProcessingLine", packageId, processingLineId)
	_, err := await(promise)
	return err
}

func ProcessPackage(packageId int, processingLineId int) error {
	wh := getWarehouse()
	if !wh.Truthy() {
		return errors.New("warehouse runtime not available")
	}
	promise := wh.Call("processPackage", packageId, processingLineId)
	_, err := await(promise)
	return err
}

func Print(packageId int, processingLineId int) (string, error) {
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

func Ship(packageId int, shippingLine string) error {
	wh := getWarehouse()
	if !wh.Truthy() {
		return errors.New("warehouse runtime not available")
	}
	promise := wh.Call("ship", packageId, shippingLine)
	_, err := await(promise)
	return err
}

func GetShippingLineQueueLength(shippingLine string) int {
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

	// Keep the Go program alive
	select {}
}

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
			// To make it available in the 'main' package, we define a custom
			// symbol map and then use i.Use().
			apiSymbols := make(map[string]map[string]reflect.Value)

			apiSymbols["warehouse/warehouse"] = map[string]reflect.Value{
				"Package":                    reflect.ValueOf((*Package)(nil)),
				"Unload":                     reflect.ValueOf(Unload),
				"PushToProcessingLine":       reflect.ValueOf(PushToProcessingLine),
				"ProcessPackage":             reflect.ValueOf(ProcessPackage),
				"Print":                      reflect.ValueOf(Print),
				"Ship":                       reflect.ValueOf(Ship),
				"GetShippingLineQueueLength": reflect.ValueOf(GetShippingLineQueueLength),
			}

			if err := i.Use(apiSymbols); err != nil {
				reject.Invoke(fmt.Sprintf("Failed to inject API: %v", err))
				return
			}

			_, err := i.Eval(`import . "warehouse"`)
			if err != nil {
				// We don't fail hard here either.
			}

			// Evaluate the student's code
			_, err = i.Eval(sourceCode)
			if err != nil {
				fmt.Printf("Go Runtime Error: %v\n", err)
				reject.Invoke(err.Error())
				return
			}

			// Success
			resolve.Invoke(true)
		}()

		return nil
	})

	promiseClass := js.Global().Get("Promise")
	return promiseClass.New(handler)
}
