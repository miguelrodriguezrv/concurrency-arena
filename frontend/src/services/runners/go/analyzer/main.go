//go:build js && wasm

package main

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/scanner"
	"go/token"
	"go/types"
	"strings"
	"syscall/js"
)

// Diagnostic represents a syntax or type error
type Diagnostic struct {
	Line    int    `json:"line"`
	Column  int    `json:"column"`
	Message string `json:"message"`
}

// Symbol represents a completion or hover item
type Symbol struct {
	Name          string `json:"name"`
	Detail        string `json:"detail"`
	Documentation string `json:"documentation"`
	Kind          string `json:"kind"`
}

// SignatureHelp represents function parameter hints
type SignatureHelp struct {
	Signatures  []Signature `json:"signatures"`
	ActiveSig   int         `json:"activeSignature"`
	ActiveParam int         `json:"activeParameter"`
}

type Signature struct {
	Label      string      `json:"label"`
	Doc        string      `json:"documentation"`
	Parameters []Parameter `json:"parameters"`
}

type Parameter struct {
	Label string `json:"label"`
	Doc   string `json:"documentation"`
}

func main() {
	c := make(chan struct{})

	js.Global().Set("getDiagnostics", js.FuncOf(getDiagnostics))
	js.Global().Set("getCompletions", js.FuncOf(getCompletions))
	js.Global().Set("getHover", js.FuncOf(getHover))
	js.Global().Set("getSignatureHelp", js.FuncOf(getSignatureHelp))

	fmt.Println("Go Analyzer WASM (Concurrency Master) Initialized")
	<-c
}

// --- Package Source Mocks ---

const fmtMock = `
package fmt
func Println(a ...any) (n int, err error) { return 0, nil }
func Printf(format string, a ...any) (n int, err error) { return 0, nil }
func Sprintf(format string, a ...any) string { return "" }
`

const syncMock = `
package sync
type Mutex struct{}
func (m *Mutex) Lock() {}
func (m *Mutex) Unlock() {}

type WaitGroup struct{}
func (wg *WaitGroup) Add(delta int) {}
func (wg *WaitGroup) Done() {}
func (wg *WaitGroup) Wait() {}
`

const atomicMock = `
package atomic
func AddInt64(addr *int64, delta int64) (new int64) { return 0 }
func LoadInt64(addr *int64) (val int64) { return 0 }
`

const timeMock = `
package time
type Duration int64
const (
	Nanosecond  Duration = 1
	Microsecond          = 1000 * Nanosecond
	Millisecond          = 1000 * Microsecond
	Second               = 1000 * Millisecond
)
func Sleep(d Duration) {}
`

const contextMock = `
package context
type Context interface {
	Deadline() (deadline time.Time, ok bool)
	Done() <-chan struct{}
	Err() error
	Value(key any) any
}
func Background() Context { return nil }
`

const errorsMock = `
package errors
func New(text string) error { return nil }
`

const warehouseMock = `
package warehouse
type Package struct {
	ID             int
	ProcessingTime int
}
func Unload() (*Package, error) { return nil, nil }
func PushToProcessingLine(id int, line int) error { return nil }
func ProcessPackage(id int, line int) error { return nil }
func Print(id int, line int) (string, error) { return "", nil }
func Ship(id int, lane string) error { return nil }
func GetShippingLineQueueLength(lane string) int { return 0 }
`

// CustomArenaImporter is a pure-virtual importer that provides high-fidelity mocks
// for the standard library packages allowed in the Concurrency Arena.
type CustomArenaImporter struct {
	packages map[string]*types.Package
	fset     *token.FileSet
}

func NewArenaImporter(fset *token.FileSet) *CustomArenaImporter {
	return &CustomArenaImporter{
		packages: make(map[string]*types.Package),
		fset:     fset,
	}
}

func (i *CustomArenaImporter) Import(path string) (*types.Package, error) {
	if pkg, ok := i.packages[path]; ok {
		return pkg, nil
	}

	var source string
	switch path {
	case "fmt":
		source = fmtMock
	case "sync":
		source = syncMock
	case "sync/atomic":
		source = atomicMock
	case "time":
		source = timeMock
	case "context":
		source = contextMock
	case "errors":
		source = errorsMock
	case "warehouse":
		source = warehouseMock
	default:
		return nil, fmt.Errorf("package \"%s\" is not available in the Concurrency Arena", path)
	}

	// Parse and type-check the mock source
	f, err := parser.ParseFile(i.fset, path+".go", source, 0)
	if err != nil {
		return nil, err
	}

	// The package name in the source might be different from the path (e.g. sync/atomic -> atomic)
	pkgName := f.Name.Name
	pkg := types.NewPackage(path, pkgName)
	conf := types.Config{
		Importer: i, // Allow recursive imports if needed (e.g. context needs time)
	}
	info := &types.Info{}
	check := types.NewChecker(&conf, i.fset, pkg, info)
	if err := check.Files([]*ast.File{f}); err != nil {
		return nil, err
	}

	i.packages[path] = pkg
	return pkg, nil
}

// --- Type Checking Engine ---

func typeCheck(fset *token.FileSet, code string) (*ast.File, *types.Info, error) {
	f, err := parser.ParseFile(fset, "student.go", code, parser.AllErrors|parser.DeclarationErrors)
	if err != nil && f == nil {
		return nil, nil, err
	}

	info := &types.Info{
		Types:      make(map[ast.Expr]types.TypeAndValue),
		Defs:       make(map[*ast.Ident]types.Object),
		Uses:       make(map[*ast.Ident]types.Object),
		Selections: make(map[*ast.SelectorExpr]*types.Selection),
		Scopes:     make(map[ast.Node]*types.Scope),
	}

	arenaImporter := NewArenaImporter(fset)

	mainPkg := types.NewPackage("main", "main")
	scope := mainPkg.Scope()

	// Inject Warehouse API into the main scope (no import needed)
	if whPkg, err := arenaImporter.Import("warehouse"); err == nil {
		whScope := whPkg.Scope()
		for _, name := range whScope.Names() {
			obj := whScope.Lookup(name)
			if scope.Lookup(name) == nil {
				scope.Insert(obj)
			}
		}
	}

	// We MUST NOT manually insert PkgName objects before the checker runs if we want to avoid collisions.
	// Instead, we let the Importer handle the discovery during Checker.Files.

	conf := types.Config{
		Importer: arenaImporter,
		Error:    func(err error) {},
	}

	checker := types.NewChecker(&conf, fset, mainPkg, info)
	checkErr := checker.Files([]*ast.File{f})

	return f, info, checkErr
}

// --- JS Interface Functions ---

func getDiagnostics(this js.Value, args []js.Value) any {
	if len(args) < 1 {
		return js.ValueOf("[]")
	}
	code := args[0].String()
	fset := token.NewFileSet()
	var diagnostics []Diagnostic

	_, _, err := typeCheck(fset, code)
	if err != nil {
		if errList, ok := err.(scanner.ErrorList); ok {
			for _, e := range errList {
				diagnostics = append(diagnostics, Diagnostic{Line: e.Pos.Line, Column: e.Pos.Column, Message: e.Msg})
			}
		} else if typeErr, ok := err.(types.Error); ok {
			pos := fset.Position(typeErr.Pos)
			diagnostics = append(diagnostics, Diagnostic{Line: pos.Line, Column: pos.Column, Message: typeErr.Msg})
		} else {
			// Catch any other errors
			diagnostics = append(diagnostics, Diagnostic{Line: 1, Column: 1, Message: err.Error()})
		}
	}

	result, _ := json.Marshal(diagnostics)
	return js.ValueOf(string(result))
}

func getCompletions(this js.Value, args []js.Value) any {
	code := args[0].String()
	line, col := args[1].Int(), args[2].Int()

	fset := token.NewFileSet()
	f, info, _ := typeCheck(fset, code)

	var suggestions []Symbol
	pos := findPos(fset, line, col)

	// Check if we are in a selector (X.Sel)
	var selector *ast.SelectorExpr
	if f != nil {
		ast.Inspect(f, func(n ast.Node) bool {
			if n == nil {
				return true
			}
			if n.Pos() <= pos && pos <= n.End() {
				if s, ok := n.(*ast.SelectorExpr); ok {
					// Only use the selector if the cursor is at or after the dot
					if pos >= s.Sel.Pos() || pos >= s.X.End() {
						selector = s
					}
				}
			}
			return true
		})
	}

	if selector != nil && info != nil {
		// Handle package selectors (fmt.Println) or struct/interface selectors (p.ID)
		if pkgIdent, ok := selector.X.(*ast.Ident); ok {
			if obj, ok := info.Uses[pkgIdent]; ok {
				if pkgName, ok := obj.(*types.PkgName); ok {
					// It's a package!
					scope := pkgName.Imported().Scope()
					for _, name := range scope.Names() {
						if ast.IsExported(name) {
							obj := scope.Lookup(name)
							kind := "variable"
							if _, ok := obj.(*types.Func); ok {
								kind = "function"
							} else if _, ok := obj.(*types.TypeName); ok {
								kind = "class"
							} else if _, ok := obj.(*types.Const); ok {
								kind = "constant"
							}
							suggestions = append(suggestions, Symbol{
								Name:          name,
								Detail:        obj.Type().String(),
								Documentation: getDocFor(name), // We can expand this
								Kind:          kind,
							})
						}
					}
				}
			}
		}

		// Handle methods and fields on types
		if tv, ok := info.Types[selector.X]; ok {
			typ := tv.Type
			// Look up methods and fields via Selections if available
			// or iterate through the type's method set
			addMembersForType(&suggestions, typ)
		}
	} else {
		// Global scope
		// 1. Warehouse API & Mocked symbols in main scope
		if f != nil && info != nil {
			mainScope := info.Scopes[f]
			if mainScope == nil {
				// Fallback to searching the whole tree if Scope[f] is nil
				for _, scope := range info.Scopes {
					if scope != nil && scope.Parent() == types.Universe {
						mainScope = scope
						break
					}
				}
			}

			if mainScope != nil {
				for _, name := range mainScope.Names() {
					obj := mainScope.Lookup(name)
					kind := "variable"
					if _, ok := obj.(*types.Func); ok {
						kind = "function"
					} else if _, ok := obj.(*types.TypeName); ok {
						kind = "class"
					}
					suggestions = append(suggestions, Symbol{
						Name:          name,
						Detail:        obj.Type().String(),
						Documentation: getDocFor(name),
						Kind:          kind,
					})
				}
			}
		}

		suggestions = append(suggestions,
			Symbol{Name: "go func", Kind: "snippet", Detail: "Start a new goroutine"},
			Symbol{Name: "select", Kind: "snippet", Detail: "Wait on multiple channel operations"},
			Symbol{Name: "for range", Kind: "snippet", Detail: "Iterate over a collection or channel"},
		)
	}

	result, _ := json.Marshal(suggestions)
	return js.ValueOf(string(result))
}

func addMembersForType(suggestions *[]Symbol, typ types.Type) {
	// Pointers
	if ptr, ok := typ.Underlying().(*types.Pointer); ok {
		typ = ptr.Elem()
	}

	// Struct fields
	if str, ok := typ.Underlying().(*types.Struct); ok {
		for i := 0; i < str.NumFields(); i++ {
			f := str.Field(i)
			*suggestions = append(*suggestions, Symbol{
				Name:   f.Name(),
				Detail: f.Type().String(),
				Kind:   "field",
			})
		}
	}

	// Methods (including via pointer receivers)
	// We use MethodSet for a more complete picture
	mset := types.NewMethodSet(types.NewPointer(typ))
	for i := 0; i < mset.Len(); i++ {
		m := mset.At(i).Obj()
		*suggestions = append(*suggestions, Symbol{
			Name:   m.Name(),
			Detail: m.Type().String(),
			Kind:   "method",
		})
	}
}

func getDocFor(name string) string {
	docs := map[string]string{
		"Unload":                     "Unloads the next package from the arrival dock. Returns the package and an error if the dock is empty.",
		"PushToProcessingLine":       "Moves a package with the given ID to the specified processing line.",
		"ProcessPackage":             "Performs work on a package at the specified processing line. This is a blocking operation.",
		"Print":                      "Generates a shipping label for the package. Returns the label string.",
		"Ship":                       "Sends the package to the final shipping lane.",
		"GetShippingLineQueueLength": "Returns the number of packages currently waiting in the specified shipping lane.",
		"Println":                    "Println formats using the default formats for its operands and writes to standard output.",
		"Printf":                     "Printf formats according to a format specifier and writes to standard output.",
		"WaitGroup":                  "A WaitGroup waits for a collection of goroutines to finish.",
		"Mutex":                      "A Mutex is a mutual exclusion lock. The zero value for a Mutex is an unlocked mutex.",
	}
	return docs[name]
}

func getHover(this js.Value, args []js.Value) any {
	code := args[0].String()
	line, col := args[1].Int(), args[2].Int()

	fset := token.NewFileSet()
	f, info, _ := typeCheck(fset, code)
	if f == nil || info == nil {
		return js.Null()
	}

	pos := findPos(fset, line, col)
	var obj types.Object

	ast.Inspect(f, func(n ast.Node) bool {
		if n == nil {
			return true
		}
		if n.Pos() <= pos && pos <= n.End() {
			if ident, ok := n.(*ast.Ident); ok {
				if o := info.Uses[ident]; o != nil {
					obj = o
				} else if o := info.Defs[ident]; o != nil {
					obj = o
				}
			}
		}
		return true
	})

	if obj != nil {
		doc := getDocFor(obj.Name())
		res, _ := json.Marshal(map[string]string{
			"detail": obj.String(),
			"doc":    doc,
		})
		return js.ValueOf(string(res))
	}

	return js.Null()
}

func getSignatureHelp(this js.Value, args []js.Value) any {
	code := args[0].String()
	line, col := args[1].Int(), args[2].Int()

	fset := token.NewFileSet()
	f, info, _ := typeCheck(fset, code)
	if f == nil || info == nil {
		return js.Null()
	}

	pos := findPos(fset, line, col)

	// Find the innermost CallExpr that contains the cursor
	var call *ast.CallExpr
	ast.Inspect(f, func(n ast.Node) bool {
		if n == nil {
			return true
		}
		if n.Pos() <= pos && pos <= n.End() {
			if c, ok := n.(*ast.CallExpr); ok {
				// Cursor must be after the opening parenthesis
				if pos > c.Lparen && pos <= c.Rparen {
					call = c
				}
			}
		}
		return true
	})

	if call == nil {
		return js.Null()
	}

	// Identify which parameter we are currently typing
	activeParam := 0
	for i, arg := range call.Args {
		if pos > arg.End() {
			activeParam = i + 1
		}
	}

	// Look up the function type
	var sig *types.Signature
	if tv, ok := info.Types[call.Fun]; ok {
		if s, ok := tv.Type.Underlying().(*types.Signature); ok {
			sig = s
		}
	}

	if sig != nil {
		var params []Parameter
		paramNames := []string{}

		pTuple := sig.Params()
		for i := 0; i < pTuple.Len(); i++ {
			p := pTuple.At(i)
			label := fmt.Sprintf("%s %s", p.Name(), p.Type().String())
			if sig.Variadic() && i == pTuple.Len()-1 {
				label = fmt.Sprintf("%s ...%s", p.Name(), p.Type().(*types.Slice).Elem().String())
			}
			params = append(params, Parameter{
				Label: label,
				Doc:   "", // Could add per-param docs if needed
			})
			paramNames = append(paramNames, label)
		}

		funcName := "func"
		if ident, ok := call.Fun.(*ast.Ident); ok {
			funcName = ident.Name
		} else if sel, ok := call.Fun.(*ast.SelectorExpr); ok {
			funcName = sel.Sel.Name
		}

		fullLabel := fmt.Sprintf("%s(%s)", funcName, strings.Join(paramNames, ", "))

		help := SignatureHelp{
			Signatures: []Signature{
				{
					Label:      fullLabel,
					Doc:        getDocFor(funcName),
					Parameters: params,
				},
			},
			ActiveSig:   0,
			ActiveParam: activeParam,
		}

		// Handle variadic overflow
		if sig.Variadic() && activeParam >= len(params) {
			help.ActiveParam = len(params) - 1
		}

		result, _ := json.Marshal(help)
		return js.ValueOf(string(result))
	}

	return js.Null()
}

func findPos(fset *token.FileSet, line, col int) token.Pos {
	f := fset.File(token.Pos(1))
	if f == nil {
		return token.NoPos
	}
	return token.Pos(f.LineStart(line)) + token.Pos(col-1)
}

func clamp(v, min, max int) int {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}
