import { Fragment, useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { WarehouseEventPayload } from "./types";
import { LAYOUT, REGIONS, getPackageCoords } from "./layout";
import { visualReducer, initialState } from "./visualReducer";
import { classifyRejection, targetKey, type RejectTarget } from "./rejections";
import { WAREHOUSE_LIMITS } from "@/lib/warehouse/warehouse";

interface WarehouseVisualizerProps {
    events?: WarehouseEventPayload[];
}

interface Flash {
    id: number;
    target: RejectTarget;
    label: string;
    count: number;
}

const FLASH_MS = 1600;

/** Scale a fixed-size stage to fit its container while keeping proportions. */
function useFitScale(width: number, height: number) {
    const ref = useRef<HTMLDivElement | null>(null);
    const [scale, setScale] = useState(1);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const update = () => {
            const { clientWidth, clientHeight } = el;
            if (!clientWidth || !clientHeight) return;
            setScale(Math.min(clientWidth / width, clientHeight / height));
        };
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, [width, height]);
    return { ref, scale };
}

function CapacityBadge({
    label,
    count,
    capacity,
    flashing,
    title,
    style,
}: {
    label?: string;
    count: number;
    capacity: number;
    flashing?: boolean;
    title?: string;
    style: React.CSSProperties;
}) {
    const full = count >= capacity;
    const tone = flashing
        ? "bg-rose-600 text-white border-rose-400"
        : full
          ? "bg-amber-500/15 text-amber-300 border-amber-500/60"
          : "bg-zinc-800/80 text-zinc-300 border-zinc-700";
    return (
        <div
            title={title}
            className={`absolute z-40 flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-mono font-semibold tabular-nums transition-colors ${tone}`}
            style={style}
        >
            {label && <span className="uppercase tracking-wider opacity-70 font-sans">{label}</span>}
            <span>
                {count}/{capacity}
            </span>
        </div>
    );
}

export function WarehouseVisualizer({ events = [] }: WarehouseVisualizerProps) {
    const [state, dispatch] = useReducer(visualReducer, initialState);
    const processedCountRef = useRef(0);
    const [runId, setRunId] = useState(0);
    const [hover, setHover] = useState<null | { id: number; x: number; y: number }>(
        null,
    );
    const [flashes, setFlashes] = useState<Record<string, Flash>>({});
    // Durations in events are game ms; animations must run at real speed.
    const [speed, setSpeed] = useState(1);
    const flashIdRef = useRef(0);
    const { ref: containerRef, scale } = useFitScale(
        LAYOUT.STAGE_WIDTH,
        LAYOUT.STAGE_HEIGHT,
    );

    // current time snapshot for the hover tooltip
    const [now, setNow] = useState<number>(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);

    const flash = useCallback((ev: WarehouseEventPayload) => {
        const { target, label } = classifyRejection(ev);
        const key = targetKey(target);
        const id = ++flashIdRef.current;
        setFlashes((prev) => ({
            ...prev,
            [key]: { id, target, label, count: (prev[key]?.count ?? 0) + 1 },
        }));
        setTimeout(() => {
            setFlashes((prev) => {
                if (prev[key]?.id !== id) return prev;
                const next = { ...prev };
                delete next[key];
                return next;
            });
        }, FLASH_MS);
    }, []);

    useEffect(() => {
        if (!events || events.length === 0) {
            if (processedCountRef.current > 0) {
                dispatch({ type: "RESET" });
                processedCountRef.current = 0;
            }
            return;
        }

        // If the new events array is smaller than our processed count,
        // it means the runner state completely reset (new array instance).
        if (events.length < processedCountRef.current) {
            processedCountRef.current = 0;
        }

        const newEvents = events.slice(processedCountRef.current);
        newEvents.forEach((data) => {
            switch (data.type) {
                case "RESET_WAREHOUSE":
                    dispatch({ type: "RESET_WAREHOUSE" });
                    setRunId((id) => id + 1);
                    setFlashes({});
                    break;
                case "START_RUN":
                    setSpeed(Number(data.metadata?.speed) || 1);
                    break;
                case "ERROR":
                    flash(data);
                    break;
                case "INTAKE_START":
                    dispatch({ type: "INTAKE_START", packageId: data.packageId });
                    break;
                case "INTAKE_DONE":
                    dispatch({ type: "INTAKE_DONE", packageId: data.packageId });
                    break;
                case "INDUCTION_START":
                    dispatch({
                        type: "INDUCTION_START",
                        packageId: data.packageId,
                        processingLineId: data.processingLineId!,
                        queueLength: data.metadata?.queueLengthAfter || 0,
                    });
                    break;
                case "PROCESS_START":
                    dispatch({
                        type: "PROCESS_START",
                        packageId: data.packageId,
                        processingLineId: data.processingLineId!,
                        processingMs: data.metadata?.processingMs,
                    });
                    break;
                case "PROCESS_DONE":
                    dispatch({
                        type: "PROCESS_DONE",
                        packageId: data.packageId,
                        processingLineId: data.processingLineId!,
                    });
                    break;
                case "PRINTER_MOVE_START":
                    dispatch({
                        type: "PRINTER_MOVE_START",
                        processingLineId:
                            data.processingLineId ?? data.metadata?.to ?? 0,
                        travelMs: data.metadata?.travelMs ?? 0,
                    });
                    break;
                case "PRINTER_MOVE_DONE":
                    dispatch({
                        type: "PRINTER_MOVE_DONE",
                        processingLineId:
                            data.processingLineId ?? data.metadata?.to ?? 0,
                    });
                    break;
                case "PRINT_START":
                    dispatch({
                        type: "PRINT_START",
                        packageId: data.packageId,
                        processingLineId: data.processingLineId!,
                        printMs: data.metadata?.printMs,
                    });
                    break;
                case "PRINT_SUCCESS":
                    dispatch({
                        type: "PRINT_SUCCESS",
                        packageId: data.packageId,
                        laneId: data.shippingLane || data.laneId!,
                    });
                    break;
                case "SHIP_ENQUEUED":
                    dispatch({
                        type: "SHIP_ENQUEUED",
                        packageId: data.packageId,
                        laneId: data.shippingLane || data.laneId!,
                        queueLength: data.metadata?.queueLength || 0,
                    });
                    break;
                case "SHIP_START":
                    dispatch({
                        type: "SHIP_START",
                        packageId: data.packageId,
                        laneId: data.shippingLane || data.laneId!,
                    });
                    break;
                case "SHIP_COMPLETE":
                    dispatch({ type: "SHIP_COMPLETE", packageId: data.packageId });
                    break;
            }
        });

        processedCountRef.current = events.length;
    }, [events, flash]);

    // ---- Capacity counts (mirror the warehouse's own accounting) ----
    const unloading = Object.values(state.activeUnloaders).filter(Boolean).length;
    const beltCount = state.intakeQueue.length + unloading;
    const isFlashing = (key: string) => flashes[key] !== undefined;

    const regionFor = (t: RejectTarget) => {
        switch (t.kind) {
            case "bays":
                return REGIONS.bays;
            case "belt":
                return REGIONS.belt;
            case "line":
                return REGIONS.line(t.line);
            case "printer":
                return REGIONS.printer(state.printer.yLineId);
            case "lane":
                return REGIONS.lane(t.lane);
            default:
                return { x: 4, y: 4, w: LAYOUT.STAGE_WIDTH - 16, h: LAYOUT.STAGE_HEIGHT - 16 };
        }
    };

    return (
        <div ref={containerRef} className="relative w-full h-full overflow-hidden bg-zinc-950">
            <div
                className="absolute left-1/2 top-1/2 bg-zinc-900 border-4 border-zinc-800 rounded-xl overflow-hidden shadow-[8px_8px_0px_rgba(0,0,0,0.5)] font-sans"
                style={{
                    width: LAYOUT.STAGE_WIDTH,
                    height: LAYOUT.STAGE_HEIGHT,
                    transform: `translate(-50%, -50%) scale(${scale})`,
                    transformOrigin: "center",
                }}
            >
                {/* --- Static Background Elements --- */}

                {/* Workers Zone Background */}
                <div className="absolute left-0 top-0 w-38 h-full border-r-4 border-dashed border-zinc-700 bg-zinc-800/50" />

                {/* Section labels */}
                <div className="absolute top-4 left-5 text-[10px] font-bold text-zinc-500 uppercase tracking-widest z-10">
                    Intake
                </div>
                <div
                    className="absolute top-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest z-10"
                    style={{ left: LAYOUT.PROCESSING_BELT_START_X }}
                >
                    Processing
                </div>
                <div
                    className="absolute top-4 text-[10px] font-bold text-zinc-500 uppercase tracking-widest z-10"
                    style={{ left: LAYOUT.SHIPPING_BELT_START_X }}
                >
                    Shipping
                </div>

                {/* Legend */}
                <div
                    className="absolute bottom-4 flex items-center gap-5 z-10 bg-zinc-800/80 px-4 py-2 rounded-lg border border-zinc-700"
                    style={{ left: LAYOUT.PROCESSING_BELT_START_X }}
                >
                    {[
                        { c: "bg-amber-600", t: "Raw" },
                        { c: "bg-amber-600 ring-2 ring-cyan-400", t: "Processing" },
                        { c: "bg-rose-600", t: "Processed" },
                        { c: "bg-emerald-600", t: "Printed" },
                    ].map((l) => (
                        <div key={l.t} className="flex items-center gap-2">
                            <div className={`w-3 h-3 ${l.c} rounded border border-zinc-900`} />
                            <span className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider">
                                {l.t}
                            </span>
                        </div>
                    ))}
                </div>

                {/* Vertical Intake Belt */}
                <div
                    className="absolute w-12 bg-olive-700 border-2 border-zinc-700 rounded-sm overflow-hidden"
                    style={{
                        left: REGIONS.belt.x + 4,
                        top: REGIONS.belt.y,
                        height: REGIONS.belt.h,
                    }}
                >
                    <div
                        className="w-full h-200"
                        style={{
                            backgroundImage:
                                "repeating-linear-gradient(0deg, transparent, transparent 10px, rgba(0,0,0,0.3) 10px, rgba(0,0,0,0.3) 20px)",
                        }}
                    />
                </div>

                {/* Intake capacity badges */}
                <CapacityBadge
                    label="Bays"
                    count={unloading}
                    capacity={WAREHOUSE_LIMITS.intakeBays}
                    flashing={isFlashing("bays")}
                    title="Concurrent unload() calls"
                    style={{ left: 8, top: REGIONS.bays.y + REGIONS.bays.h + 8 }}
                />
                <CapacityBadge
                    label="Belt"
                    count={beltCount}
                    capacity={WAREHOUSE_LIMITS.intakeBelt}
                    flashing={isFlashing("belt")}
                    title="Packages on the intake belt + being unloaded"
                    style={{ left: 8, top: REGIONS.bays.y + REGIONS.bays.h + 32 }}
                />

                {/* Workers (unloading bays) */}
                {LAYOUT.WORKER_Y.map((y, i) => (
                    <div
                        key={`worker-${i}`}
                        className="absolute"
                        style={{ left: LAYOUT.DOCK_X, top: y - 20 }}
                    >
                        <div className="relative w-10 h-10 flex flex-col items-center">
                            <div className="absolute bottom-0 w-8 h-4 bg-indigo-800 rounded-t-lg border-2 border-zinc-900" />
                            <div
                                className={`absolute top-0 w-8 h-5 rounded-t-full border-2 border-zinc-900 z-10 ${
                                    state.activeUnloaders[i] ? "bg-amber-400" : "bg-amber-700"
                                }`}
                            >
                                <div className="absolute top-1 left-2 w-2 h-1 bg-white opacity-50 rounded-full" />
                            </div>
                            <div
                                className={`absolute top-4 w-10 h-1.5 border-2 border-zinc-900 rounded-full z-10 ${
                                    state.activeUnloaders[i] ? "bg-amber-400" : "bg-amber-700"
                                }`}
                            />
                            <div className="absolute top-5 w-6 h-4 bg-amber-200 border-2 border-t-0 border-zinc-900 rounded-b-lg z-0" />
                        </div>
                    </div>
                ))}

                {/* Processing Belts */}
                {LAYOUT.PROCESSING_BELT_Y.map((y, i) => (
                    <Fragment key={`belt-${i}`}>
                        <div
                            className="absolute text-[10px] font-bold text-zinc-400 uppercase tracking-wider"
                            style={{ left: LAYOUT.PROCESSING_BELT_START_X, top: y - 42 }}
                        >
                            Line {i}
                        </div>
                        <CapacityBadge
                            count={state.processingQueues[i]?.length ?? 0}
                            capacity={WAREHOUSE_LIMITS.processingLine}
                            flashing={isFlashing(`line-${i}`)}
                            title={`Packages on line ${i}`}
                            style={{
                                left: LAYOUT.PROCESSING_BELT_END_X - 4,
                                top: y - 44,
                            }}
                        />
                        <div
                            className="absolute h-10 bg-cyan-800 border-2 border-zinc-700 rounded-sm overflow-hidden"
                            style={{
                                left: LAYOUT.PROCESSING_BELT_START_X,
                                top: y - 20,
                                width:
                                    LAYOUT.PROCESSING_BELT_END_X -
                                    LAYOUT.PROCESSING_BELT_START_X +
                                    LAYOUT.PACKAGE_SIZE +
                                    10,
                            }}
                        >
                            <div
                                className="w-200 h-full"
                                style={{
                                    backgroundImage:
                                        "repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,0.3) 10px, rgba(0,0,0,0.3) 20px)",
                                }}
                            />
                        </div>
                    </Fragment>
                ))}

                {/* Shipping Belts */}
                {Object.entries(LAYOUT.SHIPPING_BELT_Y).map(([name, y]) => (
                    <Fragment key={`ship-${name}`}>
                        <div
                            className="absolute text-[10px] font-bold text-zinc-400 uppercase tracking-wider"
                            style={{ left: LAYOUT.SHIPPING_BELT_START_X, top: y - 42 }}
                        >
                            {name}
                        </div>
                        <CapacityBadge
                            count={state.shippingQueues[name]?.length ?? 0}
                            capacity={WAREHOUSE_LIMITS.shippingLane}
                            flashing={isFlashing(`lane-${name}`)}
                            title={`Packages waiting in the ${name} lane`}
                            style={{ left: LAYOUT.SHIPPING_BELT_END_X - 4, top: y - 44 }}
                        />
                        <div
                            className="absolute h-10 bg-indigo-900 border-2 border-zinc-700 rounded-sm overflow-hidden"
                            style={{
                                left: LAYOUT.SHIPPING_BELT_START_X,
                                top: y - 20,
                                width:
                                    LAYOUT.TRUCK_X - LAYOUT.SHIPPING_BELT_START_X + 4,
                            }}
                        >
                            <div
                                className="w-200 h-full"
                                style={{
                                    backgroundImage:
                                        "repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,0.3) 10px, rgba(0,0,0,0.3) 20px)",
                                }}
                            />
                        </div>
                    </Fragment>
                ))}

                {/* Delivery Trucks */}
                {Object.entries(LAYOUT.SHIPPING_BELT_Y).map(([name, y]) => (
                    <div
                        key={`truck-${name}`}
                        className="absolute w-24 h-14 z-30 flex items-end"
                        style={{ left: LAYOUT.TRUCK_X, top: y - 28 }}
                    >
                        <div className="w-18 h-14 bg-zinc-300 border-2 border-zinc-900 border-l-0 rounded-l-sm relative flex justify-start items-center overflow-hidden z-20">
                            <div className="w-2 h-full bg-zinc-800" />
                            <div className="absolute -bottom-2 left-2 w-4 h-4 bg-zinc-900 rounded-full" />
                            <div className="absolute -bottom-2 left-8 w-4 h-4 bg-zinc-900 rounded-full" />
                        </div>
                        <div className="w-6 h-10 bg-rose-700 border-2 border-zinc-900 rounded-r-lg relative z-20">
                            <div className="absolute top-2 right-1 w-3 h-4 bg-cyan-200 border-2 border-zinc-900 rounded-sm" />
                            <div className="absolute -bottom-2 right-1 w-4 h-4 bg-zinc-900 rounded-full" />
                        </div>
                    </div>
                ))}

                {/* Side-Stamping Printer */}
                <motion.div
                    className="absolute w-12 h-14 bg-zinc-300 border-4 border-zinc-800 rounded-lg z-30 flex items-center justify-start shadow-[4px_4px_0px_rgba(0,0,0,0.4)]"
                    initial={{
                        left: LAYOUT.PRINTER_X,
                        top: LAYOUT.PROCESSING_BELT_Y[0] - 28,
                    }}
                    animate={{
                        top: LAYOUT.PROCESSING_BELT_Y[state.printer.yLineId] - 28,
                    }}
                    transition={{
                        top: {
                            duration:
                                state.printer.travelMs > 0
                                    ? state.printer.travelMs / 1000 / speed
                                    : 0,
                            ease: "easeInOut",
                        },
                    }}
                >
                    <div
                        className={`absolute -top-3 left-3 w-4 h-3 rounded-t-full border-2 border-zinc-800 ${
                            state.printer.isPrinting ? "bg-amber-400" : "bg-zinc-500"
                        }`}
                    />
                    <motion.div
                        className="absolute left-0 w-8 h-4 bg-zinc-400 border-2 border-zinc-800 rounded-l-sm flex items-center"
                        animate={{ x: state.printer.isPrinting ? [0, -20, 0] : 0 }}
                        transition={{
                            duration: state.printer.printMs
                                ? state.printer.printMs / 1000 / speed
                                : 0.2,
                        }}
                        style={{ zIndex: -1 }}
                    >
                        <div className="w-2 h-full bg-rose-500" />
                    </motion.div>
                    <div className="absolute left-0 w-full h-full bg-zinc-300 z-10 flex flex-col justify-center items-center rounded-md">
                        <div className="w-2 h-6 bg-zinc-800 rounded-full" />
                        <div className="absolute bottom-0 text-[8px] font-bold text-zinc-500 uppercase tracking-tighter">
                            PRINTER
                        </div>
                    </div>
                </motion.div>

                {/* --- Dynamic Packages --- */}
                <AnimatePresence key={runId}>
                    {Object.values(state.packages).map((pkg) => {
                        if (pkg.stage === "SHIPPED") return null; // Unmount when shipped

                        const coords = getPackageCoords(pkg);
                        const isLine =
                            pkg.stage === "PROCESSING_LINE" ||
                            pkg.stage === "SHIPPING_LANE";

                        let bgColor = "bg-amber-600";
                        if (pkg.isPrinted) bgColor = "bg-emerald-600";
                        else if (pkg.isProcessed) bgColor = "bg-rose-600";

                        const zClass =
                            pkg.stage === "LOADING"
                                ? "z-40 overflow-hidden"
                                : pkg.isProcessing
                                  ? "overflow-visible z-30"
                                  : "overflow-hidden z-20";

                        return (
                            <motion.div
                                key={`pkg-${pkg.id}`}
                                className={`absolute w-7.5 h-7.5 ${bgColor} border-2 border-zinc-900 rounded-md shadow-[2px_2px_0px_rgba(0,0,0,0.5)] flex items-center justify-center ${zClass}`}
                                onPointerEnter={() =>
                                    setHover({ id: pkg.id, x: coords.x, y: coords.y })
                                }
                                onPointerLeave={() => setHover(null)}
                                initial={{
                                    x: coords.x - (isLine ? 100 : 0),
                                    y: coords.y,
                                    opacity: 0,
                                    scale: 0.5,
                                }}
                                animate={{
                                    x: coords.x,
                                    y: coords.y - 15, // -15 to center on Y coordinate
                                    opacity: 1,
                                    scale: 1,
                                }}
                                exit={{ x: coords.x + 50, opacity: 0, scale: 0.5 }}
                                transition={{
                                    x: { type: "tween", duration: 0.8 / Math.sqrt(speed), ease: "linear" },
                                    y: { type: "tween", duration: 0.15 },
                                    default: { type: "spring", stiffness: 120, damping: 15 },
                                }}
                            >
                                {pkg.isProcessing && (
                                    <>
                                        <div className="absolute -top-3 left-0 w-full h-3 bg-amber-500 border-2 border-b-0 border-zinc-900 origin-bottom transform -skew-x-30 z-0" />
                                        <div className="absolute -top-3 left-0 w-full h-3 bg-amber-500 border-2 border-b-0 border-zinc-900 origin-bottom transform skew-x-30 z-0" />
                                        <svg className="absolute w-6 h-6 z-10 transform -rotate-90">
                                            <motion.circle
                                                cx="12"
                                                cy="12"
                                                r="10"
                                                stroke="rgb(34 211 238)"
                                                strokeWidth="3"
                                                fill="transparent"
                                                strokeLinecap="round"
                                                initial={{ pathLength: 0 }}
                                                animate={{ pathLength: 1 }}
                                                transition={{
                                                    duration: pkg.processingMs
                                                        ? pkg.processingMs / 1000 / speed
                                                        : 1,
                                                    ease: "linear",
                                                }}
                                            />
                                        </svg>
                                    </>
                                )}
                                <span className="text-[10px] text-zinc-100 font-bold z-20 relative">
                                    {pkg.id}
                                </span>
                            </motion.div>
                        );
                    })}
                </AnimatePresence>

                {/* --- Rejection highlights --- */}
                <AnimatePresence>
                    {Object.entries(flashes).map(([key, f]) => {
                        const r = regionFor(f.target);
                        const isFloor = f.target.kind === "floor";
                        return (
                            <motion.div
                                key={`flash-${key}`}
                                className="absolute z-50 pointer-events-none"
                                style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0, transition: { duration: 0.4 } }}
                            >
                                <motion.div
                                    key={f.id}
                                    className={`absolute inset-0 rounded-md border-2 border-rose-500 ${
                                        isFloor ? "bg-rose-500/5" : "bg-rose-500/15"
                                    }`}
                                    initial={{ scale: 1.08, opacity: 0.4 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    transition={{ duration: 0.25 }}
                                    style={{ boxShadow: "0 0 18px rgba(244,63,94,0.55)" }}
                                />
                                <motion.div
                                    key={`label-${f.id}`}
                                    className={`absolute whitespace-nowrap bg-rose-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-lg ${
                                        isFloor ? "left-1/2 -translate-x-1/2 top-2" : "left-0 -top-5"
                                    }`}
                                    initial={{ y: 4, opacity: 0 }}
                                    animate={{ y: 0, opacity: 1 }}
                                >
                                    {f.label}
                                    {f.count > 1 ? ` ×${f.count}` : ""}
                                </motion.div>
                            </motion.div>
                        );
                    })}
                </AnimatePresence>

                {hover &&
                    (() => {
                        const pkg = state.packages[hover.id];
                        const proc = pkg?.processingTime ?? pkg?.processingMs ?? null;
                        const status = pkg?.statusString ?? pkg?.stage ?? "unknown";
                        const waitMs =
                            pkg?.waitElapsed !== undefined
                                ? pkg.waitElapsed
                                : pkg?.waitStart !== undefined
                                  ? Math.max(0, Math.round((now - pkg.waitStart) * speed))
                                  : null;
                        return (
                            <div
                                className="absolute z-50 bg-zinc-900 border border-zinc-800 text-zinc-200 text-[11px] px-2 py-1 rounded-md shadow-lg pointer-events-none"
                                style={{ left: hover.x + 12, top: hover.y - 38 }}
                            >
                                <div className="font-mono text-[11px]">ID: {hover.id}</div>
                                <div className="font-mono text-[11px] text-zinc-300">
                                    processing: {proc !== null ? `${proc}ms` : "—"}
                                </div>
                                <div className="font-mono text-[11px] text-zinc-300">
                                    status: {status}
                                </div>
                                <div className="font-mono text-[11px] text-zinc-300">
                                    waiting: {waitMs !== null ? `${Math.floor(waitMs / 1000)}s` : "—"}
                                </div>
                            </div>
                        );
                    })()}
            </div>
        </div>
    );
}
