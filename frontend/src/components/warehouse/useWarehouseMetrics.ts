import { useEffect, useMemo, useState } from "react";
import type { WarehouseEventPayload } from "./types";

export interface WarehouseMetrics {
    shippedCount: number;
    errorCount: number;
    intakeEfficiency: number;
    printerEfficiency: number;
    printerMoveMs: number;
}

/**
 * Utility to find the last index of an element matching a predicate.
 */
function findLastIndex<T>(arr: T[], predicate: (item: T) => boolean): number {
    for (let i = arr.length - 1; i >= 0; i--) {
        if (predicate(arr[i])) return i;
    }
    return -1;
}

export type UseWarehouseMetricsResult = {
    elapsedMs: number;
    startTs: number;
    stopTs: number;
    isComplete: boolean;
    currentRunEvents: WarehouseEventPayload[];
    metrics: WarehouseMetrics;
    throughputUnitsPerMin: number;
    formatTime: (ms: number) => string;
};

/**
 * useWarehouseMetrics
 *
 * Extracted from the previous `WarehouseMetrics` component so multiple UI
 * surfaces can re-use the same, single source-of-truth for derived metrics.
 *
 * Behavior:
 * - Finds the most recent START_RUN event and treats subsequent events as the
 *   active run.
 * - Maintains an independent wall-clock `elapsedMs` timer that updates every
 *   100ms while the run is active (stops when run is complete).
 * - Computes the same architectural metrics as before: shippedCount, errorCount,
 *   intakeEfficiency (time-weighted average active unloaders), printerEfficiency,
 *   and printerMoveMs travel penalty.
 */
export default function useWarehouseMetrics(
    events: WarehouseEventPayload[] = [],
): UseWarehouseMetricsResult {
    const [elapsedMs, setElapsedMs] = useState<number>(0);

    // 1. Identify the current run lifecycle boundaries using START_RUN and STOP_RUN
    const { startTs, stopTs, isComplete, currentRunEvents } = useMemo(() => {
        const startIdx = findLastIndex(events, (e) => e.type === "START_RUN");

        if (startIdx === -1) {
            return {
                startTs: 0,
                stopTs: 0,
                isComplete: false,
                currentRunEvents: [] as WarehouseEventPayload[],
            };
        }

        const relevant = events.slice(startIdx + 1);
        const startEvent = events[startIdx];

        const stopEvent = relevant.find((e) => e.type === "STOP_RUN");
        const completeEvent = relevant.find(
            (e) => e.type === "SHIP_COMPLETE" && e.packageId === 99,
        );

        return {
            startTs: startEvent.timestamp || 0,
            stopTs: stopEvent?.timestamp || completeEvent?.timestamp || 0,
            isComplete: !!stopEvent || !!completeEvent,
            currentRunEvents: relevant,
        };
    }, [events]);

    // 2. Independent Wall-Clock Timer (Refreshing every 100ms)
    useEffect(() => {
        // Use timeouts for immediate updates to avoid synchronous setState calls
        // inside the effect body which some linters/runtime checks flag as
        // cascading renders. We still use the interval for steady updates.
        let immediateTimer: ReturnType<typeof setTimeout> | null = null;
        let intervalId: ReturnType<typeof setInterval> | null = null;

        if (startTs === 0) {
            // schedule async update to set elapsed to zero
            immediateTimer = setTimeout(() => {
                setElapsedMs((prev) => (prev === 0 ? prev : 0));
            }, 0);
            return () => {
                if (immediateTimer) clearTimeout(immediateTimer);
            };
        }

        if (isComplete) {
            const final = Math.max(0, stopTs - startTs);
            // schedule async update for final elapsed time
            immediateTimer = setTimeout(() => {
                setElapsedMs((prev) => (prev === final ? prev : final));
            }, 0);
            return () => {
                if (immediateTimer) clearTimeout(immediateTimer);
            };
        }

        // Establish an asynchronous baseline value (avoid waiting for first tick)
        const nowInitial =
            typeof performance !== "undefined" ? performance.now() : Date.now();
        const initial = Math.max(0, nowInitial - startTs);
        immediateTimer = setTimeout(() => {
            setElapsedMs((prev) => (prev === initial ? prev : initial));
        }, 0);

        // Live-updating timer (every 100ms) but only write when the computed
        // value actually changes to avoid unnecessary renders.
        intervalId = setInterval(() => {
            const now =
                typeof performance !== "undefined"
                    ? performance.now()
                    : Date.now();
            const computed = Math.max(0, now - startTs);
            setElapsedMs((prev) => (prev === computed ? prev : computed));
        }, 100);

        return () => {
            if (intervalId) clearInterval(intervalId);
            if (immediateTimer) clearTimeout(immediateTimer);
        };
    }, [startTs, isComplete, stopTs]);

    // 3. Architectural Metrics (calculated from events since START_RUN)
    const metrics = useMemo<WarehouseMetrics>(() => {
        let shippedCount = 0;
        let errorCount = 0;
        let printerMoveMs = 0;
        let printerPrintMs = 0;
        let activeUnloaders = 0;
        let weightedUnloaderSum = 0;

        // Start tracking time from the start of the run (START_RUN event)
        let lastIntakeUpdateTime = startTs;

        for (const ev of currentRunEvents) {
            const ts = ev.timestamp || startTs;

            // 1. Track weighted concurrency up to this event
            if (ts > lastIntakeUpdateTime) {
                weightedUnloaderSum +=
                    activeUnloaders * (ts - lastIntakeUpdateTime);
            }
            lastIntakeUpdateTime = ts;

            // 2. Update state based on event type
            if (ev.type === "SHIP_COMPLETE") shippedCount++;
            if (ev.type === "ERROR") errorCount++;

            if (ev.type === "INTAKE_START") {
                activeUnloaders++;
            } else if (ev.type === "INTAKE_DONE") {
                activeUnloaders = Math.max(0, activeUnloaders - 1);
            }

            if (ev.type === "PRINTER_MOVE_START") {
                printerMoveMs += ev.metadata?.travelMs || 0;
            }
            if (ev.type === "PRINT_START") {
                printerPrintMs += ev.metadata?.printMs || 100;
            }
        }

        // 3. Account for current intake concurrency up to the current wall-clock "now"
        const finalTsForWeight = isComplete
            ? stopTs || lastIntakeUpdateTime
            : startTs + elapsedMs;
        if (finalTsForWeight > lastIntakeUpdateTime) {
            weightedUnloaderSum +=
                activeUnloaders * (finalTsForWeight - lastIntakeUpdateTime);
        }

        const totalTime = isComplete ? stopTs - startTs : elapsedMs;
        // Only show efficiency after we have a meaningful sample size (e.g. 5000ms)
        // to avoid mathematical spikes while the worker is booting up.
        const intakeEfficiency =
            totalTime > 5000 ? weightedUnloaderSum / totalTime : 0;

        const totalPrinterTime = printerPrintMs + printerMoveMs;
        const printerEfficiency =
            totalPrinterTime > 0
                ? (printerPrintMs / totalPrinterTime) * 100
                : 0;

        return {
            shippedCount,
            errorCount,
            intakeEfficiency,
            printerEfficiency,
            printerMoveMs,
        };
    }, [currentRunEvents, isComplete, startTs, stopTs, elapsedMs]);

    // 4. Throughput Calculation
    const throughputUnitsPerMin = useMemo(() => {
        if (elapsedMs <= 0 || metrics.shippedCount === 0) return 0;
        const minutes = elapsedMs / 60000;
        return metrics.shippedCount / minutes;
    }, [elapsedMs, metrics.shippedCount]);

    const formatTime = (ms: number) => {
        const seconds = Math.max(0, ms / 1000);
        return `${seconds.toFixed(1)}s`;
    };

    return {
        elapsedMs,
        startTs,
        stopTs,
        isComplete,
        currentRunEvents,
        metrics,
        throughputUnitsPerMin,
        formatTime,
    };
}
