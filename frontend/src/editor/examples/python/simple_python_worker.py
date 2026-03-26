import asyncio
import warehouse

async def run(w: warehouse.Warehouse):
    print("Starting Python Warehouse Challenge...")
    # The 'w' object (Warehouse interface) provides all available methods.
    # This sequential version unloads, processes, and ships one by one.
    # Can you make it concurrent to improve throughput?

    while True:
        # 1. Unload a package from the intake belt
        pkg = await w.unload()
        if pkg is None:
            print("No more packages to unload. Challenge complete!")
            break
            
        print(f"Unloaded package {pkg.id}")
        
        # 2. Push to one of the 3 processing lines (0, 1, or 2)
        line_id = pkg.id % 3
        await w.pushToProcessingLine(pkg.id, line_id)
        
        # 3. Process the package on that line
        await w.processPackage(pkg.id, line_id)
        
        # 4. Print the label and get the shipping lane
        lane = await w.print(pkg.id, line_id)
        
        # 5. Ship it!
        await w.ship(pkg.id, lane)
