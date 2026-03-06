import { useMemo, useState, useEffect } from "react";
import type { WarehouseEventPayload } from "@/components/warehouse/types";
import { Clock, Zap, Printer, AlertCircle, TrendingUp } from "lucide-react";

interface WarehouseMetricsProps {
    events: WarehouseEventPayload[];
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

export default function WarehouseMetrics({ events }: WarehouseMetricsProps) {
    // Current display time in ms (Wall-clock)
    const [elapsedMs, setElapsedMs] = useState(0);

    // 1. Identify the current run lifecycle boundaries using START_RUN and STOP_RUN
    const { startTs, stopTs, isComplete, currentRunEvents } = useMemo(() => {
        // Find the most recent START_RUN event
        const startIdx = findLastIndex(events, (e) => e.type === "START_RUN");

        if (startIdx === -1) {
            return {
                startTs: 0,
                stopTs: 0,
                isComplete: false,
                currentRunEvents: [],
            };
        }

        const relevant = events.slice(startIdx + 1);
        const startEvent = events[startIdx];

        // Check for manual stop or natural completion (pkg 99 shipped)
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
        if (startTs === 0) {
            setElapsedMs(0);
            return;
        }

        if (isComplete) {
            setElapsedMs(Math.max(0, stopTs - startTs));
            return;
        }

        const interval = setInterval(() => {
            const now =
                typeof performance !== "undefined"
                    ? performance.now()
                    : Date.now();
            setElapsedMs(Math.max(0, now - startTs));
        }, 100);

        return () => clearInterval(interval);
    }, [startTs, isComplete, stopTs]);

    // 3. Architectural Metrics (calculated from events since START_RUN)
    const metrics = useMemo(() => {
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

    return (
        <div className="flex flex-col gap-3 w-full shrink-0 font-sans mt-2 mb-2">
            <div className="grid grid-cols-2 gap-2">
                <MetricCard
                    label="Wall-Clock Time"
                    value={formatTime(elapsedMs)}
                    subValue={`${metrics.shippedCount} / 100 units`}
                    icon={<Clock size={14} className="text-emerald-400" />}
                />

                <MetricCard
                    label="Throughput"
                    value={throughputUnitsPerMin.toFixed(1)}
                    subValue="Units per Minute"
                    icon={<TrendingUp size={14} className="text-indigo-400" />}
                    valueColor="text-indigo-400"
                />

                <MetricCard
                    label="Intake Concurrency"
                    value={
                        metrics.intakeEfficiency > 0
                            ? metrics.intakeEfficiency.toFixed(2)
                            : "-"
                    }
                    subValue="Avg Active Workers (Max 4)"
                    icon={
                        <Zap
                            size={14}
                            className={
                                metrics.intakeEfficiency > 3
                                    ? "text-emerald-400"
                                    : "text-amber-400"
                            }
                        />
                    }
                />

                <MetricCard
                    label="Printer Efficiency"
                    value={`${metrics.printerEfficiency.toFixed(1)}%`}
                    subValue={`${(metrics.printerMoveMs / 1000).toFixed(1)}s travel penalty`}
                    icon={<Printer size={14} className="text-cyan-400" />}
                />

                <MetricCard
                    label="Violations"
                    value={metrics.errorCount.toString()}
                    subValue="Race conditions / Errors"
                    icon={
                        <AlertCircle
                            size={14}
                            className={
                                metrics.errorCount > 0
                                    ? "text-rose-500"
                                    : "text-zinc-500"
                            }
                        />
                    }
                    valueColor={
                        metrics.errorCount > 0
                            ? "text-rose-500"
                            : "text-zinc-300"
                    }
                />
            </div>
        </div>
    );
}

function MetricCard({
    label,
    value,
    subValue,
    icon,
    valueColor = "text-zinc-100",
}: {
    label: string;
    value: string;
    subValue: string;
    icon: React.ReactNode;
    valueColor?: string;
}) {
    return (
        <div className="bg-zinc-900 p-3 rounded-md border border-zinc-800 flex flex-col justify-between h-24">
            <div className="flex items-center gap-2 opacity-80">
                {icon}
                <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">
                    {label}
                </span>
            </div>
            <div className="flex flex-col mt-1">
                <span
                    className={`text-xl font-mono leading-none ${valueColor}`}
                >
                    {value}
                </span>
                <span className="text-[9px] text-zinc-600 mt-1 font-medium leading-tight">
                    {subValue}
                </span>
            </div>
        </div>
    );
}
