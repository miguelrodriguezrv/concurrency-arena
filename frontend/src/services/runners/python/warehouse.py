import sys
import types
import _js_warehouse

# Create a proper module object
warehouse = types.ModuleType("warehouse")
warehouse.__doc__ = "Warehouse Logistics API"

class Package:
    """A package that needs to be processed and shipped."""
    id: int
    processingTime: int

    def __init__(self, id, processing_time):
        self.id = id
        self.processingTime = processing_time # Match JS camelCase for compatibility

class Warehouse:
    """The Warehouse API provides methods to interact with the logistics system."""

    async def unload(self) -> Package:
        """Unloads the next package from the intake belt. Returns None if empty."""
        pass

    async def pushToProcessingLine(self, packageId: int, processingLineId: int):
        """Moves a package onto a processing line (0, 1, or 2)."""
        pass

    async def processPackage(self, packageId: int, processingLineId: int):
        """Performs work on a package at the specified processing line (blocking)."""
        pass

    async def print(self, packageId: int, processingLineId: int) -> str:
        """Generates a shipping label and returns the assigned shipping lane."""
        pass

    async def ship(self, packageId: int, shippingLine: str):
        """Sends a package to the final shipping lane."""
        pass

    def getShippingLineQueueLength(self, shippingLine: str) -> int:
        """Returns the number of packages currently waiting in a shipping lane."""
        pass

# Map the JS instance methods to the module and the Warehouse class
# This allows both 'warehouse.unload()' and 'Warehouse.unload(w)' to work.
methods = [
    "unload", "pushToProcessingLine", "processPackage",
    "print", "ship", "getShippingLineQueueLength"
]

for method_name in methods:
    if hasattr(_js_warehouse, method_name):
        func = getattr(_js_warehouse, method_name)
        setattr(warehouse, method_name, func)
        # Also add to the class for type-hinting support (static-ish mapping)
        setattr(Warehouse, method_name, func)

warehouse.Warehouse = Warehouse
warehouse.Package = Package

# Inject into sys.modules so 'import warehouse' works
sys.modules["warehouse"] = warehouse
