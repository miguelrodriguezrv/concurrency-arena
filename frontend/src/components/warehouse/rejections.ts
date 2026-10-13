import type { WarehouseEventPayload } from "./types";

/** Which piece of the floor a rejected call should highlight. */
export type RejectTarget =
    | { kind: "bays" }
    | { kind: "belt" }
    | { kind: "line"; line: number }
    | { kind: "printer" }
    | { kind: "lane"; lane: string }
    | { kind: "floor" };

export interface Rejection {
    target: RejectTarget;
    /** Short human label shown on the floor, e.g. "Line 1 full". */
    label: string;
}

export function targetKey(t: RejectTarget): string {
    switch (t.kind) {
        case "line":
            return `line-${t.line}`;
        case "lane":
            return `lane-${t.lane}`;
        default:
            return t.kind;
    }
}

/**
 * Map a warehouse ERROR event to the resource that rejected the call.
 * Based on the method prefix of the message ("unload:", "print:", ...).
 */
export function classifyRejection(ev: WarehouseEventPayload): Rejection {
    const msg = String(ev.metadata?.message ?? "");
    const line = ev.processingLineId;
    const lane = ev.shippingLine ?? ev.laneId;
    const lineTarget = (fallback: RejectTarget): RejectTarget =>
        typeof line === "number" && line >= 0 && line <= 2
            ? { kind: "line", line }
            : fallback;

    if (ev.metadata?.fatal) {
        return { target: { kind: "floor" }, label: "Too many rejected calls" };
    }

    if (msg.startsWith("unload:")) {
        if (msg.includes("queue full")) {
            return { target: { kind: "belt" }, label: "Intake belt full" };
        }
        if (msg.includes("concurrency")) {
            return { target: { kind: "bays" }, label: "All bays busy" };
        }
        return { target: { kind: "bays" }, label: "Unload rejected" };
    }

    if (msg.startsWith("pushToProcessingLine:")) {
        if (msg.includes("is full")) {
            return { target: lineTarget({ kind: "floor" }), label: `Line ${line} full` };
        }
        if (msg.includes("invalid processingLineId")) {
            return { target: { kind: "floor" }, label: "No such line" };
        }
        return { target: { kind: "belt" }, label: "Not on the intake belt" };
    }

    if (msg.startsWith("process:")) {
        if (msg.includes("busy")) {
            return { target: lineTarget({ kind: "floor" }), label: "Station busy" };
        }
        if (msg.includes("not on processingLine")) {
            return { target: lineTarget({ kind: "floor" }), label: "Not on this line" };
        }
        return { target: lineTarget({ kind: "floor" }), label: "Can't process" };
    }

    if (msg.startsWith("print:")) {
        if (msg.includes("printer busy")) {
            return { target: { kind: "printer" }, label: "Printer busy" };
        }
        if (msg.includes("not at head")) {
            return { target: lineTarget({ kind: "printer" }), label: "Not at end of line" };
        }
        return { target: lineTarget({ kind: "printer" }), label: "Not ready to print" };
    }

    if (msg.startsWith("ship:")) {
        if (msg.includes("is full") && lane) {
            return { target: { kind: "lane", lane }, label: `${lane} full` };
        }
        if (msg.includes("mismatch") && lane) {
            return { target: { kind: "lane", lane }, label: "Wrong lane" };
        }
        if (msg.includes("not at head")) {
            return { target: lineTarget({ kind: "floor" }), label: "Not at end of line" };
        }
        if (msg.includes("expected labeled")) {
            return { target: lineTarget({ kind: "floor" }), label: "Not printed yet" };
        }
        return {
            target: lane ? { kind: "lane", lane } : { kind: "floor" },
            label: "Ship rejected",
        };
    }

    return { target: { kind: "floor" }, label: "Rejected" };
}
