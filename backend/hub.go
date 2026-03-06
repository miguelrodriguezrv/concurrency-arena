package main

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"
)

// StudentState holds the latest known state for a student.
// Using json.RawMessage allows the server to remain a "dumb relay"
// without needing to know the exact shape of the payload.
type StudentState struct {
	Name      string          `json:"name"`
	Code      json.RawMessage `json:"code"`
	Metrics   json.RawMessage `json:"metrics"`
	Connected bool            `json:"connected"`
}

// Session holds authentication information for a connected user.
type Session struct {
	Token string
	Name  string
	Role  ClientRole
}

// Hub maintains the set of active clients, handles routing, and stores state.
type Hub struct {
	sessions   map[string]*Session
	sessionsMu sync.RWMutex

	students    map[string]*Client
	instructors map[string]*Client
	clientsMu   sync.RWMutex

	// studentStates stores the latest code snippet and metrics for every StudentID
	studentStates map[string]*StudentState
	stateMu       sync.RWMutex

	// Inbound messages from the clients
	broadcast chan Message

	// Register requests from the clients
	register chan *Client

	// Unregister requests from clients
	unregister chan *Client
}

// NewHub creates and initializes a new Hub
func NewHub() *Hub {
	return &Hub{
		broadcast:     make(chan Message),
		register:      make(chan *Client),
		unregister:    make(chan *Client),
		students:      make(map[string]*Client),
		instructors:   make(map[string]*Client),
		studentStates: make(map[string]*StudentState),
		sessions:      make(map[string]*Session),
	}
}

// GetSessionByName retrieves a session by user name
func (h *Hub) GetSessionByName(name string) (*Session, bool) {
	h.sessionsMu.RLock()
	defer h.sessionsMu.RUnlock()
	for _, s := range h.sessions {
		if s.Name == name {
			return s, true
		}
	}
	return nil, false
}

// CreateSession generates a new session for a user
func (h *Hub) CreateSession(token, name string, role ClientRole) *Session {
	h.sessionsMu.Lock()
	defer h.sessionsMu.Unlock()

	session := &Session{
		Token: token,
		Name:  name,
		Role:  role,
	}
	h.sessions[token] = session
	return session
}

// GetSession retrieves a session by token
func (h *Hub) GetSession(token string) (*Session, bool) {
	h.sessionsMu.RLock()
	defer h.sessionsMu.RUnlock()
	session, ok := h.sessions[token]
	return session, ok
}

// GetStudentState retrieves a student's state for restoration
func (h *Hub) GetStudentState(name string) (*StudentState, bool) {
	h.stateMu.RLock()
	defer h.stateMu.RUnlock()
	state, exists := h.studentStates[name]
	return state, exists
}

// AdminCommandPayload describes the expected JSON payload for admin commands.
// We keep Code as json.RawMessage so the hub can remain a dumb relay.
type AdminCommandPayload struct {
	Action string          `json:"action"`
	Code   json.RawMessage `json:"code,omitempty"`
	Target string          `json:"target,omitempty"`
}

// Run starts the hub's main event loop
func (h *Hub) Run() {
	// go func() {
	// 	for range time.Tick(5 * time.Second) {
	// 		h.clientsMu.RLock()
	// 		instrCount := len(h.instructors)
	// 		studCount := len(h.students)
	// 		h.clientsMu.RUnlock()

	// 		h.stateMu.RLock()
	// 		knownStudents := len(h.studentStates)
	// 		h.stateMu.RUnlock()

	// 		log.Printf("[WS] hub.status: instructors=%d students=%d knownStates=%d", instrCount, studCount, knownStudents)
	// 	}
	// }()
	log.Printf("[WS] hub.Run started")
	defer func() {
		if r := recover(); r != nil {
			log.Printf("================[WS] hub.Run recovered panic: %v", r)
		}
	}()
	for {
		select {
		case client := <-h.register:
			// Acquire lock only to mutate the clients maps
			h.clientsMu.Lock()
			switch client.Role {
			case RoleInstructor:
				h.instructors[client.ID] = client
			case RoleStudent:
				h.students[client.ID] = client
			}
			log.Printf("[WS] %s connected: %s", client.Role, client.ID)
			h.clientsMu.Unlock()

			if client.Role == RoleInstructor {
				go func(c *Client) {
					h.stateMu.RLock()
					defer h.stateMu.RUnlock()
					log.Printf("[WS] Sending current state of all students (%d) to instructor: %s", len(h.studentStates), c.ID)
					for _, state := range h.studentStates {
						// 1. Send the presence status
						c.send <- Message{
							Type:     MsgTypePresenceUpdate,
							Payload:  json.RawMessage(fmt.Sprintf("%t", state.Connected)),
							SenderID: state.Name,
							Role:     RoleStudent,
						}
						// 2. Send the latest code if available
						if state.Code != nil {
							c.send <- Message{
								Type:     MsgTypeCodeSync,
								Payload:  state.Code,
								SenderID: state.Name,
								Role:     RoleStudent,
							}
						}
						// 3. Send metrics if available
						if state.Metrics != nil {
							c.send <- Message{
								Type:     MsgTypeMetricPulse,
								Payload:  state.Metrics,
								SenderID: state.Name,
								Role:     RoleStudent,
							}
						}
					}
				}(client)
				continue
			}

			if client.Role == RoleStudent {
				h.stateMu.Lock()
				state, exists := h.studentStates[client.ID]
				if !exists {
					log.Printf("[WS] New Student joined: %s", client.ID)
					state = &StudentState{
						Name:      client.ID,
						Connected: true,
					}
					h.studentStates[client.ID] = state
				} else {
					state.Connected = true
					log.Printf("[WS] Student reconnected: %s (Restoring State)", client.ID)
					if state.Code != nil {
						client.send <- Message{
							Type:     MsgTypeCodeSync,
							Payload:  state.Code,
							SenderID: state.Name,
							Role:     RoleStudent,
						}
					}
				}
				h.stateMu.Unlock()

				// Notify instructors that a student is now online
				presencePayload, _ := json.Marshal(true)
				h.broadcastToInstructors(Message{
					Type:     MsgTypePresenceUpdate,
					Payload:  presencePayload,
					SenderID: client.ID,
					Role:     RoleStudent,
				})
			}

		case client := <-h.unregister:
			h.clientsMu.Lock()
			switch client.Role {
			case RoleInstructor:
				if _, ok := h.instructors[client.ID]; ok {
					delete(h.instructors, client.ID)
					close(client.send)
					log.Printf("[WS] Instructor disconnected: %s", client.ID)
				}
			case RoleStudent:
				if _, ok := h.students[client.ID]; ok {
					delete(h.students, client.ID)
					close(client.send)
					log.Printf("[WS] Student disconnected: %s", client.ID)

					h.stateMu.Lock()
					if state, exists := h.studentStates[client.ID]; exists {
						state.Connected = false
					}
					h.stateMu.Unlock()
				}
			}
			h.clientsMu.Unlock()

			// Notify instructors that a student is now offline
			if client.Role == RoleStudent {
				presencePayload, _ := json.Marshal(false)
				h.broadcastToInstructors(Message{
					Type:     MsgTypePresenceUpdate,
					Payload:  presencePayload,
					SenderID: client.ID,
					Role:     RoleStudent,
				})
			}

		case msg := <-h.broadcast:
			h.handleMessage(msg)
		}
	}
}

// broadcastToInstructors sends a message to all connected instructors
func (h *Hub) broadcastToInstructors(msg Message) {
	h.clientsMu.RLock()
	defer h.clientsMu.RUnlock()

	for _, instructor := range h.instructors {
		select {
		case instructor.send <- msg:
		default:
			// Client's send channel is stuck/full
		}
	}
}

// handleMessage processes an incoming message, updates state, and routes it to the correct recipients
func (h *Hub) handleMessage(msg Message) {
	log.Printf("[WS] Handling message from %s (Role: %s, Type: %s)", msg.SenderID, msg.Role, msg.Type)
	// 1. State Management: Store the latest code snippet or metrics
	if msg.Role == RoleStudent {
		h.stateMu.Lock()
		state, exists := h.studentStates[msg.SenderID]
		if !exists {
			state = &StudentState{
				Name:      msg.SenderID,
				Connected: true,
			}
			h.studentStates[msg.SenderID] = state
		}

		switch msg.Type {
		case MsgTypeCodeSync:
			state.Code = msg.Payload
		case MsgTypeMetricPulse:
			state.Metrics = msg.Payload
		}
		h.stateMu.Unlock()
	}

	// 2. The Relay Logic: Route the message
	switch msg.Type {
	case MsgTypeCodeSync, MsgTypeMetricPulse:
		h.broadcastToInstructors(msg)

	case MsgTypeAdminCommand:
		// Instructor -> Server -> Students (supports optional target)
		if msg.Role == RoleInstructor {
			// Try to parse the payload to check for an optional "target" field.
			var payload AdminCommandPayload
			if err := json.Unmarshal(msg.Payload, &payload); err != nil {
				// If parsing fails, log and fall back to broadcasting to all students.
				log.Printf("[WS] AdminCommand: invalid payload, broadcasting to all students: %v", err)
				for _, student := range h.students {
					select {
					case student.send <- msg:
					default:
						// Client's send channel is stuck/full
					}
				}
				return
			}

			// If a specific target is set, deliver only to that student (if connected).
			if payload.Target != "" {
				if targetClient, ok := h.students[payload.Target]; ok {
					select {
					case targetClient.send <- msg:
					default:
						// target client's send channel is stuck/full
					}
				} else {
					log.Printf("[WS] AdminCommand: target student %s not connected, ignoring", payload.Target)
				}
				return
			}

			// No target specified, broadcast to all students (legacy behavior)
			for _, student := range h.students {
				select {
				case student.send <- msg:
				default:
					// Client's send channel is stuck/full
				}
			}
		}
	}
}
