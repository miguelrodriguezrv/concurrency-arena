import type { VisualPackage } from "./types";

export const LAYOUT = {
    DOCK_X: 20,
    WORKER_Y: [80, 180, 280, 380],
    INTAKE_BELT_X: 100,
    PROCESSING_BELT_START_X: 160,
    PROCESSING_BELT_END_X: 420,
    PROCESSING_BELT_Y: [100, 230, 360],
    PRINTER_X: 460, // Next to the end of the processing belt
    SHIPPING_BELT_START_X: 540,
    SHIPPING_BELT_END_X: 740,
    SHIPPING_BELT_Y: { North: 100, South: 230, International: 360 } as Record<
        string,
        number
    >,
    PACKAGE_SIZE: 30,
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
            y =
                LAYOUT.WORKER_Y[0] +
                pkg.queueIndex * (LAYOUT.PACKAGE_SIZE + 10);
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
        case "SHIPPED":
            x = 1000; // Slide far right, off screen
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
