/**
 * Shared glue between a runner worker (JS / Python / Go) and the Warehouse runtime.
 *
 * - Forwards every warehouse event to the main thread, with timestamps converted
 *   to epoch milliseconds so the main thread can compare them with its own clock.
 * - Prints a concise line to the student console for rejected calls.
 * - Prints the full event stream only when debug logging is enabled (dev).
 * - After the student's code returns, waits for the warehouse to settle so the
 *   run ends only once every package has shipped (or reports stranded packages).
 */
import type { WarehouseAPI, WarehouseEvent } from "@/lib/warehouse/types";
import type { RunnerEvent } from "./bridge";

const DEBUG_CONSOLE =
    import.meta.env?.VITE_WAREHOUSE_DEBUG !== undefined
        ? import.meta.env.VITE_WAREHOUSE_DEBUG === "true"
        : !!import.meta.env?.DEV;

type Post = (event: RunnerEvent) => void;

export function forwardWarehouseEvents(warehouse: WarehouseAPI, post: Post) {
    warehouse.onEvent((ev: WarehouseEvent) => {
        post({
            type: "WAREHOUSE_EVENT",
            payload: { ...ev, timestamp: performance.timeOrigin + ev.timestamp },
        });

        if (ev.type === "HEARTBEAT") return;
        try {
            if (ev.type === "ERROR") {
                const msg = ev.metadata?.message ?? "rejected";
                post({
                    type: "STDERR",
                    payload: ev.metadata?.fatal ? `[FATAL] ${msg}` : `[Rejected] ${msg}`,
                });
            } else if (DEBUG_CONSOLE) {
                const pid = ev.packageId !== undefined ? String(ev.packageId) : "-";
                const meta = ev.metadata ? ` ${JSON.stringify(ev.metadata)}` : "";
                post({ type: "STDOUT", payload: `[Warehouse] ${ev.type} pkg=${pid}${meta}` });
            }
        } catch {
            // never let logging break the run
        }
    });
}

/**
 * Wait for the warehouse to finish in-flight work and print a short summary.
 * Call this after the student's code has returned, before posting RUN_COMPLETE.
 */
export async function settleWarehouse(warehouse: WarehouseAPI, post: Post) {
    if (typeof warehouse.settle !== "function") return;
    post({
        type: "STDOUT",
        payload: "[System] Your code returned. Waiting for the warehouse to finish shipping...",
    });
    const summary = await warehouse.settle();
    if (summary.halted) return;
    if (summary.complete) {
        post({
            type: "STDOUT",
            payload: `[System] All ${summary.total} packages shipped.`,
        });
    } else {
        const parts: string[] = [];
        if (summary.notUnloaded > 0) {
            parts.push(`${summary.notUnloaded} never unloaded from the trucks`);
        }
        if (summary.stuck.length > 0) {
            const ids = summary.stuck.slice(0, 20).join(", ");
            const more = summary.stuck.length > 20 ? ", ..." : "";
            parts.push(`${summary.stuck.length} stuck inside the warehouse (ids: ${ids}${more})`);
        }
        post({
            type: "STDERR",
            payload: `[System] Run incomplete: ${summary.shipped}/${summary.total} shipped. ${parts.join("; ")}.`,
        });
    }
}
