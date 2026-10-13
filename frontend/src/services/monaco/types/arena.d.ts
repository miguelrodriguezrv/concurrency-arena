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
     * @param shippingLane The name of the shipping lane (e.g., "North", "South").
     * @returns A promise that resolves when the package is shipped.
     */
    ship(packageId: number, shippingLane: string): Promise<void>;

    /**
     * Returns the current queue length for the requested shipping lane.
     * @param shippingLane The name of the shipping lane.
     * @returns The current number of packages in that lane's queue.
     */
    getShippingLaneQueueLength(shippingLane: string): number;
}

/**
 * The global warehouse instance available in the JavaScript environment.
 */
declare const arena: WarehouseAPI;
declare const API: WarehouseAPI;
declare const warehouse: WarehouseAPI;
declare const __warehouse: WarehouseAPI;

/*
 * Concurrency helpers available via import (same as in the slides):
 *   import pLimit from "p-limit";
 *   import { Mutex, Semaphore } from "async-mutex";
 *   import PQueue from "p-queue";
 * Minimal declarations for editor autocompletion.
 */
declare module "p-limit" {
    interface LimitFunction {
        <Args extends unknown[], R>(fn: (...args: Args) => PromiseLike<R> | R, ...args: Args): Promise<R>;
        /** Promises currently running. */
        readonly activeCount: number;
        /** Promises waiting to run. */
        readonly pendingCount: number;
        concurrency: number;
        clearQueue(): void;
    }
    /** Run at most `concurrency` functions at the same time. */
    export default function pLimit(concurrency: number): LimitFunction;
}

declare module "async-mutex" {
    export class Mutex {
        /** Wait for the lock; returns a function that releases it. */
        acquire(): Promise<() => void>;
        /** Run `callback` while holding the lock (released even on errors). */
        runExclusive<T>(callback: () => Promise<T> | T): Promise<T>;
        isLocked(): boolean;
        release(): void;
        /** Resolves when the mutex is free (without taking it). */
        waitForUnlock(): Promise<void>;
    }
    export class Semaphore {
        /** A bag of `permits`. */
        constructor(permits: number);
        /** Wait for a permit; returns [currentValue, release]. */
        acquire(weight?: number): Promise<[number, () => void]>;
        /** Run `callback` while holding a permit (released even on errors). */
        runExclusive<T>(callback: (value: number) => Promise<T> | T, weight?: number): Promise<T>;
        getValue(): number;
        isLocked(): boolean;
        release(weight?: number): void;
        waitForUnlock(weight?: number): Promise<void>;
    }
    export function withTimeout<T extends Mutex | Semaphore>(sync: T, timeoutMs: number, timeoutError?: Error): T;
}

declare module "p-queue" {
    interface Options {
        /** How many tasks run at the same time (default: Infinity). */
        concurrency?: number;
        autoStart?: boolean;
    }
    /** A queue of async tasks with limited concurrency. */
    export default class PQueue {
        constructor(options?: Options);
        add<T>(task: () => PromiseLike<T> | T): Promise<T>;
        addAll<T>(tasks: Array<() => PromiseLike<T> | T>): Promise<T[]>;
        /** Resolves when the queue is empty and all tasks finished. */
        onIdle(): Promise<void>;
        /** Resolves when the queue is empty (tasks may still be running). */
        onEmpty(): Promise<void>;
        /** Resolves when fewer than `limit` tasks are waiting. */
        onSizeLessThan(limit: number): Promise<void>;
        /** Tasks waiting to start. */
        readonly size: number;
        /** Tasks running. */
        readonly pending: number;
        concurrency: number;
        start(): this;
        pause(): void;
        clear(): void;
    }
}
