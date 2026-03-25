/**
 * The Arena API is injected into the global scope.
 * It allows students to interact with the warehouse simulation.
 */

interface Package {
    /** The unique identifier of the package. */
    id: number;
    /** The time (in ms) it takes to process this package. */
    processingTime: number;
}

interface WarehouseAPI {
    /**
     * Unloads the next package from the intake belt.
     * Returns null if no more packages are available.
     * @returns A promise that resolves to a Package or null.
     */
    unload(): Promise<Package | null>;

    /**
     * Pushes a package onto a processing line queue (0, 1, or 2).
     * @param packageId The ID of the package to push.
     * @param processingLineId The index of the processing line (0-2).
     * @returns A promise that resolves when the package is queued.
     */
    pushToProcessingLine(
        packageId: number,
        processingLineId: number,
    ): Promise<void>;

    /**
     * Processes a package at the head of a processing line.
     * @param packageId The ID of the package to process.
     * @param processingLineId The index of the processing line.
     * @returns A promise that resolves when processing is complete.
     */
    processPackage(packageId: number, processingLineId: number): Promise<void>;

    /**
     * Prints a label for a processed package and returns the assigned shipping lane.
     * @param packageId The ID of the package.
     * @param processingLineId The index of the processing line.
     * @returns A promise that resolves to the name of the shipping lane (e.g., "North").
     */
    print(packageId: number, processingLineId: number): Promise<string>;

    /**
     * Enqueues a package into the specified shipping lane.
     * @param packageId The ID of the package.
     * @param shippingLine The name of the shipping lane (e.g., "North", "South").
     * @returns A promise that resolves when the package is shipped.
     */
    ship(packageId: number, shippingLine: string): Promise<void>;

    /**
     * Returns the current queue length for the requested shipping lane.
     * @param shippingLine The name of the shipping lane.
     * @returns The current number of packages in that lane's queue.
     */
    getShippingLineQueueLength(shippingLine: string): number;
}

/**
 * The global warehouse instance available in the JavaScript environment.
 */
declare const arena: WarehouseAPI;
declare const API: WarehouseAPI;
declare const warehouse: WarehouseAPI;
declare const __warehouse: WarehouseAPI;
