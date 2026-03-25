import asyncio
import warehouse


async def main():
    print("Starting Python Warehouse Challenge...")
    # The challenge is to process all packages from the intake belt.
    # This sequential version unloads, processes, and ships one by one.
    # Can you make it concurrent to improve throughput?

    while True:
        # 1. Unload a package from the intake belt
        pkg = await warehouse.unload()
        if pkg is None:
            print("No more packages to unload. Challenge complete!")
            break
        print(f"Unloaded package {pkg.id}")
        # 2. Push to one of the 3 processing lines (0, 1, or 2)
        line_id = pkg.id % 3
        await warehouse.pushToProcessingLine(pkg.id, line_id)
        # 3. Process the package on that line
        await warehouse.processPackage(pkg.id, line_id)
        # 4. Print the label and get the shipping lane
        lane = await warehouse.print(pkg.id, line_id)
        # 5. Ship it!
        await warehouse.ship(pkg.id, lane)


# In Pyodide, we use top-level await to avoid environment issues.
await main()
