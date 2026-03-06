import { useEffect, useRef, useState, useCallback } from "react";
import { useStore, MetricPayloadSchema } from "@/store";
import { toast } from "react-hot-toast";

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

interface AdminCommandPayload {
    action: string;
    code?: string;
    [key: string]: unknown;
}

// Simple event bus for Admin Commands that components can subscribe to
type AdminCommandCallback = (payload: AdminCommandPayload) => void;
const adminCommandListeners = new Set<AdminCommandCallback>();

export const useWebSocket = () => {
    const session = useStore((state) => state.session);
    const clearSession = useStore((state) => state.clearSession);
    const updateStudentCode = useStore((state) => state.updateStudentCode);
    const updateStudentMetrics = useStore(
        (state) => state.updateStudentMetrics,
    );
    const updateStudentPresence = useStore(
        (state) => state.updateStudentPresence,
    );

    const socketRef = useRef<WebSocket | null>(null);
    const reconnectTimerRef = useRef<number | null>(null);
    const reconnectAttemptsRef = useRef(0);

    const [status, setStatus] = useState<
        "disconnected" | "connecting" | "connected"
    >("disconnected");

    useEffect(() => {
        // If there's no token, ensure socket is closed and we are disconnected
        if (!session?.token) {
            if (socketRef.current) {
                try {
                    socketRef.current.close(1000, "No session token");
                } catch {
                    // ignore
                }
                socketRef.current = null;
            }
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
            reconnectAttemptsRef.current = 0;
            setTimeout(() => setStatus("disconnected"), 0);
            return;
        }

        let isUnmounted = false;

        const wsUrl = (() => {
            // Allow explicit override from env.
            if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;

            // In Vite dev mode we run the frontend dev server on 5173.
            // The backend runs on 8080 — prefer connecting to localhost:8080 in DEV
            // so the websocket reaches the backend instead of the Vite server.
            if (import.meta.env && import.meta.env.DEV) {
                const proto =
                    window.location.protocol === "https:" ? "wss" : "ws";
                return `${proto}://localhost:8080/api/ws`;
            }

            // Fallback: derive from current host (production / non-dev)
            if (typeof window === "undefined")
                return "ws://localhost:8080/api/ws";
            const proto = window.location.protocol === "https:" ? "wss" : "ws";
            return `${proto}://${window.location.host}/api/ws`;
        })();

        const createWebSocket = () => {
            if (isUnmounted) return;
            setStatus("connecting");

            const ws = new WebSocket(`${wsUrl}?token=${session.token}`);

            ws.onopen = () => {
                // Reset reconnection attempts
                reconnectAttemptsRef.current = 0;
                if (reconnectTimerRef.current) {
                    clearTimeout(reconnectTimerRef.current);
                    reconnectTimerRef.current = null;
                }
                socketRef.current = ws;
                setStatus("connected");
            };

            ws.onmessage = (event) => {
                try {
                    const msg: WebSocketMessage = JSON.parse(event.data);

                    switch (msg.type) {
                        case "INVALID_TOKEN": {
                            // Server explicitly told us this connection has an invalid/expired token.
                            // Show a toast so the user understands why they were logged out, then clear session.
                            try {
                                toast.error(
                                    "Session expired — please sign in again.",
                                );
                                console.info(
                                    "[WS] Received INVALID_TOKEN from server; clearing local session",
                                );
                                clearSession();
                            } catch (err) {
                                console.error(
                                    "Failed to clear session on INVALID_TOKEN:",
                                    err,
                                );
                            }
                            break;
                        }
                        case "CODE_SYNC": {
                            if (!msg.senderId) break;
                            // Expect an object payload with a `code` string property and a `language` string.
                            if (
                                msg.payload &&
                                typeof msg.payload === "object" &&
                                "code" in
                                    (msg.payload as Record<string, unknown>) &&
                                "language" in
                                    (msg.payload as Record<string, unknown>)
                            ) {
                                const p = msg.payload as Record<
                                    string,
                                    unknown
                                >;
                                const codeVal = p["code"];
                                const languageVal = p["language"];
                                if (
                                    typeof codeVal === "string" &&
                                    typeof languageVal === "string"
                                ) {
                                    // Pass typed object with language (matches store signature)
                                    updateStudentCode(msg.senderId, {
                                        code: codeVal,
                                        language: languageVal,
                                    });
                                } else {
                                    console.warn(
                                        "CODE_SYNC payload 'code' and 'language' must be strings; ignoring.",
                                    );
                                }
                            } else {
                                console.warn(
                                    "Ignoring CODE_SYNC with unexpected payload shape. Expect an object { code: string, language: string }.",
                                );
                            }
                            break;
                        }
                        case "METRIC_PULSE": {
                            if (!msg.senderId) break;
                            const parsed = MetricPayloadSchema.safeParse(
                                msg.payload,
                            );
                            if (parsed.success) {
                                updateStudentMetrics(msg.senderId, parsed.data);
                            } else {
                                console.warn(
                                    "Invalid metric payload:",
                                    parsed.error,
                                );
                            }
                            break;
                        }
                        case "PRESENCE_UPDATE": {
                            if (!msg.senderId) break;
                            // Expect a boolean-ish payload
                            updateStudentPresence(msg.senderId, !!msg.payload);
                            break;
                        }
                        case "ADMIN_COMMAND": {
                            // forward to listeners
                            if (
                                typeof msg.payload === "object" &&
                                msg.payload !== null
                            ) {
                                const payload =
                                    msg.payload as AdminCommandPayload;
                                adminCommandListeners.forEach((listener) =>
                                    listener(payload),
                                );
                            }
                            break;
                        }
                        default:
                            console.warn(
                                "Unknown message type received:",
                                msg.type,
                            );
                    }
                } catch (err) {
                    console.error("Failed to parse websocket message", err);
                }
            };

            ws.onclose = (event) => {
                // If we intentionally closed (1000), do not attempt reconnect
                if (event.code === 1000) {
                    socketRef.current = null;
                    setStatus("disconnected");
                    return;
                }

                // Otherwise mark disconnected and clear our socket ref
                setStatus("disconnected");
                if (socketRef.current === ws) {
                    socketRef.current = null;
                }

                // exponential backoff for reconnect attempts (capped)
                reconnectAttemptsRef.current =
                    (reconnectAttemptsRef.current || 0) + 1;
                const attempt = reconnectAttemptsRef.current;
                const backoff = Math.min(10000, 1000 * 2 ** (attempt - 1)); // 1s, 2s, 4s, ... cap at 10s

                if (reconnectTimerRef.current) {
                    clearTimeout(reconnectTimerRef.current);
                    reconnectTimerRef.current = null;
                }

                reconnectTimerRef.current = window.setTimeout(() => {
                    reconnectTimerRef.current = null;
                    // Only try to reconnect if token still present and not unmounted;
                    // if clearSession() ran due to a 401, session?.token will be falsy
                    if (!isUnmounted && session?.token) {
                        createWebSocket();
                    }
                }, backoff);
            };

            ws.onerror = () => {
                // onerror is informational; onclose handles reconnect
            };

            // keep the ref for the latest socket (onopen will set it properly)
            socketRef.current = ws;
        };

        // start connection
        createWebSocket();

        // cleanup on effect re-run or unmount
        return () => {
            isUnmounted = true;
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
            // Close the current socket gracefully
            try {
                if (socketRef.current) {
                    socketRef.current.close(1000, "Component unmounted");
                }
            } catch {
                // ignore
            } finally {
                socketRef.current = null;
            }
        };
        // Intentionally depend on session.token and updater functions; recreates socket if they change
    }, [
        session?.token,
        updateStudentCode,
        updateStudentMetrics,
        updateStudentPresence,
        clearSession,
    ]);

    const sendMessage = useCallback((type: MessageType, payload: unknown) => {
        try {
            if (socketRef.current?.readyState === WebSocket.OPEN) {
                socketRef.current.send(JSON.stringify({ type, payload }));
                return true;
            } else {
                console.warn("Cannot send message, WebSocket is not open");
                return false;
            }
        } catch (err) {
            console.error("Failed to send websocket message", err);
            return false;
        }
    }, []);

    const subscribeToAdminCommands = useCallback(
        (callback: AdminCommandCallback) => {
            adminCommandListeners.add(callback);
            return () => adminCommandListeners.delete(callback);
        },
        [],
    );

    return { status, sendMessage, subscribeToAdminCommands };
};
