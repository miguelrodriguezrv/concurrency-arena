import type { VisualPackage } from "./types";

export const LAYOUT = {
    // Fixed logical stage size; the visualizer scales this to fit its container.
    STAGE_WIDTH: 880,
    STAGE_HEIGHT: 470,

    DOCK_X: 20,
    WORKER_Y: [100, 190, 280, 370],
    INTAKE_BELT_X: 100,
    PROCESSING_BELT_START_X: 170,
    PROCESSING_BELT_END_X: 430,
    PROCESSING_BELT_Y: [120, 245, 370],
    PRINTER_X: 470, // Next to the end of the processing belt
    SHIPPING_BELT_START_X: 550,
    SHIPPING_BELT_END_X: 750,
    SHIPPING_BELT_Y: { North: 120, South: 245, International: 370 } as Record<
        string,
        number
    >,
    TRUCK_X: 760,
    PACKAGE_SIZE: 30,
};

/** Bounding boxes (stage coords) used for highlights and capacity badges. */
export const REGIONS = {
    bays: {
        x: 8,
        y: LAYOUT.WORKER_Y[0] - 32,
        w: 70,
        h: LAYOUT.WORKER_Y[3] - LAYOUT.WORKER_Y[0] + 64,
    },
    belt: {
        x: LAYOUT.INTAKE_BELT_X - 19,
        y: LAYOUT.WORKER_Y[0] - 24,
        w: 56,
        h: LAYOUT.WORKER_Y[3] - LAYOUT.WORKER_Y[0] + 48,
    },
    line: (i: number) => ({
        x: LAYOUT.PROCESSING_BELT_START_X - 4,
        y: LAYOUT.PROCESSING_BELT_Y[i] - 24,
        w:
            LAYOUT.PROCESSING_BELT_END_X -
            LAYOUT.PROCESSING_BELT_START_X +
            LAYOUT.PACKAGE_SIZE +
            18,
        h: 48,
    }),
    printer: (i: number) => ({
        x: LAYOUT.PRINTER_X - 6,
        y: LAYOUT.PROCESSING_BELT_Y[i] - 34,
        w: 60,
        h: 68,
    }),
    lane: (name: string) => ({
        x: LAYOUT.SHIPPING_BELT_START_X - 4,
        y: (LAYOUT.SHIPPING_BELT_Y[name] ?? 0) - 24,
        w: LAYOUT.SHIPPING_BELT_END_X - LAYOUT.SHIPPING_BELT_START_X + 48,
        h: 48,
    }),
};

export function getPackageCoords(pkg: VisualPackage) {
    let x = -50;
    let y = -50;

    switch (pkg.stage) {
        case "DOCK":
            x = LAYOUT.DOCK_X + 20; // Sit on top of the worker
            y = LAYOUT.WORKER_Y[pkg.unloaderId || 0];
            break;
        case "INTAKE_BELT":
            x = LAYOUT.INTAKE_BELT_X; // Move onto the vertical intake belt
            // Queue vertically along the intake belt
            y = LAYOUT.WORKER_Y[0] - 10 + pkg.queueIndex * 36;
            break;
        case "PROCESSING_LINE":
            // Move backwards based on queue index
            x =
                LAYOUT.PROCESSING_BELT_END_X -
                pkg.queueIndex * (LAYOUT.PACKAGE_SIZE + 10);
            y = LAYOUT.PROCESSING_BELT_Y[pkg.lineId || 0];
            break;
        case "PRINTING":
            x = LAYOUT.PROCESSING_BELT_END_X;
            y = LAYOUT.PROCESSING_BELT_Y[pkg.lineId || 0];
            break;
        case "SHIPPING_LINE":
            // Queue backwards from the end of the shipping line
            x =
                LAYOUT.SHIPPING_BELT_END_X -
                pkg.queueIndex * (LAYOUT.PACKAGE_SIZE + 10);
            if (
                pkg.shippingLine &&
                LAYOUT.SHIPPING_BELT_Y[pkg.shippingLine] !== undefined
            ) {
                y = LAYOUT.SHIPPING_BELT_Y[pkg.shippingLine];
            }
            break;
        case "LOADING":
            // Inside the open back of the truck
            x = LAYOUT.TRUCK_X + 22;
            if (
                pkg.shippingLine &&
                LAYOUT.SHIPPING_BELT_Y[pkg.shippingLine] !== undefined
            ) {
                y = LAYOUT.SHIPPING_BELT_Y[pkg.shippingLine];
            }
            break;
        case "SHIPPED":
            x = LAYOUT.STAGE_WIDTH + 40; // Slide off to the right
            if (
                pkg.shippingLine &&
                LAYOUT.SHIPPING_BELT_Y[pkg.shippingLine] !== undefined
            ) {
                y = LAYOUT.SHIPPING_BELT_Y[pkg.shippingLine];
            }
            break;
    }

    return { x, y };
}
