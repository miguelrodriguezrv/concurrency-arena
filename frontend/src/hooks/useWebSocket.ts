import { useEffect, useState, useCallback } from "react";
import { useStore } from "@/store";
import { toast } from "react-hot-toast";
import { wsClient } from "@/services/ws/client";
import type { MetricPayload } from "@/contracts/messages";

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

/* Admin command subscriber callback type */
type AdminCommandCallback = (payload: AdminCommandPayload) => void;

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

    const [status, setStatus] = useState<
        "disconnected" | "connecting" | "connected"
    >("disconnected");

    useEffect(() => {
        // Handlers for events emitted by the wsClient service
        const onConnecting = () => setStatus("connecting");
        const onConnected = () => setStatus("connected");
        const onDisconnected = () => setStatus("disconnected");

        const onInvalidToken = () => {
            try {
                toast.error("Session expired — please sign in again.");
                clearSession();
            } catch (err) {
                console.error("Failed to clear session on invalid token:", err);
            }
        };

        const onCodeSync = (payload: {
            senderId?: string;
            payload?: unknown;
        }) => {
            if (!payload?.senderId) return;
            const msg = payload.payload;
            if (
                msg &&
                typeof msg === "object" &&
                "code" in (msg as Record<string, unknown>) &&
                "language" in (msg as Record<string, unknown>)
            ) {
                const p = msg as Record<string, unknown>;
                const codeVal = p["code"];
                const languageVal = p["language"];
                if (
                    typeof codeVal === "string" &&
                    typeof languageVal === "string"
                ) {
                    updateStudentCode(payload.senderId, {
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
        };

        const onMetricPulse = (payload: {
            senderId?: string;
            payload?: unknown;
        }) => {
            if (!payload?.senderId) return;
            // wsClient already performs best-effort validation; accept the payload here
            try {
                updateStudentMetrics(
                    payload.senderId,
                    payload.payload as MetricPayload,
                );
            } catch (err) {
                console.warn(
                    "Failed to update student metrics from pulse:",
                    err,
                );
            }
        };

        const onPresence = (payload: {
            senderId?: string;
            connected?: boolean;
        }) => {
            if (!payload?.senderId) return;
            updateStudentPresence(payload.senderId, !!payload.connected);
        };

        // Wire up listeners to the singleton wsClient
        const offConnecting = wsClient.on("connecting", onConnecting);
        const offConnected = wsClient.on("connected", onConnected);
        const offDisconnected = wsClient.on("disconnected", onDisconnected);
        const offInvalidToken = wsClient.on("invalid_token", onInvalidToken);
        const offCodeSync = wsClient.on("code_sync", onCodeSync);
        const offMetricPulse = wsClient.on("metric_pulse", onMetricPulse);
        const offPresence = wsClient.on("presence_update", onPresence);

        // Start or stop the client based on session token presence
        // Immediately sync UI status to the client's current readyState to avoid races
        try {
            const rs = wsClient.readyState;
            if (typeof WebSocket !== "undefined") {
                if (rs === WebSocket.OPEN) {
                    setStatus("connected");
                } else if (rs === WebSocket.CONNECTING) {
                    setStatus("connecting");
                } else {
                    setStatus("disconnected");
                }
            } else {
                // Fallback: treat readyState 1 as open
                if (rs === 1) setStatus("connected");
            }
        } catch {
            // ignore sync errors
        }

        if (session?.token) {
            wsClient.start(session.token);
            // After requesting start, immediately re-sync in case the socket is already open
            try {
                const rs2 = wsClient.readyState;
                if (typeof WebSocket !== "undefined") {
                    if (rs2 === WebSocket.OPEN) setStatus("connected");
                    else if (rs2 === WebSocket.CONNECTING)
                        setStatus("connecting");
                } else if (rs2 === 1) setStatus("connected");
            } catch {}
        } else {
            wsClient.stop();
            setStatus("disconnected");
        }

        return () => {
            // Unsubscribe and avoid leaving listeners dangling
            offConnecting();
            offConnected();
            offDisconnected();
            offInvalidToken();
            offCodeSync();
            offMetricPulse();
            offPresence();
        };
        // Depend on session.token and the store updaters
    }, [
        session?.token,
        updateStudentCode,
        updateStudentMetrics,
        updateStudentPresence,
        clearSession,
    ]);

    const sendMessage = useCallback((type: MessageType, payload: unknown) => {
        try {
            return wsClient.send(type, payload);
        } catch (err) {
            console.error("Failed to send websocket message via wsClient", err);
            return false;
        }
    }, []);

    const subscribeToAdminCommands = useCallback(
        (callback: AdminCommandCallback) => {
            const off = wsClient.on("admin_command", (payload: unknown) => {
                if (payload && typeof payload === "object") {
                    callback(payload as AdminCommandPayload);
                }
            });
            return off;
        },
        [],
    );

    return { status, sendMessage, subscribeToAdminCommands };
};
