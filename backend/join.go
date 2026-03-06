package main

import (
	"encoding/json"
	"log"
	"net/http"
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

		if req.Name == "" {
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

		// Session Management: Check if this user is returning
		if existingSession, exists := hub.GetSessionByName(req.Name); exists {
			if existingSession.Role != req.Role {
				log.Printf("[API][/api/join] Conflict: Name %s already taken by role %s", req.Name, existingSession.Role)
				http.Error(w, "Name already taken", http.StatusConflict)
				return
			}
			token = existingSession.Token
			reconnected = true
			log.Printf("[API][/api/join] Session Restored: %s (%s)", req.Name, req.Role)
		} else {
			// Create a new secure session token
			token = generateToken(16)
			hub.CreateSession(token, req.Name, req.Role)
			log.Printf("[API][/api/join] New Session: %s (%s)", req.Name, req.Role)
		}

		resp := JoinResponse{
			Token:       token,
			Name:        req.Name,
			Reconnected: reconnected,
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			log.Printf("[API][/api/join] Error encoding response: %v", err)
		}
	}
}
