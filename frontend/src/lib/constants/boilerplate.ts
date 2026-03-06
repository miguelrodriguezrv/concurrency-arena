export const DEFAULT_JS_CODE = `// Challenge: Process 100 tasks as fast as possible.
// Use API.processTask(id) to simulate work.

console.log("Starting tasks...");

async function run() {
  const totalTasks = 100;

  // Right now, this runs sequentially and takes ~5 seconds.
  // Can you make it run concurrently?
  for (let i = 1; i <= totalTasks; i++) {
    await API.processTask(i);
    if (i % 20 === 0) console.log(\`Processed \${i} tasks...\`);
  }
}

await run();`;

export const DEFAULT_GO_CODE = `package main

import (
    "sync"
    "fmt"
)

func main() {
    fmt.Println("Starting Go Concurrency Challenge...")

    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            // This calls the internal engine bridge (Yaegi -> WASM -> JS)
            API_ProcessTask(id)
        }(i)
    }
    wg.Wait()
    fmt.Println("All Go tasks complete!")
}

  `;

export const DEFAULT_PYTHON_CODE = `import asyncio
from arena import API

async def main():
    print("Starting Python Concurrency Challenge...")

    # Right now, this runs sequentially.
    # Can you use asyncio.gather to make it concurrent?
    for i in range(1, 101):
        await API.process_task(i)
        if i % 20 == 0:
            print(f"Processed {i} tasks...")

    print("All Python tasks complete!")

# In Pyodide, we use top-level await instead of asyncio.run()
# to avoid 'WebAssembly stack switching' errors in the browser.
await main()`;
