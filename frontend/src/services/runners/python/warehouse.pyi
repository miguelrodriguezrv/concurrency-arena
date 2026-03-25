class Package:
    id: int
    processingTime: int

async def unload() -> Package:
    """Unloads the next package from the intake belt."""
    ...

async def pushToProcessingLine(packageId: int, processingLineId: int):
    """Pushes a package onto a processing line queue (0, 1, or 2)."""
    ...

async def processPackage(packageId: int, processingLineId: int):
    """Processes a package at the head of a processing line."""
    ...

async def print(packageId: int, processingLineId: int) -> str:
    """Prints a label for a processed package and returns the assigned shipping lane ('North', 'South', or 'International')."""
    ...

async def ship(packageId: int, shippingLine: str):
    """Enqueues a package into the specified shipping lane ('North', 'South', or 'International')."""
    ...

def getShippingLineQueueLength(shippingLine: str) -> int:
    """Returns the current queue length for the requested shipping lane."""
    ...
