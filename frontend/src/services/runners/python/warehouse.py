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
        self.processingTime = processing_time  # Match JS camelCase for compatibility

    def __repr__(self):
        return f"Package(id={self.id}, processingTime={self.processingTime})"

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

    async def ship(self, packageId: int, shippingLane: str):
        """Sends a package to the final shipping lane."""
        pass

    def getShippingLaneQueueLength(self, shippingLane: str) -> int:
        """Returns the number of packages currently waiting in a shipping lane."""
        pass

try:
    from pyodide.ffi import jsnull as _jsnull
except Exception:  # older Pyodide: null already converts to None
    _jsnull = None


def _is_null(v):
    return v is None or (_jsnull is not None and v is _jsnull)


async def _unload():
    """Unload the next package. Returns a Package, or None when the trucks are empty."""
    p = await _js_warehouse.unload()
    if _is_null(p):
        return None
    return Package(int(p.id), int(p.processingTime))


async def _push(packageId, processingLineId):
    return await _js_warehouse.pushToProcessingLine(packageId, processingLineId)


async def _process(packageId, processingLineId):
    return await _js_warehouse.processPackage(packageId, processingLineId)


async def _print(packageId, processingLineId):
    return str(await _js_warehouse.print(packageId, processingLineId))


async def _ship(packageId, shippingLane):
    return await _js_warehouse.ship(packageId, shippingLane)


def _queue_length(shippingLane):
    return int(_js_warehouse.getShippingLaneQueueLength(shippingLane))


# Expose the API on the module, so run(w) receives an object with these methods.
_api = {
    "unload": _unload,
    "pushToProcessingLine": _push,
    "processPackage": _process,
    "print": _print,
    "ship": _ship,
    "getShippingLaneQueueLength": _queue_length,
}
for _name, _fn in _api.items():
    setattr(warehouse, _name, _fn)
    setattr(Warehouse, _name, staticmethod(_fn))

warehouse.Warehouse = Warehouse
warehouse.Package = Package

# Inject into sys.modules so 'import warehouse' works
sys.modules["warehouse"] = warehouse
