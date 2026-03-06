package main

import "encoding/json"

// MessageType defines the category of the message being sent over the WebSocket
type MessageType string

const (
	// CODE_SYNC: Student -> Server -> Instructor (Raw text/code snippet)
	MsgTypeCodeSync MessageType = "CODE_SYNC"

	// METRIC_PULSE: Student -> Server -> Instructor (Heartbeat with current score/status)
	MsgTypeMetricPulse MessageType = "METRIC_PULSE"

	// ADMIN_COMMAND: Instructor -> Server -> All (Start, Stop, Reset, or Push Template)
	MsgTypeAdminCommand MessageType = "ADMIN_COMMAND"

	// PRESENCE_UPDATE: Server -> Instructor (Notify of student connection/disconnection)
	MsgTypePresenceUpdate MessageType = "PRESENCE_UPDATE"
)

// ClientRole defines the connection type
type ClientRole string

const (
	RoleInstructor ClientRole = "Instructor"
	RoleStudent    ClientRole = "Student"
)

// Message is the standard envelope for all WebSocket communication.
// Because the server is primarily a "dumb relay", we use json.RawMessage
// for the Payload. This allows the server to efficiently unmarshal the routing
// information (Type, SenderID, Role) without having to decode the actual contents
// of the payload before forwarding it on to the destination.
type Message struct {
	Type     MessageType     `json:"type"`
	SenderID string          `json:"senderId"`
	Role     ClientRole      `json:"role"`
	Payload  json.RawMessage `json:"payload,omitempty"`
}
