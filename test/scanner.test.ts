import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { scanSubtitles } from "../src/scanner/scan.js";
import { parseSubtitles } from "../src/scanner/parse-subtitles.js";
import { WarningSchema } from "../src/schema/catalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srtDir = path.join(__dirname, "..", "fixtures", "srt");
const vttDir = path.join(__dirname, "..", "fixtures", "vtt");

function loadSrt(name: string): string {
  return readFileSync(path.join(srtDir, name), "utf-8");
}

function loadVtt(name: string): string {
  return readFileSync(path.join(vttDir, name), "utf-8");
}

describe("scanSubtitles", () => {
  it("emits exactly one high-confidence vomiting warning for a bracket cue", () => {
    const content = loadSrt("vomit-bracket-high-confidence.srt");
    const warnings = scanSubtitles(content, {
      filename: "vomit-bracket-high-confidence.srt",
    });

    expect(warnings).toHaveLength(1);
    const w = warnings[0];
    expect(w.category).toBe("vomiting");
    expect(w.scope).toBe("episode");
    expect(w.provenance.confidence).toBeGreaterThanOrEqual(0.8);
    expect(w.provenance.type).toBe("subtitle-scan");
    expect(w.provenance.detail).toBe("vomit-bracket-high-confidence.srt");
    // Cue is at 00:05:00,000 --> 00:05:03,000.
    expect(w.startSecAtSource).toBeCloseTo(300);
    expect(w.endSecAtSource).toBeCloseTo(303);
  });

  it("still emits a dialogue-mention false-positive-prone warning, at low confidence", () => {
    const content = loadSrt("vomit-dialogue-false-positive.srt");
    const warnings = scanSubtitles(content, {
      filename: "vomit-dialogue-false-positive.srt",
    });

    expect(warnings.length).toBeGreaterThanOrEqual(1);
    const w = warnings.find((x) => x.category === "vomiting");
    expect(w).toBeDefined();
    // Must NOT be dropped, but must be clearly low confidence.
    expect(w!.provenance.confidence).toBeLessThanOrEqual(0.4);
    expect(w!.provenance.confidence).toBeGreaterThan(0);
  });

  it("returns [] for a dialogue-only file with zero bracketed cues, without throwing", () => {
    const content = loadSrt("no-cues-dialogue-only.srt");
    expect(() => scanSubtitles(content)).not.toThrow();
    const warnings = scanSubtitles(content);
    expect(warnings).toEqual([]);
  });

  it("clusters two nearby same-category cues into one warning, and keeps a far-away one separate", () => {
    const content = loadSrt("clustering.srt");
    const warnings = scanSubtitles(content, { filename: "clustering.srt" });

    const vomitingWarnings = warnings
      .filter((w) => w.category === "vomiting")
      .sort((a, b) => (a.startSecAtSource ?? 0) - (b.startSecAtSource ?? 0));

    // [gags] @10:00-10:02 and [vomits] @10:04-10:06 merge into one warning;
    // [gags] @20:00-20:02 (nearly 10 minutes later) stays separate.
    expect(vomitingWarnings).toHaveLength(2);

    const merged = vomitingWarnings[0];
    // Start comes from the first cue (10:00), end from the second (10:06).
    expect(merged.startSecAtSource).toBeCloseTo(600);
    expect(merged.endSecAtSource).toBeCloseTo(606);

    const farAway = vomitingWarnings[1];
    expect(farAway.startSecAtSource).toBeCloseTo(1200);
    expect(farAway.endSecAtSource).toBeCloseTo(1202);
  });

  it("derives startFrac/endFrac as sec / sourceDurationSec, bounded to 0..1", () => {
    const content = loadSrt("vomit-bracket-high-confidence.srt");
    const durationSec = 2640;
    const warnings = scanSubtitles(content, { durationSec });

    expect(warnings).toHaveLength(1);
    const w = warnings[0];
    expect(w.sourceDurationSec).toBe(durationSec);
    expect(w.startFrac).toBeCloseTo((w.startSecAtSource ?? 0) / durationSec, 5);
    expect(w.endFrac).toBeCloseTo((w.endSecAtSource ?? 0) / durationSec, 5);

    for (const warning of warnings) {
      if (warning.startFrac !== undefined) {
        expect(warning.startFrac).toBeGreaterThanOrEqual(0);
        expect(warning.startFrac).toBeLessThanOrEqual(1);
      }
      if (warning.endFrac !== undefined) {
        expect(warning.endFrac).toBeGreaterThanOrEqual(0);
        expect(warning.endFrac).toBeLessThanOrEqual(1);
      }
    }
  });

  it("falls back to the final cue's end time when no durationSec is given", () => {
    const content = loadSrt("vomit-bracket-high-confidence.srt");
    const warnings = scanSubtitles(content);
    expect(warnings).toHaveLength(1);
    // Final cue in the fixture ends at 00:05:06,000 => 306s.
    expect(warnings[0].sourceDurationSec).toBeCloseTo(306);
  });

  it("parses WebVTT input and detects the bracket cue", () => {
    const content = loadVtt("sample.vtt");

    // parseSubtitles itself should produce cues from a WEBVTT file.
    const cues = parseSubtitles(content, "vtt");
    expect(cues.length).toBeGreaterThanOrEqual(2);
    expect(cues[0].startMs).toBe(5000);
    expect(cues[0].endMs).toBe(8000);
    expect(cues[0].text).toContain("gags");

    const warnings = scanSubtitles(content, { filename: "sample.vtt" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].category).toBe("vomiting");
    expect(warnings[0].startSecAtSource).toBeCloseTo(5);
    expect(warnings[0].endSecAtSource).toBeCloseTo(8);
  });

  it("produces gore/blood warnings at graded, lower confidence than confirmed vomiting cues", () => {
    const content = loadSrt("gore-graded.srt");
    const warnings = scanSubtitles(content, { filename: "gore-graded.srt" });

    expect(warnings.length).toBeGreaterThanOrEqual(2);
    for (const w of warnings) {
      expect(["gore", "blood"]).toContain(w.category);
      expect(w.provenance.confidence).toBeLessThan(0.8);
    }
  });

  it("every emitted warning validates against WarningSchema", () => {
    const fixtures = [
      "vomit-bracket-high-confidence.srt",
      "vomit-dialogue-false-positive.srt",
      "gore-graded.srt",
      "clustering.srt",
    ];

    for (const fixture of fixtures) {
      const content = loadSrt(fixture);
      const warnings = scanSubtitles(content, { filename: fixture });
      for (const warning of warnings) {
        expect(() => WarningSchema.parse(warning)).not.toThrow();
      }
    }

    const vttWarnings = scanSubtitles(loadVtt("sample.vtt"), {
      filename: "sample.vtt",
    });
    for (const warning of vttWarnings) {
      expect(() => WarningSchema.parse(warning)).not.toThrow();
    }
  });
});
