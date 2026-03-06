package main

import (
	"crypto/rand"
	"encoding/hex"
	"flag"
	"log"
	"net/http"
)

// generateToken creates a random hex string of the specified byte length.
func generateToken(length int) string {
	b := make([]byte, length)
	if _, err := rand.Read(b); err != nil {
		log.Printf("[ERR] Failed to generate random token: %v", err)
		return "fallback-token"
	}
	return hex.EncodeToString(b)
}

var addr = flag.String("addr", ":8080", "http service address")

func main() {
	flag.Parse()

	// Initialize the central state and routing hub
	hub := NewHub()

	// Start the hub's event loop in its own goroutine
	go hub.Run()

	// Generate the ephemeral secret required for Instructor access.
	// This ensures that only someone with access to the server console
	// can join with administrative privileges.
	adminSecret := generateToken(3) // 6 hex characters
	log.Printf("===================================================")
	log.Printf("INSTRUCTOR SECRET: %s", adminSecret)
	log.Printf("===================================================")

	// Routes
	// ---------------------------------------------------------

	// HTTP Handshake: Validates names, manages sessions, and hands out tokens.
	// Moved under /api/* to keep API routes separate from the SPA.
	http.HandleFunc("/api/join", HandleJoin(hub, adminSecret))

	// WebSocket: The real-time relay for code sync and metrics.
	// WebSocket endpoint moved under /api/ws to keep API namespace consistent.
	http.HandleFunc("/api/ws", func(w http.ResponseWriter, r *http.Request) {
		ServeWs(hub, w, r)
	})

	// Health Check / Basic Info
	// Keep a lightweight health endpoint at /healthz; the SPA will be served from the static handler.
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.Write([]byte("Concurrency Arena Relay Server is running.\nConnect to /api/ws to establish a WebSocket connection."))
	})

	// Register the static SPA handler (serves the production frontend bundle from backend/static).
	// This should be called after API routes are registered so API endpoints take precedence.
	registerStaticHandler("static")

	log.Printf("Starting Concurrency Arena relay server on %s", *addr)

	// Start the HTTP server
	if err := http.ListenAndServe(*addr, nil); err != nil {
		log.Fatal("ListenAndServe Error: ", err)
	}
}
