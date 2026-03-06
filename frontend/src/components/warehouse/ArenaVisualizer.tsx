import { useEffect, useReducer, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { WarehouseEventPayload } from "./types";
import { LAYOUT, getPackageCoords } from "./layout";
import { visualReducer, initialState } from "./visualReducer";

interface ArenaVisualizerProps {
    events?: WarehouseEventPayload[];
}

export function ArenaVisualizer({ events = [] }: ArenaVisualizerProps) {
    const [state, dispatch] = useReducer(visualReducer, initialState);
    const processedCountRef = useRef(0);
    const [runId, setRunId] = useState(0);

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
        // Reset our pointer so we process from the start.
        if (events.length < processedCountRef.current) {
            processedCountRef.current = 0;
        }

        const newEvents = events.slice(processedCountRef.current);
        newEvents.forEach((data) => {
            switch (data.type) {
                case "RESET_WAREHOUSE":
                    dispatch({ type: "RESET_WAREHOUSE" });
                    setRunId((id) => id + 1);
                    break;
                case "INTAKE_START":
                    dispatch({
                        type: "INTAKE_START",
                        packageId: data.packageId,
                    });
                    break;
                case "INTAKE_DONE":
                    dispatch({
                        type: "INTAKE_DONE",
                        packageId: data.packageId,
                    });
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
                        laneId: data.shippingLine || data.laneId!,
                    });
                    break;
                case "SHIP_ENQUEUED":
                    dispatch({
                        type: "SHIP_ENQUEUED",
                        packageId: data.packageId,
                        laneId: data.shippingLine || data.laneId!,
                        queueLength: data.metadata?.queueLength || 0,
                    });
                    break;
                case "SHIP_START":
                    dispatch({
                        type: "SHIP_START",
                        packageId: data.packageId,
                        laneId: data.shippingLine || data.laneId!,
                    });
                    break;
                case "SHIP_COMPLETE":
                    dispatch({
                        type: "SHIP_COMPLETE",
                        packageId: data.packageId,
                    });
                    break;
            }
        });

        processedCountRef.current = events.length;
    }, [events]);

    return (
        <div className="relative w-full h-115 bg-zinc-900 border-4 border-zinc-800 rounded-xl overflow-hidden shadow-[8px_8px_0px_rgba(0,0,0,0.5)] font-sans">
            {/* --- Static Background Elements --- */}

            {/* Workers Zone Background */}
            <div className="absolute left-0 top-0 w-35 h-full border-r-4 border-dashed border-zinc-700 bg-zinc-800/50" />

            {/* Labels */}
            <div className="absolute top-4 left-5 text-[10px] font-bold text-zinc-500 uppercase tracking-widest z-10">
                Intake
            </div>
            <div className="absolute top-4 left-40 text-[10px] font-bold text-zinc-500 uppercase tracking-widest z-10">
                Processing
            </div>
            <div className="absolute top-4 left-135 text-[10px] font-bold text-zinc-500 uppercase tracking-widest z-10">
                Shipping
            </div>

            {/* Legend */}
            <div className="absolute bottom-4 left-40 flex items-center space-x-6 z-10 bg-zinc-800/80 px-4 py-2 rounded-lg border border-zinc-700 backdrop-blur-sm">
                <div className="flex items-center space-x-2">
                    <div className="w-3 h-3 bg-amber-600 rounded border border-zinc-900 shadow-sm" />
                    <span className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider">
                        Raw
                    </span>
                </div>
                <div className="flex items-center space-x-2">
                    <div className="w-3 h-3 bg-rose-600 rounded border border-zinc-900 shadow-sm" />
                    <span className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider">
                        Processed
                    </span>
                </div>
                <div className="flex items-center space-x-2">
                    <div className="w-3 h-3 bg-emerald-600 rounded border border-zinc-900 shadow-sm" />
                    <span className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider">
                        Printed
                    </span>
                </div>
            </div>

            {/* Vertical Intake Belt */}
            <div
                className="absolute w-12 bg-olive-700 border-2 border-zinc-700 rounded-sm overflow-hidden"
                style={{
                    left: LAYOUT.INTAKE_BELT_X - 15,
                    top: LAYOUT.WORKER_Y[0] - 20,
                    height: LAYOUT.WORKER_Y[3] - LAYOUT.WORKER_Y[0] + 40,
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

            {/* Workers */}
            {LAYOUT.WORKER_Y.map((y, i) => (
                <div
                    key={`worker-${i}`}
                    className="absolute"
                    style={{ left: LAYOUT.DOCK_X, top: y - 20 }}
                >
                    <div className="relative w-10 h-10 flex flex-col items-center">
                        {/* Worker Body/Shoulders */}
                        <div className="absolute bottom-0 w-8 h-4 bg-indigo-800 rounded-t-lg border-2 border-zinc-900" />
                        {/* Hardhat */}
                        <div
                            className={`absolute top-0 w-8 h-5 rounded-t-full border-2 border-zinc-900 z-10 ${
                                state.activeUnloaders[i]
                                    ? "bg-amber-400"
                                    : "bg-amber-700"
                            }`}
                        >
                            <div className="absolute top-1 left-2 w-2 h-1 bg-white opacity-50 rounded-full" />
                        </div>
                        {/* Brim */}
                        <div
                            className={`absolute top-4 w-10 h-1.5 border-2 border-zinc-900 rounded-full z-10 ${
                                state.activeUnloaders[i]
                                    ? "bg-amber-400"
                                    : "bg-amber-700"
                            }`}
                        />
                        {/* Face */}
                        <div className="absolute top-5 w-6 h-4 bg-amber-200 border-2 border-t-0 border-zinc-900 rounded-b-lg z-0" />
                    </div>
                </div>
            ))}

            {/* Processing Belts */}
            {LAYOUT.PROCESSING_BELT_Y.map((y, i) => (
                <div
                    key={`belt-${i}`}
                    className="absolute h-10 bg-cyan-800 border-2 border-zinc-700 rounded-sm flex items-center overflow-hidden"
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
                    <div className="absolute left-2 text-[10px] text-zinc-300 font-bold opacity-50 z-10">
                        Line {i}
                    </div>
                </div>
            ))}

            {/* Shipping Belts */}
            {Object.entries(LAYOUT.SHIPPING_BELT_Y).map(([name, y]) => (
                <div
                    key={`ship-${name}`}
                    className="absolute h-10 bg-indigo-900 border-2 border-zinc-700 rounded-sm flex items-center overflow-hidden"
                    style={{
                        left: LAYOUT.SHIPPING_BELT_START_X,
                        top: y - 20,
                        width:
                            LAYOUT.SHIPPING_BELT_END_X -
                            LAYOUT.SHIPPING_BELT_START_X +
                            40,
                    }}
                >
                    <div
                        className="w-200 h-full"
                        style={{
                            backgroundImage:
                                "repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,0.3) 10px, rgba(0,0,0,0.3) 20px)",
                        }}
                    />
                    <div className="absolute left-2 text-[10px] text-zinc-300 font-bold opacity-80 z-10">
                        {name}
                    </div>
                </div>
            ))}

            {/* Delivery Trucks */}
            {Object.entries(LAYOUT.SHIPPING_BELT_Y).map(([name, y]) => (
                <div
                    key={`truck-${name}`}
                    className="absolute w-24 h-14 z-30 flex items-end"
                    style={{
                        left: LAYOUT.SHIPPING_BELT_END_X + 10,
                        top: y - 24,
                    }}
                >
                    {/* Truck Trailer */}
                    <div className="w-18 h-14 bg-zinc-300 border-2 border-zinc-900 border-l-0 rounded-l-sm relative flex justify-start items-center overflow-hidden z-20">
                        <div className="w-2 h-full bg-zinc-800" />
                        <div className="absolute -bottom-2 left-2 w-4 h-4 bg-zinc-900 rounded-full" />
                        <div className="absolute -bottom-2 left-8 w-4 h-4 bg-zinc-900 rounded-full" />
                    </div>
                    {/* Truck Cab */}
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
                                ? state.printer.travelMs / 1000
                                : 0,
                        ease: "easeInOut",
                    },
                }}
            >
                {/* Status Light */}
                <div
                    className={`absolute -top-3 left-3 w-4 h-3 rounded-t-full border-2 border-zinc-800 ${
                        state.printer.isPrinting
                            ? "bg-amber-400"
                            : "bg-zinc-500"
                    }`}
                />

                {/* Side Piston extending LEFT towards the package */}
                <motion.div
                    className="absolute left-0 w-8 h-4 bg-zinc-400 border-2 border-zinc-800 rounded-l-sm flex items-center"
                    animate={{
                        x: state.printer.isPrinting ? [0, -20, 0] : 0,
                    }}
                    transition={{
                        duration: state.printer.printMs
                            ? state.printer.printMs / 1000
                            : 0.2,
                    }}
                    style={{ zIndex: -1 }}
                >
                    <div className="w-2 h-full bg-rose-500" />
                </motion.div>

                {/* Main Body overlay to hide retracting piston */}
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
                        pkg.stage === "SHIPPING_LINE";

                    // Dynamic Package Color
                    let bgColor = "bg-amber-600";
                    if (pkg.isPrinted) {
                        bgColor = "bg-emerald-600";
                    } else if (pkg.isProcessed) {
                        bgColor = "bg-rose-600";
                    }

                    return (
                        <motion.div
                            key={pkg.id}
                            className={`absolute w-7.5 h-7.5 ${bgColor} border-2 border-zinc-900 rounded-md shadow-[2px_2px_0px_rgba(0,0,0,0.5)] flex items-center justify-center ${
                                pkg.isProcessing
                                    ? "overflow-visible z-30"
                                    : "overflow-hidden z-20"
                            }`}
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
                                x: {
                                    type: "tween",
                                    duration: 0.8,
                                    ease: "linear",
                                },
                                y: {
                                    type: "tween",
                                    duration: 0.15,
                                },
                                default: {
                                    type: "spring",
                                    stiffness: 120,
                                    damping: 15,
                                },
                            }}
                        >
                            {pkg.isProcessing && (
                                <>
                                    {/* Open box flaps (Both on Top, diagonal perspective) */}
                                    <div className="absolute -top-3 left-0 w-full h-3 bg-amber-500 border-2 border-b-0 border-zinc-900 origin-bottom transform -skew-x-30 z-0" />
                                    <div className="absolute -top-3 left-0 w-full h-3 bg-amber-500 border-2 border-b-0 border-zinc-900 origin-bottom transform skew-x-30 z-0" />
                                    {/* Processing Ring */}
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
                                                    ? pkg.processingMs / 1000
                                                    : 1,
                                                ease: "linear",
                                            }}
                                        />
                                    </svg>
                                </>
                            )}
                            {/* Always visible ID */}
                            <span className="text-[10px] text-zinc-100 font-bold z-20 relative">
                                {pkg.id}
                            </span>
                        </motion.div>
                    );
                })}
            </AnimatePresence>
        </div>
    );
}
