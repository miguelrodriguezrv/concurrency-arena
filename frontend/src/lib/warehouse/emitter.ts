/**
 * Minimal EventEmitter
 *
 * on(handler) -> returns off() function
 * once(handler) -> registers handler for next emission only
 * emit(event)
 */
export class EventEmitter<T> {
    private _handlers: Set<(payload: T) => void> = new Set();

    on(handler: (payload: T) => void): () => void {
        this._handlers.add(handler);
        return () => this._handlers.delete(handler);
    }

    once(handler: (payload: T) => void): void {
        const wrapper = (p: T) => {
            try {
                handler(p);
            } finally {
                this._handlers.delete(wrapper);
            }
        };
        this._handlers.add(wrapper);
    }

    emit(payload: T) {
        // Copy handlers to avoid mutation during iteration
        const handlers = Array.from(this._handlers);
        for (const h of handlers) {
            try {
                h(payload);
            } catch (err) {
                // Emitter should not throw; swallow and continue
                // Consumers should handle their own errors
                console.error("EventEmitter handler error:", err);
            }
        }
    }

    clear() {
        this._handlers.clear();
    }
}

// Export for use by the Warehouse runtime
export default {
    EventEmitter,
};
