export type Stage =
    | "DOCK"
    | "INTAKE_BELT"
    | "PROCESSING_LINE"
    | "PRINTING"
    | "SHIPPING_LINE"
    | "SHIPPED";

export interface VisualPackage {
    id: number;
    stage: Stage;
    lineId?: number; // 0, 1, 2 for processing, or specific string for shipping
    shippingLine?: string; // 'North', 'South', 'International'
    queueIndex: number; // Position in the queue to calculate spacing
    unloaderId?: number; // 0 to 3
    isProcessing?: boolean;
    isProcessed?: boolean;
    isPrinted?: boolean;
    processingMs?: number;
    // Waiting tracking
    waitStart?: number; // timestamp when package was unloaded (performance.now())
    waitElapsed?: number; // finalized wait time in ms when shipped
    // Public fields derived from the Warehouse runtime's PackagePublic
    processingTime?: number; // ms (public processing time)
    statusString?: string; // e.g. 'unloaded', 'processed', 'printed', 'shipped'
}

export interface VisualState {
    packages: Record<number, VisualPackage>;
    printer: {
        yLineId: number;
        isPrinting: boolean;
        travelMs: number;
        printMs?: number;
    };
    activeUnloaders: Record<number, boolean>;
    intakeQueue: number[];
    processingQueues: Record<number, number[]>;
    shippingQueues: Record<string, number[]>;
}

export interface WarehouseEventPayload {
    type: string;
    timestamp?: number;
    packageId: number;
    processingLineId?: number;
    laneId?: string;
    shippingLine?: string;
    metadata?: {
        queueLengthAfter?: number;
        queueLength?: number;
        travelMs?: number;
        from?: number;
        to?: number;
        atPrinterLine?: number;
        printMs?: number;
        processingMs?: number;
    };
}

export type Action =
    | { type: "RESET" }
    | { type: "RESET_WAREHOUSE" }
    | { type: "INTAKE_START"; packageId: number; unloaderId?: number }
    | { type: "INTAKE_DONE"; packageId: number }
    | {
          type: "INDUCTION_START";
          packageId: number;
          processingLineId: number;
          queueLength: number;
      }
    | {
          type: "PROCESS_START";
          packageId: number;
          processingLineId: number;
          processingMs?: number;
      }
    | { type: "PROCESS_DONE"; packageId: number; processingLineId: number }
    | { type: "PRINTER_MOVE_START"; processingLineId: number; travelMs: number }
    | { type: "PRINTER_MOVE_DONE"; processingLineId: number }
    | {
          type: "PRINT_START";
          packageId: number;
          processingLineId: number;
          printMs?: number;
      }
    | { type: "PRINT_SUCCESS"; packageId: number; laneId: string }
    | {
          type: "SHIP_ENQUEUED";
          packageId: number;
          laneId: string;
          queueLength: number;
      }
    | { type: "SHIP_START"; packageId: number; laneId: string }
    | { type: "SHIP_COMPLETE"; packageId: number };
