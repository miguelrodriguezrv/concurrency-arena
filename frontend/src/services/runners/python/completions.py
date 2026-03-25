def get_completions(code, line, column, stubs_content):
    import jedi
    import json
    import os
    
    # Setup the stubs directory
    if not os.path.exists('/stubs'):
        os.makedirs('/stubs')

    # Ensure stubs are up to date
    with open('/stubs/warehouse.pyi', 'w') as f:
        f.write(stubs_content)

    project = jedi.Project(
        path='/',
        added_sys_path=['/stubs'],
    )
    
    script = jedi.Script(code, project=project)
    completions = script.complete(line, column)
    
    res = []
    for c in completions:
        try:
            res.append({
                'label': c.name,
                'kind': c.type,
                'detail': c.description,
                'doc': c.docstring(),
                'insertText': c.name
            })
        except Exception:
            continue
    return res
