def get_diagnostics(code, stubs_content):
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
    
    # Jedi 0.19+ get_syntax_errors()
    errors = script.get_syntax_errors()
    
    res = []
    for e in errors:
        try:
            res.append({
                'line': e.line,
                'column': e.column,
                'until_line': e.until_line,
                'until_column': e.until_column,
                'message': e.message,
                'severity': 'error'
            })
        except Exception:
            continue

    # Fallback: Use native compile() for basic syntax/indentation errors
    # if Jedi didn't find any (common in older versions or specific cases)
    if not res:
        try:
            compile(code, "<editor>", "exec")
        except SyntaxError as e:
            # Handle both SyntaxError and IndentationError
            res.append({
                'line': e.lineno if e.lineno is not None else 1,
                'column': e.offset - 1 if e.offset is not None else 0,
                'until_line': e.end_lineno if hasattr(e, 'end_lineno') and e.end_lineno is not None else (e.lineno if e.lineno is not None else 1),
                'until_column': e.end_offset - 1 if hasattr(e, 'end_offset') and e.end_offset is not None else (e.offset if e.offset is not None else 1),
                'message': e.msg,
                'severity': 'error'
            })
        except Exception:
            pass

    return res
