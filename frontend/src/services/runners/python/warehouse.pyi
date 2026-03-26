class Package:
    id: int
    processingTime: int

class Warehouse:
    """The Warehouse API provides methods to interact with the logistics system."""

    async def unload(self) -> Package:
        """Unloads the next package from the intake belt. Returns None if empty."""
        ...

    async def pushToProcessingLine(self, packageId: int, processingLineId: int):
        """Moves a package onto a processing line (0, 1, or 2)."""
        ...

    async def processPackage(self, packageId: int, processingLineId: int):
        """Performs work on a package at the specified processing line (blocking)."""
        ...

    async def print(self, packageId: int, processingLineId: int) -> str:
        """Generates a shipping label and returns the assigned shipping lane."""
        ...

    async def ship(self, packageId: int, shippingLine: str):
        """Sends a package to the final shipping lane."""
        ...

    def getShippingLineQueueLength(self, shippingLine: str) -> int:
        """Returns the number of packages currently waiting in a shipping lane."""
        ...
