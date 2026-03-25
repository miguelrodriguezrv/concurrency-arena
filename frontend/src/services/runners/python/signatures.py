def get_signatures(code, line, column, stubs_content):
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
    
    signatures = script.get_signatures(line, column)
    
    res = []
    for s in signatures:
        try:
            params = []
            for p in s.params:
                params.append({
                    'label': p.name,
                    'documentation': p.docstring()
                })
            
            res.append({
                'label': s.to_string(),
                'documentation': s.docstring(),
                'activeParameter': s.index,
                'parameters': params
            })
        except Exception:
            continue
    return res
