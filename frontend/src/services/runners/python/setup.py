async def setup():
    # Micropip and Jedi should already be loaded by pyodide.loadPackage
    # but we import them here for the script context
    import os
    import sys

    print("Initializing Jedi environment...")

    # Setup the stubs directory
    if not os.path.exists("/stubs"):
        os.makedirs("/stubs")

    # Add stubs to the search path for Jedi
    if "/stubs" not in sys.path:
        sys.path.append("/stubs")


def write_stubs(stubs_content):
    with open("/stubs/warehouse.pyi", "w") as f:
        f.write(stubs_content)


# We'll call these from JS
# setup()
