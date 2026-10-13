class Package:
    id: int
    processingTime: int  # ms of warehouse time processPackage() will take

class Warehouse:
    """The warehouse. Every call is validated: breaking a rule raises an exception."""

    async def unload(self) -> Package | None:
        """Unload the next package from the trucks (600 ms). Max 4 at once; the
        intake belt holds 8. Returns None when the trucks are empty."""
        ...

    async def pushToProcessingLine(self, packageId: int, processingLineId: int) -> None:
        """Move a package from the intake belt onto line 0, 1 or 2 (80 ms).
        Each line holds at most 5 packages (a package keeps its slot until shipped)."""
        ...

    async def processPackage(self, packageId: int, processingLineId: int) -> None:
        """Process a package on its line (takes package.processingTime).
        Each line has one station: one package at a time per line."""
        ...

    async def print(self, packageId: int, processingLineId: int) -> str:
        """Label the processed package at the END of the line (250 ms, +900 ms if
        the single printer has to move). Returns 'North', 'South' or 'International'."""
        ...

    async def ship(self, packageId: int, shippingLane: str) -> None:
        """Send the printed package at the end of its line to the lane print()
        returned (80 ms). Each lane holds 4 and loads one package every 1.4 s."""
        ...

    def getShippingLaneQueueLength(self, shippingLane: str) -> int:
        """How many packages wait in a lane right now (0-4). May change right after."""
        ...
