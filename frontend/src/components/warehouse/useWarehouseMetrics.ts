import { useEffect, useMemo, useState } from "react";
import type { WarehouseEventPayload } from "./types";

export interface WarehouseMetrics {
    shippedCount: number;
    errorCount: number;
    fatalError: boolean;
    intakeEfficiency: number;
    printerEfficiency: number;
    printerMoveMs: number;
    printerPrintMs: number;
}

/**
 * How the current run ended (or that it is still going).
 * - complete:   every package shipped
 * - incomplete: student code returned but some packages never shipped
 * - fatal:      too many rejected calls, the warehouse shut down
 * - crashed:    the student code threw / the runner crashed
 * - stopped:    the user pressed Stop
 */
export type RunOutcome =
    | "idle"
    | "running"
    | "complete"
    | "incomplete"
    | "fatal"
    | "crashed"
    | "stopped";

export type UseWarehouseMetricsResult = {
    elapsedMs: number;
    startTs: number;
    stopTs: number;
    isComplete: boolean;
    outcome: RunOutcome;
    /** Simulation speed of the current run (1 = normal). */
    speed: number;
    totalPackages: number;
    stranded: number[];
    /** Unloaded but never shipped. */
    stuck: number[];
    /** Never unloaded from the trucks. */
    notUnloaded: number;
    finalUPM: number;
    endMessage?: string;
    currentRunEvents: WarehouseEventPayload[];
    metrics: WarehouseMetrics;
    throughputUnitsPerMin: number;
    formatTime: (ms: number) => string;
};

const DEFAULT_TOTAL = 100;

function findLastIndex<T>(arr: T[], predicate: (item: T) => boolean): number {
    for (let i = arr.length - 1; i >= 0; i--) {
        if (predicate(arr[i])) return i;
    }
    return -1;
}

/**
 * Single source of truth for derived run metrics.
 *
 * All timestamps are on the main thread's performance.now() clock (worker
 * timestamps are converted in useCodeRunner). The clock starts at the first
 * unload — the same moment the warehouse uses for the official score — and
 * when the run completes the official duration from the warehouse is used,
 * so the on-screen time always matches the submitted result.
 */
export default function useWarehouseMetrics(
    events: WarehouseEventPayload[] = [],
): UseWarehouseMetricsResult {
    const [now, setNow] = useState<number>(() => performance.now());

    // 1. Run boundaries and outcome
    const run = useMemo(() => {
        const startIdx = findLastIndex(events, (e) => e.type === "START_RUN");
        if (startIdx === -1) {
            return {
                started: false,
                speed: 1,
                startTs: 0,
                stopTs: 0,
                outcome: "idle" as RunOutcome,
                relevant: [] as WarehouseEventPayload[],
                finalDuration: undefined as number | undefined,
                finalUPM: 0,
                stranded: [] as number[],
                stuck: [] as number[],
                notUnloaded: 0,
                total: DEFAULT_TOTAL,
                endMessage: undefined as string | undefined,
            };
        }

        const relevant = events.slice(startIdx + 1);
        const speed = Number(events[startIdx].metadata?.speed) || 1;
        const firstUnload = relevant.find((e) => e.type === "INTAKE_START");
        const completed = relevant.find((e) => e.type === "COMPLETED");
        const incomplete = relevant.find((e) => e.type === "INCOMPLETE");
        const fatal = relevant.find(
            (e) => e.type === "ERROR" && e.metadata?.fatal,
        );
        const crashed = relevant.find((e) => e.type === "RUN_ERROR");
        const stopped = relevant.find((e) => e.type === "STOP_RUN");

        let total = DEFAULT_TOTAL;
        for (let i = relevant.length - 1; i >= 0; i--) {
            const t = relevant[i].metadata?.total;
            if (typeof t === "number") {
                total = t;
                break;
            }
        }

        let outcome: RunOutcome = "running";
        let endEvent: WarehouseEventPayload | undefined;
        let endMessage: string | undefined;
        if (completed) {
            outcome = "complete";
            endEvent = completed;
        } else if (fatal) {
            outcome = "fatal";
            endEvent = fatal;
            endMessage = fatal.metadata?.message;
        } else if (crashed) {
            outcome = "crashed";
            endEvent = crashed;
            endMessage = crashed.metadata?.message;
        } else if (incomplete) {
            outcome = "incomplete";
            endEvent = incomplete;
        } else if (stopped) {
            outcome = "stopped";
            endEvent = stopped;
        }

        const startTs = firstUnload?.timestamp ?? 0;
        const finalDuration =
            typeof completed?.metadata?.finalDuration === "number"
                ? completed.metadata.finalDuration
                : undefined;
        const stopTs =
            finalDuration !== undefined && startTs
                ? startTs + finalDuration
                : endEvent?.timestamp ?? 0;

        return {
            started: true,
            speed,
            startTs,
            stopTs,
            outcome,
            relevant,
            finalDuration,
            finalUPM: completed?.metadata?.finalUPM ?? 0,
            stranded: (incomplete?.metadata?.stranded as number[]) ?? [],
            stuck: (incomplete?.metadata?.stuck as number[]) ?? [],
            notUnloaded: (incomplete?.metadata?.notUnloaded as number) ?? 0,
            total,
            endMessage,
        };
    }, [events]);

    const isComplete = run.outcome !== "running" && run.outcome !== "idle";

    // 2. Live clock while running
    useEffect(() => {
        if (run.outcome !== "running" || !run.startTs) return;
        const id = setInterval(() => setNow(performance.now()), 100);
        return () => clearInterval(id);
    }, [run.outcome, run.startTs]);

    // Elapsed time is shown in game time (real time × speed) so results are
    // comparable no matter which speed the run used.
    let elapsedMs = 0;
    if (run.startTs) {
        if (run.finalDuration !== undefined) elapsedMs = run.finalDuration;
        else if (isComplete) elapsedMs = Math.max(0, run.stopTs - run.startTs) * run.speed;
        else elapsedMs = Math.max(0, now - run.startTs) * run.speed;
    }

    // 3. Derived metrics
    const metrics = useMemo<WarehouseMetrics>(() => {
        let shippedCount = 0;
        let errorCount = 0;
        let fatalError = false;
        let printerMoveMs = 0;
        let printerPrintMs = 0;
        let activeUnloaders = 0;
        let weightedUnloaderSum = 0;
        let lastTs = run.startTs;

        for (const ev of run.relevant) {
            const ts = ev.timestamp ?? lastTs;
            if (run.startTs && ts > lastTs) {
                weightedUnloaderSum += activeUnloaders * (ts - lastTs);
                lastTs = ts;
            }
            switch (ev.type) {
                case "SHIP_COMPLETE":
                    shippedCount++;
                    break;
                case "ERROR":
                    errorCount++;
                    if (ev.metadata?.fatal) fatalError = true;
                    break;
                case "INTAKE_START":
                    activeUnloaders++;
                    break;
                case "INTAKE_DONE":
                    activeUnloaders = Math.max(0, activeUnloaders - 1);
                    break;
                case "PRINTER_MOVE_START":
                    printerMoveMs += ev.metadata?.travelMs || 0;
                    break;
                case "PRINT_START":
                    printerPrintMs += ev.metadata?.printMs || 0;
                    break;
            }
        }

        const totalTime = elapsedMs / run.speed; // real ms, like the event timestamps
        const intakeEfficiency =
            totalTime > 5000 ? weightedUnloaderSum / totalTime : 0;
        const totalPrinterTime = printerPrintMs + printerMoveMs;
        const printerEfficiency =
            totalPrinterTime > 0 ? (printerPrintMs / totalPrinterTime) * 100 : 0;

        return {
            shippedCount,
            errorCount,
            fatalError,
            intakeEfficiency,
            printerEfficiency,
            printerMoveMs,
            printerPrintMs,
        };
        // elapsedMs intentionally excluded while running to avoid recomputing every tick
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [run, isComplete]);

    // 4. Throughput: official value once complete, live estimate otherwise
    const throughputUnitsPerMin = useMemo(() => {
        if (run.outcome === "complete" && run.finalUPM) return run.finalUPM;
        if (elapsedMs <= 0 || metrics.shippedCount === 0) return 0;
        const raw = metrics.shippedCount / (elapsedMs / 60000);
        return Math.floor(raw * 10) / 10;
    }, [run.outcome, run.finalUPM, elapsedMs, metrics.shippedCount]);

    const formatTime = (ms: number) => `${Math.max(0, ms / 1000).toFixed(1)}s`;

    return {
        elapsedMs,
        startTs: run.startTs,
        stopTs: run.stopTs,
        isComplete,
        outcome: run.outcome,
        speed: run.speed,
        totalPackages: run.total,
        stranded: run.stranded,
        stuck: run.stuck,
        notUnloaded: run.notUnloaded,
        finalUPM: run.finalUPM,
        endMessage: run.endMessage,
        currentRunEvents: run.relevant,
        metrics,
        throughputUnitsPerMin,
        formatTime,
    };
}
