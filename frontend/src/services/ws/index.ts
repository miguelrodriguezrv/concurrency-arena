/**
 * Public entrypoint for the WebSocket service.
 * Re-exports the singleton `wsClient` and the `WSClient` class for callers
 * that either want the shared client or to instantiate their own.
 */

import WSClient, { wsClient } from "./client";

export { WSClient, wsClient };
export default wsClient;
