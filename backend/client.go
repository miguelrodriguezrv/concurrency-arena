package main

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 512000
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	// Allow any origin for development purposes
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// Client is a middleman between the websocket connection and the hub.
type Client struct {
	hub  *Hub
	conn *websocket.Conn
	send chan Message
	ID   string
	Role ClientRole
}

// readPump pumps messages from the websocket connection to the hub.
//
// The application runs readPump in a per-connection goroutine. The application
// ensures that there is at most one reader on a connection by executing all
// reads from this goroutine.
func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()
	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error { c.conn.SetReadDeadline(time.Now().Add(pongWait)); return nil })
	for {
		var msg Message
		err := c.conn.ReadJSON(&msg)
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("error: %v", err)
			}
			break
		}

		// Ensure the message has the sender ID and role properly set
		// to prevent spoofing
		msg.SenderID = c.ID
		msg.Role = c.Role

		c.hub.broadcast <- msg
	}
}

// writePump pumps messages from the hub to the websocket connection.
//
// A goroutine running writePump is started for each connection. The
// application ensures that there is at most one writer to a connection by
// executing all writes from this goroutine.
func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// The hub closed the channel.
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			err := c.conn.WriteJSON(message)
			if err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// ServeWs handles websocket requests from the peer.
func ServeWs(hub *Hub, w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	token := query.Get("token")
	log.Printf("[WS] ServeWs: incoming token=%q", token)

	// Perform the websocket upgrade first so we can deliver a JSON payload
	// explaining invalid tokens on the same connection.
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Upgrade error:", err)
		return
	}

	// If token is missing or invalid, notify the client over the newly-upgraded socket
	// and close immediately. We intentionally do not register the connection in this case.
	if token == "" {
		log.Println("[WS] Missing token in query parameters (post-upgrade)")

		msg := Message{
			Type:     MessageType("INVALID_TOKEN"),
			SenderID: "",
			Role:     ClientRole(""),
			Payload:  json.RawMessage([]byte(`"missing token"`)),
		}
		// best-effort notify; ignore write errors
		_ = conn.WriteJSON(msg)
		_ = conn.Close()
		return
	}

	session, exists := hub.GetSession(token)
	if !exists {
		log.Printf("[WS] ServeWs: token not found in sessions map: %q", token)
		log.Println("[WS] Invalid or expired token - notifying client and closing connection")

		msg := Message{
			Type:     MessageType("INVALID_TOKEN"),
			SenderID: "",
			Role:     ClientRole(""),
			Payload:  json.RawMessage([]byte(`"invalid or expired token"`)),
		}
		_ = conn.WriteJSON(msg)
		_ = conn.Close()
		return
	}

	client := &Client{
		hub:  hub,
		conn: conn,
		send: make(chan Message, 256),
		ID:   session.Name,
		Role: session.Role,
	}
	client.hub.register <- client
	log.Printf("[WS] ServeWs: registration sent to hub for %s (%s)", client.ID, client.Role)

	// Allow collection of memory referenced by the caller by doing all work in
	// new goroutines.
	go client.writePump()
	go client.readPump()
}
