def get_hover(code, line, column, stubs_content):
    import jedi
    import os
    
    # Setup the stubs directory
    if not os.path.exists('/stubs'):
        os.makedirs('/stubs')

    # Ensure stubs are up to date
    with open('/stubs/warehouse.pyi', 'w') as f:
        f.write(stubs_content)

    project = jedi.Project(path='/', added_sys_path=['/stubs'])
    script = jedi.Script(code, project=project)

    # Get help/documentation for the current position
    help_items = script.help(line, column)
    
    if not help_items:
        help_items = script.infer(line, column)

    res = []
    for h in help_items:
        try:
            # Title: Full Name
            content = f"### {h.full_name}\n"
            
            # Signature block
            if hasattr(h, 'description') and h.description:
                # Jedi's description often contains the signature
                content += f"```python\n{h.description}\n```\n"
            
            # Docstring section
            doc = h.docstring()
            if doc:
                # Standard Python docstring dedent logic
                import inspect
                doc = inspect.cleandoc(doc)

                content += f"---\n{doc}"
            
            res.append({
                'value': content
            })
        except Exception:
            continue
    return res
