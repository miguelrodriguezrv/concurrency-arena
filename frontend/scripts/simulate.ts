/**
 * Timing tuner: runs example strategies against the real Warehouse runtime
 * at high speed and prints the resulting (game-time) scores.
 *
 *   bun scripts/simulate.ts [speed] [preset]
 *
 * Strategies are the JS examples in src/editor/examples/js plus a couple of
 * extra "anti-pattern" strategies defined below.
 */
import { readFileSync } from "node:fs";
import { createWarehouse, DEFAULT_TIMINGS, type WarehouseTimings } from "../src/lib/warehouse/warehouse";
import { JS_LIBRARIES, rewriteImports } from "../src/services/runners/jsLibraries";

const speed = Number(process.argv[2] ?? 20);
const presetName = process.argv[3] ?? "default";

const PRESETS: Record<string, Partial<WarehouseTimings>> = {
    default: {},
    old: {
        unloadMs: 600, pushMs: 100, processingMinMs: 500, processingMaxMs: 3000, printMs: 500,
        printerTravelMs: 2000, shipEnqueueMs: 200, shipLoadMs: 2000, capacityPenaltyMs: 2000, busyPenaltyMs: 1000,
        slowFraction: 0,
    },
};
for (const arg of process.argv.slice(4)) {
    const [k, v] = arg.split("=");
    (PRESETS[presetName] ??= {})[k as keyof WarehouseTimings] = Number(v);
}
const timings = { ...DEFAULT_TIMINGS, ...(PRESETS[presetName] ?? {}) };

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const examples = (name: string) =>
    readFileSync(new URL(`../src/editor/examples/js/${name}`, import.meta.url), "utf8");

// Extra strategies used only for balancing.
const BRUTE_RETRY = `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function retry(fn) { while (true) { try { return await fn(); } catch (e) { if (String(e.message).includes('terminated')) throw e; await sleep(5); } } }
async function worker() {
  while (true) {
    const pkg = await retry(() => warehouse.unload());
    if (pkg === null) return;
    const line = pkg.id % 3;
    await retry(() => warehouse.pushToProcessingLine(pkg.id, line));
    await retry(() => warehouse.processPackage(pkg.id, line));
    const lane = await retry(() => warehouse.print(pkg.id, line));
    await retry(() => warehouse.ship(pkg.id, lane));
  }
}
await Promise.all(Array.from({ length: 12 }, worker));
`;

const STRATEGIES: Record<string, string> = {
    "01 sequential": examples("01_sequential.js"),
    "02 single line": examples("02_single_line.js"),
    "03 unload ahead": examples("03_unload_ahead.js"),
    "04 worker per line": examples("04_worker_per_line.js"),
    "05 staged pipeline": examples("05_staged_pipeline.js"),
    "06 printer batching": examples("06_printer_batching.js"),
    "07 tuned": examples("07_tuned.js"),
    "xx brute retry x12": BRUTE_RETRY,
    "xx brute x4 backoff": BRUTE_RETRY.replace("length: 12", "length: 4").replace("sleep(5)", "sleep(300)"),
};

interface Result {
    name: string;
    seconds?: number;
    upm?: number;
    errors: number;
    moves: number;
    printEff?: number;
    outcome: string;
}

async function runOne(name: string, code: string): Promise<Result> {
    const wh = createWarehouse(undefined, { speed, timings });
    let completed: { finalDuration: number; finalUPM: number } | undefined;
    let errors = 0;
    let fatal = false;
    let moves = 0;
    let printMs = 0;
    let moveMs = 0;
    wh.onEvent((ev) => {
        if (ev.type === "COMPLETED") completed = ev.metadata as typeof completed;
        if (ev.type === "ERROR") {
            errors++;
            if (ev.metadata?.fatal) fatal = true;
        }
        if (ev.type === "PRINTER_MOVE_START" && ev.metadata?.travelMs > 0) {
            moves++;
            moveMs += ev.metadata.travelMs;
        }
        if (ev.type === "PRINT_START") printMs += ev.metadata?.printMs ?? 0;
    });
    const silent = { log() {}, warn() {}, error() {} };
    let outcome = "ok";
    try {
        const limit = 900000 / speed; // 15 game-minutes
        await Promise.race([
            new AsyncFunction("warehouse", "console", "__lib", rewriteImports(code))(wh, silent, JS_LIBRARIES),
            new Promise((_, rej) => setTimeout(() => rej(new Error("timeout (stalled?)")), limit)),
        ]);
        const s = await wh.settle!(600000 / speed);
        if (!s.complete) outcome = `incomplete ${s.shipped}/${s.total}`;
    } catch (e) {
        outcome = fatal ? "FATAL" : `crash: ${(e as Error).message.slice(0, 60)}`;
    }
    wh.dispose?.();
    return {
        name,
        seconds: completed ? completed.finalDuration / 1000 : undefined,
        upm: completed?.finalUPM,
        errors,
        moves,
        printEff: printMs + moveMs > 0 ? (100 * printMs) / (printMs + moveMs) : undefined,
        outcome: completed ? "ok" : outcome,
    };
}

function bounds() {
    // Lower bounds (game time) to reason about the balance.
    const t = timings;
    const avgProc =
        (1 - t.slowFraction) * ((t.processingMinMs + t.processingMaxMs) / 2) +
        t.slowFraction * ((t.slowMinMs + t.slowMaxMs) / 2);
    const N = 100;
    return {
        "intake (4 bays)": (N * t.unloadMs) / 4 / 1000,
        "processing (3 lines)": (N * avgProc) / 3 / 1000,
        "printer, no moves": (N * (t.printMs + t.shipEnqueueMs)) / 1000,
        "printer, batches of 5": (N * (t.printMs + t.shipEnqueueMs) + (N / 5 - 1) * t.printerTravelMs) / 1000,
        "shipping (busiest lane ~37)": (37 * t.shipLoadMs) / 1000,
    };
}

console.log(`speed x${speed}, timings:`, timings);
{
    const probe = createWarehouse(undefined, { speed: 1000, timings });
    const lanes: Record<string, number> = {};
    // read the private deck (tuning only)
    type Rec = { targetLane: string; processingTime: number };
    const records = [...(probe as unknown as { packageRecords: Map<number, Rec> }).packageRecords.values()];
    for (const rec of records) lanes[rec.targetLane] = (lanes[rec.targetLane] ?? 0) + 1;
    const procs = records.map((r) => r.processingTime);
    console.log("lanes:", lanes, "processing sum(s):", procs.reduce((a: number, b: number) => a + b, 0) / 1000);
    probe.dispose?.();
}
console.log("lower bounds (s):", Object.fromEntries(Object.entries(bounds()).map(([k, v]) => [k, +v.toFixed(1)])));

const only = process.env.ONLY;
const results = await Promise.all(
    Object.entries(STRATEGIES)
        .filter(([n]) => !only || n.includes(only))
        .map(([n, c]) => runOne(n, c)),
);
console.log("");
console.log("strategy".padEnd(24), "time(s)".padStart(8), "UPM".padStart(7), "errors".padStart(7), "moves".padStart(6), "printEff".padStart(9), " outcome");
for (const r of results) {
    console.log(
        r.name.padEnd(24),
        (r.seconds?.toFixed(1) ?? "-").padStart(8),
        (r.upm?.toFixed(1) ?? "-").padStart(7),
        String(r.errors).padStart(7),
        String(r.moves).padStart(6),
        (r.printEff !== undefined ? r.printEff.toFixed(0) + "%" : "-").padStart(9),
        "",
        r.outcome,
    );
}
process.exit(0);
