import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Command } from "commander";
import type { Show } from "../src/schema/catalog.js";

// Same pattern as test/catalog-store.test.ts: point the store at a throwaway
// temp dir via MEALTV_CATALOG_DIR so this exercises the real store/CLI code
// end-to-end without touching the real catalog/.
let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "mealtv-cli-curate-test-"));
  process.env.MEALTV_CATALOG_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.MEALTV_CATALOG_DIR;
  rmSync(tmpDir, { recursive: true, force: true });
});

async function buildProgram(): Promise<Command> {
  const { register: registerCurate } = await import("../src/cli/commands/curate.js");
  const { register: registerImportLog } = await import("../src/cli/commands/import-log.js");
  const program = new Command();
  program.exitOverride(); // throw instead of process.exit on commander-level errors
  program.configureOutput({ writeErr: () => {} }); // keep commander's own error printing out of test output
  registerCurate(program);
  registerImportLog(program);
  return program;
}

async function seedShow(overrides: Partial<Show> = {}): Promise<void> {
  const { saveShow } = await import("../src/catalog/store.js");
  const show: Show = {
    slug: "my-show",
    title: "My Show",
    seriesWarnings: [],
    seasons: [
      {
        seasonNumber: 1,
        episodes: [
          {
            episodeNumber: 1,
            reviewedClear: false,
            runtimeSec: 1200,
            warnings: [],
          },
        ],
      },
    ],
    ...overrides,
  };
  saveShow(show);
}

function captureConsoleLog(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  return {
    logs,
    restore: () => {
      console.log = original;
    },
  };
}

describe("cli: curate add", () => {
  it("writes a curated warning with correct fields and derived startFrac/endFrac", async () => {
    await seedShow();
    const program = await buildProgram();

    await program.parseAsync([
      "node",
      "mealtv",
      "curate",
      "add",
      "my-show",
      "--season",
      "1",
      "--episode",
      "1",
      "--category",
      "vomiting",
      "--severity",
      "high",
      "--channel",
      "video",
      "--start",
      "1:00",
      "--end",
      "1:30",
      "--confidence",
      "0.9",
      "--note",
      "test curated note",
    ]);

    const { loadShow } = await import("../src/catalog/store.js");
    const show = loadShow("my-show");
    const warnings = show.seasons[0].episodes[0].warnings;

    expect(warnings).toHaveLength(1);
    const w = warnings[0];
    expect(w.id).toMatch(/^curated-/);
    expect(w.category).toBe("vomiting");
    expect(w.severity).toBe("high");
    expect(w.channel).toBe("video");
    expect(w.scope).toBe("episode");
    expect(w.note).toBe("test curated note");
    expect(w.suppressed).toBe(false);
    expect(w.provenance.type).toBe("curated");
    expect(w.provenance.confidence).toBeCloseTo(0.9);
    expect(w.provenance.detail).toBe("test curated note");

    // start = 1:00 = 60s, end = 1:30 = 90s, episode runtimeSec = 1200
    expect(w.startSecAtSource).toBe(60);
    expect(w.endSecAtSource).toBe(90);
    expect(w.sourceDurationSec).toBe(1200);
    expect(w.startFrac).toBeCloseTo(60 / 1200);
    expect(w.endFrac).toBeCloseTo(90 / 1200);
  });

  it("defaults confidence to 1.0 and channel to both when omitted, and handles hh:mm:ss timing", async () => {
    await seedShow();
    const program = await buildProgram();

    await program.parseAsync([
      "node",
      "mealtv",
      "curate",
      "add",
      "my-show",
      "--season",
      "1",
      "--episode",
      "1",
      "--category",
      "gore",
      "--severity",
      "medium",
      "--start",
      "0:00:10",
    ]);

    const { loadShow } = await import("../src/catalog/store.js");
    const show = loadShow("my-show");
    const w = show.seasons[0].episodes[0].warnings[0];

    expect(w.channel).toBe("both");
    expect(w.provenance.confidence).toBe(1);
    expect(w.startSecAtSource).toBe(10);
  });

  it("creates a missing season/episode rather than throwing", async () => {
    await seedShow();
    const program = await buildProgram();

    await program.parseAsync([
      "node",
      "mealtv",
      "curate",
      "add",
      "my-show",
      "--season",
      "2",
      "--episode",
      "5",
      "--category",
      "blood",
      "--severity",
      "low",
    ]);

    const { loadShow } = await import("../src/catalog/store.js");
    const show = loadShow("my-show");
    const season2 = show.seasons.find((s) => s.seasonNumber === 2);
    expect(season2).toBeDefined();
    const ep5 = season2?.episodes.find((e) => e.episodeNumber === 5);
    expect(ep5).toBeDefined();
    expect(ep5?.warnings).toHaveLength(1);
  });

  it("rejects an invalid --category with a clear error, before touching disk", async () => {
    await seedShow();
    const program = await buildProgram();

    await expect(
      program.parseAsync([
        "node",
        "mealtv",
        "curate",
        "add",
        "my-show",
        "--season",
        "1",
        "--episode",
        "1",
        "--category",
        "not-a-real-category",
        "--severity",
        "low",
      ]),
    ).rejects.toThrow(/invalid --category/);

    const { loadShow } = await import("../src/catalog/store.js");
    expect(loadShow("my-show").seasons[0].episodes[0].warnings).toHaveLength(0);
  });
});

describe("cli: curate clear", () => {
  it("sets reviewedClear to true on the target episode", async () => {
    await seedShow();
    const program = await buildProgram();

    await program.parseAsync([
      "node",
      "mealtv",
      "curate",
      "clear",
      "my-show",
      "--season",
      "1",
      "--episode",
      "1",
    ]);

    const { loadShow } = await import("../src/catalog/store.js");
    const show = loadShow("my-show");
    expect(show.seasons[0].episodes[0].reviewedClear).toBe(true);
  });
});

describe("cli: import-log", () => {
  it("imports a good row, reports a malformed row per-entry, and doesn't abort the whole import", async () => {
    await seedShow();
    const logFile = path.join(tmpDir, "log.json");
    writeFileSync(
      logFile,
      JSON.stringify([
        {
          slug: "my-show",
          season: 1,
          episode: 1,
          category: "vomiting",
          severity: "high",
          atSec: 30,
          note: "self-logged during dinner",
        },
        {
          // malformed: category is not a real Category value
          slug: "my-show",
          season: 1,
          episode: 1,
          category: "not-a-real-category",
          atSec: 10,
        },
      ]),
    );

    const program = await buildProgram();
    const { logs, restore } = captureConsoleLog();
    try {
      await program.parseAsync(["node", "mealtv", "import-log", logFile]);
    } finally {
      restore();
    }

    const { loadShow } = await import("../src/catalog/store.js");
    const show = loadShow("my-show");
    const warnings = show.seasons[0].episodes[0].warnings;

    expect(warnings).toHaveLength(1);
    const w = warnings[0];
    expect(w.category).toBe("vomiting");
    expect(w.severity).toBe("high");
    expect(w.provenance.type).toBe("self-logged");
    expect(w.startSecAtSource).toBe(30);
    expect(w.startFrac).toBeCloseTo(30 / 1200);
    expect(w.note).toBe("self-logged during dinner");

    expect(logs.some((l) => l.includes("Imported 1 of 2"))).toBe(true);
    expect(logs.some((l) => l.includes("entry 1"))).toBe(true);
  });

  it("is lenient about optional fields (severity, note) and strict about required ones", async () => {
    await seedShow();
    const logFile = path.join(tmpDir, "log2.json");
    writeFileSync(
      logFile,
      JSON.stringify([
        // no severity, no note -- both optional, should still import.
        { slug: "my-show", season: 1, episode: 1, category: "bugs_insects", atSec: 5 },
        // missing required "atSec" -- must be reported, not thrown as a hard crash.
        { slug: "my-show", season: 1, episode: 1, category: "gore" },
      ]),
    );

    const program = await buildProgram();
    const { logs, restore } = captureConsoleLog();
    try {
      await program.parseAsync(["node", "mealtv", "import-log", logFile]);
    } finally {
      restore();
    }

    const { loadShow } = await import("../src/catalog/store.js");
    const show = loadShow("my-show");
    const warnings = show.seasons[0].episodes[0].warnings;
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe("medium"); // default when omitted
    expect(logs.some((l) => l.includes("Imported 1 of 2"))).toBe(true);
  });
});
