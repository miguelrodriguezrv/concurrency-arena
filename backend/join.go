package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
)

// JoinRequest is the JSON payload sent to the /api/join HTTP endpoint.
type JoinRequest struct {
	Name       string     `json:"name" zod:"min:1"`
	Role       ClientRole `json:"role"`
	RoomSecret string     `json:"roomSecret"`
}

// JoinResponse is returned upon successful authentication.
type JoinResponse struct {
	Token       string `json:"token"`
	Name        string `json:"name"`
	Reconnected bool   `json:"reconnected"`
}

// HandleJoin processes the initial handshake for both Students and Instructors.
func HandleJoin(hub *Hub, adminSecret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// CORS Headers for development
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req JoinRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Printf("[API][/api/join] Bad Request: %v", err)
			http.Error(w, "Bad request", http.StatusBadRequest)
			return
		}

		if strings.TrimSpace(req.Name) == "" {
			log.Printf("[API][/api/join] Failed: Name is required")
			http.Error(w, "Name is required", http.StatusBadRequest)
			return
		}

		// Security: Instructors must provide the terminal-generated secret
		if req.Role == RoleInstructor && req.RoomSecret != adminSecret {
			log.Printf("[API][/api/join] Unauthorized: Invalid instructor secret for name %s", req.Name)
			http.Error(w, "Invalid room secret", http.StatusUnauthorized)
			return
		}

		if req.Role != RoleInstructor && req.Role != RoleStudent {
			log.Printf("[API][/api/join] Bad Request: Invalid role %s", req.Role)
			http.Error(w, "Invalid role", http.StatusBadRequest)
			return
		}

		reconnected := false
		var token string
		name := strings.TrimSpace(req.Name)
		email := ""
		if req.Role == RoleStudent {
			// Only students are bound to their Cloudflare Access email.
			email = AccessEmail(r)
		}

		// An email plays under one name only.
		if owned, ok := hub.GetSessionByEmail(email); ok && NormalizeName(owned.Name) != NormalizeName(name) {
			log.Printf("[API][/api/join] Conflict: %s already plays as %s", email, owned.Name)
			http.Error(w, fmt.Sprintf("You're already playing as %s.", owned.Name), http.StatusConflict)
			return
		}

		// Session Management: Check if this user is returning
		if existingSession, exists := hub.GetSessionByName(name); exists {
			if existingSession.Role != req.Role {
				log.Printf("[API][/api/join] Conflict: Name %s already taken by role %s", name, existingSession.Role)
				http.Error(w, "Name already taken", http.StatusConflict)
				return
			}
			// A name bound to an email can only be used by that email.
			if existingSession.Email != "" && existingSession.Email != email {
				log.Printf("[API][/api/join] Conflict: Name %s belongs to another email", name)
				http.Error(w, fmt.Sprintf("%s is already taken by someone else. Pick another name, e.g. %s 2.", existingSession.Name, existingSession.Name), http.StatusConflict)
				return
			}
			token = existingSession.Token
			name = existingSession.Name // keep the name as first typed
			reconnected = true
			log.Printf("[API][/api/join] Session Restored: %s (%s)", name, req.Role)
		} else {
			// Create a new secure session token
			token = generateToken(16)
			hub.CreateSession(token, name, req.Role, email)
			log.Printf("[API][/api/join] New Session: %s (%s) %s", name, req.Role, email)
		}

		resp := JoinResponse{
			Token:       token,
			Name:        name,
			Reconnected: reconnected,
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			log.Printf("[API][/api/join] Error encoding response: %v", err)
		}
	}
}
