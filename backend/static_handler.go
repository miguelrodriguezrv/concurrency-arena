package main

import (
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// registerStaticHandler sets up serving of the SPA build in 'staticDir'.
// It assumes API routes like /join and /ws are registered separately.
// This should be called after API handlers are registered.
func registerStaticHandler(staticDir string) {
	if _, err := os.Stat(staticDir); os.IsNotExist(err) {
		log.Printf("[STATIC] Warning: static dir %s does not exist; SPA will not be served", staticDir)
		return
	}

	fs := http.FileServer(http.Dir(staticDir))

	// Serve assets (CSS/JS/images) normally if present
	http.Handle("/static/", http.StripPrefix("/static/", fs))
	// Also serve direct files from root (e.g. /favicon.ico)
	http.Handle("/assets/", http.StripPrefix("/assets/", fs))

	// SPA fallback: for any GET request not matching an API route, serve index.html.
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Only handle GET requests here
		if r.Method != http.MethodGet {
			http.NotFound(w, r)
			return
		}

		// Prevent shadowing API endpoints (ensure they exist earlier)
		// If a file exists on disk for the request path, serve it
		filePath := path.Clean(r.URL.Path)
		if filePath == "/" || strings.HasSuffix(filePath, "/") {
			// root or directory -> serve index.html
			http.ServeFile(w, r, filepath.Join(staticDir, "index.html"))
			return
		}
		// Otherwise check for actual file on disk
		localPath := filepath.Join(staticDir, filePath)
		if _, err := os.Stat(localPath); err == nil {
			// file exists, serve it
			http.ServeFile(w, r, localPath)
			return
		}

		// Fallback to index.html (SPA entry) for client-side routing
		http.ServeFile(w, r, filepath.Join(staticDir, "index.html"))
	})
}
