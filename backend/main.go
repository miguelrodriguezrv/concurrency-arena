package main

import (
	"crypto/rand"
	"encoding/hex"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
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

	// Persistence: restore the previous state and save changes periodically.
	// STATE_FILE="" disables it (purely in-memory, as before).
	stateFile, ok := os.LookupEnv("STATE_FILE")
	if !ok {
		stateFile = "/data/arena-state.json"
	}
	if stateFile != "" {
		if err := hub.LoadState(stateFile); err != nil {
			log.Fatalf("[STATE] Failed to load %s: %v (fix or delete the file)", stateFile, err)
		}
		go hub.RunSaver(stateFile, 5*time.Second)

		// Save once more on shutdown (docker stop / restart sends SIGTERM).
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGTERM, os.Interrupt)
		go func() {
			<-sig
			if err := hub.SaveState(stateFile); err != nil {
				log.Printf("[STATE] Final save failed: %v", err)
			} else {
				log.Printf("[STATE] Saved to %s", stateFile)
			}
			os.Exit(0)
		}()
	}

	// Start the hub's event loop in its own goroutine
	go hub.Run()

	// Generate the ephemeral secret required for Instructor access.
	// This ensures that only someone with access to the server console
	// can join with administrative privileges.
	// ADMIN_SECRET fixes it across restarts; otherwise a random one is generated.
	adminSecret := os.Getenv("ADMIN_SECRET")
	if adminSecret == "" {
		adminSecret = generateToken(3) // 6 hex characters
	}
	log.Printf("===================================================")
	log.Printf("ADMIN SECRET: %s", adminSecret)
	log.Printf("===================================================")

	// Routes
	// ---------------------------------------------------------

	// HTTP Handshake: Validates names, manages sessions, and hands out tokens.
	// Moved under /api/* to keep API routes separate from the SPA.
	http.HandleFunc("/api/join", HandleJoin(hub, adminSecret))

	// Cloudflare Access identity (if any) for the join page.
	http.HandleFunc("/api/whoami", HandleWhoAmI(hub))

	// WebSocket: The real-time relay for code sync and metrics.
	// WebSocket endpoint moved under /api/ws to keep API namespace consistent.
	http.HandleFunc("/api/ws", func(w http.ResponseWriter, r *http.Request) {
		ServeWs(hub, w, r)
	})

	// Health Check / Basic Info
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.Write([]byte("Concurrency Arena Relay Server is running.\nConnect to /api/ws to establish a WebSocket connection."))
	})

	log.Printf("Starting Concurrency Arena relay server on %s", *addr)

	// Start the HTTP server
	if err := http.ListenAndServe(*addr, nil); err != nil {
		log.Fatal("ListenAndServe Error: ", err)
	}
}
