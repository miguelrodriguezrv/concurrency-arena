/**
 * A small, browser-friendly WebSocket client service with:
 * - automatic reconnect/backoff
 * - simple event subscription API (`on`/`off`)
 * - typed message parsing and selective validation for metric payloads
 *
 * This is intentionally lightweight and deliberately does not depend on Node `EventEmitter`.
 * The API is compatible with how the rest of the app consumes websocket events:
 * - subscribe with `on(event, cb)`
 * - start/stop the connection with `start(token)` / `stop()`
 * - send typed messages with `send(type, payload)`
 *
 */

import { MetricPayloadSchema } from "@/contracts/messages";

export type MessageType =
    | "CODE_SYNC"
    | "METRIC_PULSE"
    | "ADMIN_COMMAND"
    | "PRESENCE_UPDATE"
    | "INVALID_TOKEN";

export interface WebSocketMessage {
    type: MessageType;
    senderId?: string;
    role?: string;
    payload?: unknown;
}

type EventName =
    | "connecting"
    | "connected"
    | "disconnected"
    | "invalid_token"
    | "code_sync"
    | "metric_pulse"
    | "presence_update"
    | "admin_command"
    | "error"
    | "message"; // raw parsed message

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Callback = (arg?: any) => void;

/**
 * Small map-of-sets emitter.
 */
class Emitter {
    private listeners = new Map<string, Set<Callback>>();

    on(event: string, cb: Callback) {
        let set = this.listeners.get(event);
        if (!set) {
            set = new Set();
            this.listeners.set(event, set);
        }
        set.add(cb);
        return () => this.off(event, cb);
    }

    off(event: string, cb: Callback) {
        const set = this.listeners.get(event);
        if (!set) return;
        set.delete(cb);
        if (set.size === 0) this.listeners.delete(event);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    emit(event: string, payload?: any) {
        const set = this.listeners.get(event);
        if (!set) return;
        // Copy to avoid mutation during iteration
        Array.from(set).forEach((cb) => {
            try {
                cb(payload);
            } catch (err) {
                // Swallow handler errors to avoid crashing the emitter loop
                // Consumers should handle their own errors
                console.error("WS emitter callback error:", err);
            }
        });
    }
}

/**
 * WebSocket client with reconnection/backoff and typed event emits.
 */
export class WSClient {
    private ws: WebSocket | null = null;
    private token: string | null = null;
    private emitter = new Emitter();
    private reconnectAttempts = 0;
    private reconnectTimer: number | null = null;
    private explicitlyStopped = false;

    /**
     * Subscribe to events.
     * Common events:
     *  - 'connecting' | 'connected' | 'disconnected'
     *  - 'invalid_token'
     *  - 'code_sync' (payload: { senderId, payload })
     *  - 'metric_pulse' (payload: { senderId, payload })
     *  - 'presence_update' (payload: { senderId, connected })
     *  - 'admin_command' (payload: the command object)
     *  - 'error' (payload: Error)
     *  - 'message' (payload: raw WebSocketMessage)
     */
    on(event: EventName | string, cb: Callback) {
        return this.emitter.on(event, cb);
    }

    off(event: EventName | string, cb: Callback) {
        this.emitter.off(event, cb);
    }

    /**
     * Start or restart the connection with the provided token.
     */
    start(token: string) {
        this.explicitlyStopped = false;
        this.token = token;
        // If already connected or connecting to the same token, do nothing.
        if (
            this.ws &&
            (this.ws.readyState === WebSocket.OPEN ||
                this.ws.readyState === WebSocket.CONNECTING)
        )
            return;
        // Clear any pending reconnect timer
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.connect();
    }

    /**
     * Stop the connection gracefully and prevent automatic reconnects.
     */
    stop() {
        this.explicitlyStopped = true;
        this.clearReconnectTimer();
        if (this.ws) {
            try {
                this.ws.close(1000, "Client stopped");
            } catch {
                // ignore
            } finally {
                this.ws = null;
            }
        }
        this.emitter.emit("disconnected");
    }

    /**
     * Send a typed message over the socket. Returns true when send was attempted.
     */
    send(type: MessageType, payload: unknown) {
        try {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type, payload }));
                return true;
            } else {
                console.warn("WSClient: cannot send, socket not open");
                return false;
            }
        } catch (err) {
            console.error("WSClient: failed to send message", err);
            this.emitter.emit("error", err);
            return false;
        }
    }

    /**
     * Build the websocket URL using the same heuristics as the app's runtime.
     * Respects VITE_WS_URL when present, DEV fallback to localhost:8080, otherwise derive from location.
     */
    private resolveUrl(): string {
        const envUrl = import.meta.env.VITE_WS_URL;
        if (envUrl) return envUrl;

        // If running outside a browser (e.g. SSR), fall back to localhost.
        if (typeof window === "undefined" || !window.location) {
            return "ws://localhost:8080/api/ws";
        }

        const proto = window.location.protocol === "https:" ? "wss" : "ws";
        return `${proto}://${window.location.host}/api/ws`;
    }

    private connect() {
        if (!this.token) {
            // Nothing to do until we have a token
            return;
        }
        // Avoid creating multiple simultaneous WebSocket instances
        if (
            this.ws &&
            (this.ws.readyState === WebSocket.OPEN ||
                this.ws.readyState === WebSocket.CONNECTING)
        ) {
            return;
        }
        const wsUrl = this.resolveUrl();
        const urlWithToken = `${wsUrl}?token=${encodeURIComponent(this.token)}`;
        try {
            this.emitter.emit("connecting");
            const ws = new WebSocket(urlWithToken);
            // assign socket reference immediately so subsequent `start()`/`connect()`
            // calls see a CONNECTING socket and avoid creating duplicates
            this.ws = ws;

            ws.onopen = () => {
                this.reconnectAttempts = 0;
                this.clearReconnectTimer();
                // ensure reference points to the opened socket
                this.ws = ws;
                this.emitter.emit("connected");
            };

            ws.onmessage = (event) => {
                try {
                    const msg: WebSocketMessage = JSON.parse(event.data);
                    // Emit raw message for any generic consumers
                    this.emitter.emit("message", msg);

                    switch (msg.type) {
                        case "INVALID_TOKEN": {
                            this.emitter.emit("invalid_token", msg);
                            // Stop the client so it doesn't keep reconnecting with invalid token
                            this.stop();
                            break;
                        }
                        case "CODE_SYNC": {
                            if (!msg.senderId) break;
                            this.emitter.emit("code_sync", {
                                senderId: msg.senderId,
                                payload: msg.payload,
                            });
                            break;
                        }
                        case "METRIC_PULSE": {
                            if (!msg.senderId) break;
                            // Validate metric payload shape (best-effort)
                            const parsed = MetricPayloadSchema.safeParse(
                                msg.payload,
                            );
                            if (parsed.success) {
                                this.emitter.emit("metric_pulse", {
                                    senderId: msg.senderId,
                                    payload: parsed.data,
                                });
                            } else {
                                // If invalid, still emit raw payload so consumers can decide
                                console.warn(
                                    "WSClient: invalid metric payload:",
                                    parsed.error,
                                );
                                this.emitter.emit("metric_pulse", {
                                    senderId: msg.senderId,
                                    payload: msg.payload,
                                });
                            }
                            break;
                        }
                        case "PRESENCE_UPDATE": {
                            if (!msg.senderId) break;
                            // payload is expected to be boolean-ish
                            this.emitter.emit("presence_update", {
                                senderId: msg.senderId,
                                connected: !!msg.payload,
                            });
                            break;
                        }
                        case "ADMIN_COMMAND": {
                            // forward admin command payload object
                            if (
                                msg.payload &&
                                typeof msg.payload === "object"
                            ) {
                                this.emitter.emit("admin_command", msg.payload);
                            } else {
                                // still forward for diagnostics
                                this.emitter.emit("admin_command", msg.payload);
                            }
                            break;
                        }
                        default:
                            // Unknown types are forwarded generically
                            break;
                    }
                } catch (err) {
                    // Log parse errors with context for troubleshooting
                    console.error(
                        "WSClient: failed to parse message",
                        err,
                        event.data,
                    );
                    this.emitter.emit("error", err);
                }
            };

            ws.onclose = (ev) => {
                // If closed intentionally (1000), do not reconnect
                if (ev.code === 1000 || this.explicitlyStopped) {
                    this.ws = null;
                    this.emitter.emit("disconnected");
                    return;
                }

                // Otherwise, schedule reconnect with backoff
                this.ws = null;
                this.emitter.emit("disconnected");

                this.reconnectAttempts = (this.reconnectAttempts || 0) + 1;
                const attempt = this.reconnectAttempts;
                const backoff = Math.min(10000, 1000 * 2 ** (attempt - 1)); // 1s,2s,4s,... cap 10s
                console.debug(
                    `[WSClient] onclose: unexpected close code=${ev.code} reason=${ev.reason} attempt=${attempt} backoff=${backoff}ms`,
                );

                if (this.reconnectTimer) {
                    clearTimeout(this.reconnectTimer);
                    this.reconnectTimer = null;
                }

                this.reconnectTimer = window.setTimeout(() => {
                    this.reconnectTimer = null;
                    // Only reconnect if not explicitly stopped and token still present
                    if (!this.explicitlyStopped && this.token) {
                        this.connect();
                    }
                }, backoff);
            };

            ws.onerror = (err) => {
                // onerror is informational; onclose handles reconnect. Still emit for visibility.
                console.error("WSClient: socket error", err);
                this.emitter.emit("error", err);
            };
        } catch (err) {
            console.error("WSClient: failed to create WebSocket", err);
            this.emitter.emit("error", err);
            // Schedule reconnect attempt
            this.reconnectAttempts = (this.reconnectAttempts || 0) + 1;
            const attempt = this.reconnectAttempts;
            const backoff = Math.min(10000, 1000 * 2 ** (attempt - 1));
            if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
            this.reconnectTimer = window.setTimeout(() => {
                this.reconnectTimer = null;
                if (!this.explicitlyStopped && this.token) {
                    console.debug("[WSClient] retrying connect after error");
                    this.connect();
                }
            }, backoff);
        }
    }

    private clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    /**
     * Returns the socket readyState (if any), or null when no socket exists.
     */
    get readyState(): number | null {
        return this.ws ? this.ws.readyState : null;
    }
}

export default WSClient;

/**
 * Convenience default singleton instance used by the app. Consumers can also
 * instantiate their own WSClient if they need isolation (tests, multiple tabs, etc).
 */
export const wsClient = new WSClient();
