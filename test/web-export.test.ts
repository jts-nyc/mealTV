import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CategorySchema, SeveritySchema } from "../src/schema/catalog.js";
import {
  createLoggedEntry,
  importLogCliCommand,
  toImportLogPayload,
  type LoggedEntry,
} from "../web/src/export-log.js";
import { REACTION_OFFSET_SEC } from "../web/src/constants.js";

/**
 * Mirrors `LogEntrySchema` in src/cli/commands/import-log.ts exactly, so this
 * test fails loudly if the web export payload and the CLI's importer ever
 * drift apart. (Not importing the CLI's schema directly since that module is
 * outside this agent's file ownership and wires up commander/fs side
 * effects; this is a deliberate structural cross-check instead.)
 */
const ImportLogEntrySchema = z.object({
  slug: z.string().min(1),
  season: z.number().int(),
  episode: z.number().int(),
  category: CategorySchema,
  severity: SeveritySchema.optional(),
  atSec: z.number().nonnegative(),
  note: z.string().optional(),
});

describe("createLoggedEntry", () => {
  it("subtracts REACTION_OFFSET_SEC from the elapsed time", () => {
    const entry = createLoggedEntry({
      id: "log-1",
      slug: "test-show",
      season: 1,
      episode: 1,
      elapsedSec: 100,
      category: "vomiting",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(entry.atSec).toBe(100 - REACTION_OFFSET_SEC);
  });

  it("never produces a negative atSec", () => {
    const entry = createLoggedEntry({
      id: "log-2",
      slug: "test-show",
      season: 1,
      episode: 1,
      elapsedSec: 1,
      category: "gore",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(entry.atSec).toBe(0);
  });

  it("defaults severity to medium when not provided", () => {
    const entry = createLoggedEntry({
      id: "log-3",
      slug: "test-show",
      season: 1,
      episode: 1,
      elapsedSec: 50,
      category: "other",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(entry.severity).toBe("medium");
  });
});

describe("toImportLogPayload", () => {
  const entries: LoggedEntry[] = [
    {
      id: "a",
      slug: "test-show",
      season: 1,
      episode: 3,
      category: "vomiting",
      severity: "high",
      atSec: 1234,
      note: "right after the buffet scene",
      loggedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "b",
      slug: "other-show",
      season: 2,
      episode: 10,
      category: "gore",
      severity: "medium",
      atSec: 42,
      loggedAt: "2026-01-01T00:01:00.000Z",
    },
  ];

  it("emits exactly the shape mealtv import-log expects", () => {
    const payload = toImportLogPayload(entries);
    expect(payload).toEqual([
      {
        slug: "test-show",
        season: 1,
        episode: 3,
        category: "vomiting",
        severity: "high",
        atSec: 1234,
        note: "right after the buffet scene",
      },
      {
        slug: "other-show",
        season: 2,
        episode: 10,
        category: "gore",
        severity: "medium",
        atSec: 42,
      },
    ]);
  });

  it("drops local-only id/loggedAt fields and omits empty note", () => {
    const payload = toImportLogPayload(entries);
    for (const item of payload) {
      expect(item).not.toHaveProperty("id");
      expect(item).not.toHaveProperty("loggedAt");
    }
    expect(payload[1]).not.toHaveProperty("note");
  });

  it("validates against the CLI's import-log entry schema", () => {
    const payload = toImportLogPayload(entries);
    for (const item of payload) {
      const result = ImportLogEntrySchema.safeParse(item);
      expect(result.success).toBe(true);
    }
  });

  it("round-trips a JSON.stringify/parse cycle (as it would going through the export/copy flow)", () => {
    const payload = toImportLogPayload(entries);
    const roundTripped = JSON.parse(JSON.stringify(payload));
    expect(roundTripped).toEqual(payload);
    for (const item of roundTripped) {
      expect(ImportLogEntrySchema.safeParse(item).success).toBe(true);
    }
  });
});

describe("importLogCliCommand", () => {
  it("names the correct CLI command", () => {
    expect(importLogCliCommand("mealtv-log.json")).toBe("mealtv import-log mealtv-log.json");
  });

  it("has a sensible default filename", () => {
    expect(importLogCliCommand()).toMatch(/^mealtv import-log .+\.json$/);
  });
});
