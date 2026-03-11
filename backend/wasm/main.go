//go:build js && wasm

// This file is intended to be built for WebAssembly (js/wasm).
package main

import (
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

			// We define the symbols under a "concurrency/arena" virtual package
			apiSymbols["concurrency/arena/arena"] = map[string]reflect.Value{
				"API_ProcessTask": reflect.ValueOf(func(id interface{}) {
					// We bridge back to the JS 'runGoTask' for the actual metric tracking/delay
					promise := js.Global().Call("runGoTask", fmt.Sprintf("%v", id))

					// We need to wait for the promise to resolve to simulate the I/O delay
					ch := make(chan struct{})
					success := js.FuncOf(func(this js.Value, args []js.Value) interface{} {
						ch <- struct{}{}
						return nil
					})
					promise.Call("then", success)
					<-ch
					success.Release()
				}),
			}

			if err := i.Use(apiSymbols); err != nil {
				reject.Invoke(fmt.Sprintf("Failed to inject API: %v", err))
				return
			}

			// Pre-import our bridge into the main scope so students don't have to
			// We evaluate a small wrapper to put the function in the global scope of main
			_, err := i.Eval(`import . "concurrency/arena"`)
			if err != nil {
				reject.Invoke(fmt.Sprintf("Failed to setup bridge import: %v", err))
				return
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

// runGoTask remains for internal use by the interpreter bridge to simulate work
func runGoTask(this js.Value, args []js.Value) interface{} {
	taskId := args[0].String()

	handler := js.FuncOf(func(this js.Value, promiseArgs []js.Value) interface{} {
		resolve := promiseArgs[0]
		go func() {
			resolve.Invoke(true)
			_ = taskId // avoid unused
		}()
		return nil
	})

	promiseClass := js.Global().Get("Promise")
	return promiseClass.New(handler)
}
