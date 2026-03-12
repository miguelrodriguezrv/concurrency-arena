import type { VisualState, Action, VisualPackage } from "./types";

export const initialState: VisualState = {
    packages: {},
    printer: { yLineId: 0, isPrinting: false, travelMs: 0 },
    activeUnloaders: { 0: false, 1: false, 2: false, 3: false },
    intakeQueue: [],
    processingQueues: { 0: [], 1: [], 2: [] },
    shippingQueues: { North: [], South: [], International: [] },
};

function updateQueueIndices(
    packages: Record<number, VisualPackage>,
    queue: number[],
) {
    queue.forEach((pkgId, index) => {
        if (packages[pkgId]) {
            packages[pkgId].queueIndex = index;
        }
    });
}

export function visualReducer(state: VisualState, action: Action): VisualState {
    const {
        packages,
        activeUnloaders,
        printer,
        intakeQueue,
        processingQueues,
        shippingQueues,
    } = state;
    const newPackages = { ...packages };

    switch (action.type) {
        case "RESET":
        case "RESET_WAREHOUSE":
            return initialState;

        case "INTAKE_START": {
            const uId =
                action.unloaderId ??
                Object.keys(activeUnloaders)
                    .map(Number)
                    .find((k) => !activeUnloaders[k]) ??
                0;
            newPackages[action.packageId] = {
                id: action.packageId,
                stage: "DOCK",
                queueIndex: 0,
                unloaderId: uId,
                statusString: "unprocessed",
            };
            return {
                ...state,
                packages: newPackages,
                activeUnloaders: { ...activeUnloaders, [uId]: true },
            };
        }

        case "INTAKE_DONE": {
            const pkg = newPackages[action.packageId];
            if (!pkg) return state;

            pkg.stage = "INTAKE_BELT";
            pkg.statusString = "unloaded";
            // record when the package started waiting using epoch ms (Date.now())
            pkg.waitStart = Date.now();
            pkg.waitElapsed = undefined;
            const newIntakeQueue = [...intakeQueue];
            if (!newIntakeQueue.includes(action.packageId)) {
                newIntakeQueue.push(action.packageId);
            }
            updateQueueIndices(newPackages, newIntakeQueue);

            const unloaderId = pkg.unloaderId;
            return {
                ...state,
                packages: newPackages,
                intakeQueue: newIntakeQueue,
                activeUnloaders:
                    unloaderId !== undefined
                        ? { ...activeUnloaders, [unloaderId]: false }
                        : activeUnloaders,
            };
        }

        case "INDUCTION_START": {
            const pkg = newPackages[action.packageId];
            if (!pkg) return state;

            const newIntakeQueue = intakeQueue.filter(
                (id) => id !== action.packageId,
            );
            updateQueueIndices(newPackages, newIntakeQueue);

            const lineId = action.processingLineId;
            const newProcQueue = [...(processingQueues[lineId] || [])];
            if (!newProcQueue.includes(action.packageId)) {
                newProcQueue.push(action.packageId);
            }

            pkg.stage = "PROCESSING_LINE";
            pkg.statusString = "queued";
            pkg.lineId = lineId;
            updateQueueIndices(newPackages, newProcQueue);

            return {
                ...state,
                packages: newPackages,
                intakeQueue: newIntakeQueue,
                processingQueues: {
                    ...processingQueues,
                    [lineId]: newProcQueue,
                },
            };
        }

        case "PROCESS_START": {
            const pkg = newPackages[action.packageId];
            if (pkg) {
                pkg.isProcessing = true;
                pkg.processingMs = action.processingMs;
                // Expose the public processingTime when provided by the runtime
                if (typeof action.processingMs === "number") {
                    pkg.processingTime = action.processingMs;
                }
                pkg.statusString = "processing";
            }
            return { ...state, packages: newPackages };
        }

        case "PROCESS_DONE": {
            const pkg = newPackages[action.packageId];
            if (pkg) {
                pkg.isProcessing = false;
                pkg.isProcessed = true;
                pkg.statusString = "processed";
            }
            return { ...state, packages: newPackages };
        }

        case "PRINTER_MOVE_START":
            return {
                ...state,
                printer: {
                    ...printer,
                    yLineId: action.processingLineId,
                    travelMs: action.travelMs,
                },
            };

        case "PRINTER_MOVE_DONE":
            return {
                ...state,
                printer: {
                    ...printer,
                    yLineId: action.processingLineId,
                },
            };

        case "PRINT_START": {
            const pkg = newPackages[action.packageId];
            if (pkg) {
                pkg.stage = "PRINTING";
                pkg.statusString = "printing";
            }
            return {
                ...state,
                packages: newPackages,
                printer: {
                    ...printer,
                    yLineId: action.processingLineId,
                    isPrinting: true,
                    printMs: action.printMs,
                },
            };
        }

        case "PRINT_SUCCESS": {
            const pkg = newPackages[action.packageId];
            if (pkg) {
                pkg.shippingLine = action.laneId;
                pkg.isPrinted = true;
                pkg.statusString = "printed";
            }
            return {
                ...state,
                packages: newPackages,
                printer: { ...printer, isPrinting: false },
            };
        }

        case "SHIP_ENQUEUED": {
            const pkg = newPackages[action.packageId];
            if (!pkg) return state;

            const lineId = pkg.lineId;
            const newProcessingQueues = { ...processingQueues };
            if (lineId !== undefined) {
                newProcessingQueues[lineId] = (
                    newProcessingQueues[lineId] || []
                ).filter((id) => id !== action.packageId);
                updateQueueIndices(newPackages, newProcessingQueues[lineId]);
            }

            const laneId = action.laneId;
            const newShipQueue = [...(shippingQueues[laneId] || [])];
            if (!newShipQueue.includes(action.packageId)) {
                newShipQueue.push(action.packageId);
            }

            pkg.stage = "SHIPPING_LINE";
            pkg.statusString = "shipping";
            pkg.shippingLine = laneId;
            updateQueueIndices(newPackages, newShipQueue);

            return {
                ...state,
                packages: newPackages,
                processingQueues: newProcessingQueues,
                shippingQueues: { ...shippingQueues, [laneId]: newShipQueue },
            };
        }

        case "SHIP_START": {
            const pkg = newPackages[action.packageId];
            if (!pkg) return state;

            // At SHIP_START we do NOT mark it as shipped or remove it from the queue yet,
            // because it physically represents the package sitting inside the back of the
            // truck for X seconds while the loader loads it!
            return state;
        }

        case "SHIP_COMPLETE": {
            const pkg = newPackages[action.packageId];
            if (!pkg) return state;

            const laneId = pkg.shippingLine;
            if (laneId) {
                const newShipQueue = (shippingQueues[laneId] || []).filter(
                    (id) => id !== action.packageId,
                );
                updateQueueIndices(newPackages, newShipQueue);

                // finalize wait time using event timestamp if available
                const endTs = Date.now();
                if (pkg.waitStart !== undefined) {
                    pkg.waitElapsed = Math.max(0, endTs - pkg.waitStart);
                }

                pkg.stage = "SHIPPED";
                pkg.statusString = "shipped";

                return {
                    ...state,
                    packages: newPackages,
                    shippingQueues: {
                        ...shippingQueues,
                        [laneId]: newShipQueue,
                    },
                };
            }

            // finalize wait time even if shipping lane wasn't recorded
            const endTs = Date.now();
            if (pkg.waitStart !== undefined) {
                pkg.waitElapsed = Math.max(0, endTs - pkg.waitStart);
            }
            pkg.stage = "SHIPPED";
            pkg.statusString = "shipped";
            return { ...state, packages: newPackages };
        }

        default:
            return state;
    }
}
