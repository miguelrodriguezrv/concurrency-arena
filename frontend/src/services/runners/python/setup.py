async def setup():
    # Micropip and Jedi should already be loaded by pyodide.loadPackage
    # but we import them here for the script context
    import sys
    import os
    from types import ModuleType

    print("Initializing Jedi environment...")

    # Create a virtual module for warehouse to help Jedi
    try:
        import warehouse
    except ImportError:
        wh_mod = ModuleType('warehouse')
        wh_mod.__doc__ = "Warehouse API for Concurrency Arena"
        sys.modules['warehouse'] = wh_mod

    # Setup the stubs directory
    if not os.path.exists('/stubs'):
        os.makedirs('/stubs')

    # Add stubs to the search path for Jedi
    if '/stubs' not in sys.path:
        sys.path.append('/stubs')

def write_stubs(stubs_content):
    with open('/stubs/warehouse.pyi', 'w') as f:
        f.write(stubs_content)

# We'll call these from JS
# setup()
