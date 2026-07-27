import { describe, expect, it } from "vitest";
import type { Episode, Warning } from "../src/schema/catalog.js";
import { computeVerdict, effectiveEndSec, effectiveStartSec } from "../src/verdict/compute-verdict.js";

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function makeWarning(overrides: Partial<Warning> & Pick<Warning, "category" | "scope">): Warning {
  return {
    id: nextId(overrides.category),
    severity: "medium",
    channel: "video",
    suppressed: false,
    provenance: {
      type: "curated",
      confidence: 0.9,
      addedAt: "2026-01-01T00:00:00.000Z",
    },
    ...overrides,
  };
}

function makeEpisode(overrides: Partial<Episode> = {}): Episode {
  return {
    episodeNumber: 1,
    reviewedClear: false,
    warnings: [],
    ...overrides,
  };
}

describe("computeVerdict", () => {
  it("1. vomiting warning at high confidence -> tier block", () => {
    const episode = makeEpisode({
      warnings: [
        makeWarning({
          category: "vomiting",
          scope: "episode",
          severity: "high",
          provenance: { type: "curated", confidence: 0.95, addedAt: "2026-01-01T00:00:00.000Z" },
        }),
      ],
    });
    const verdict = computeVerdict(episode);
    expect(verdict.tier).toBe("block");
    expect(verdict.isUnknown).toBe(false);
    expect(verdict.blockingWarnings).toHaveLength(1);
  });

  it("2. vomiting warning at low confidence (dialogue mention) -> STILL tier block, copy says unconfirmed", () => {
    const episode = makeEpisode({
      warnings: [
        makeWarning({
          category: "vomiting",
          scope: "episode",
          severity: "low",
          note: "Character says 'I'm gonna throw up' as a joke.",
          provenance: {
            type: "subtitle-scan",
            confidence: 0.25,
            addedAt: "2026-01-01T00:00:00.000Z",
          },
        }),
      ],
    });
    const verdict = computeVerdict(episode);
    expect(verdict.tier).toBe("block");
    expect(verdict.detail.toLowerCase()).toContain("unconfirmed");
    expect(verdict.blockingWarnings).toHaveLength(1);
  });

  it("3. only high-severity gore -> tier caution, NOT block", () => {
    const episode = makeEpisode({
      warnings: [
        makeWarning({
          category: "gore",
          scope: "episode",
          severity: "high",
          provenance: { type: "curated", confidence: 0.95, addedAt: "2026-01-01T00:00:00.000Z" },
        }),
      ],
    });
    const verdict = computeVerdict(episode);
    expect(verdict.tier).toBe("caution");
    expect(verdict.tier).not.toBe("block");
    expect(verdict.blockingWarnings).toHaveLength(0);
    expect(verdict.cautionWarnings).toHaveLength(1);
  });

  it("4. zero warnings, reviewedClear false -> tier no-data, isUnknown true, copy has no safe/clear/clean", () => {
    const episode = makeEpisode({ reviewedClear: false, warnings: [] });
    const verdict = computeVerdict(episode);
    expect(verdict.tier).toBe("no-data");
    expect(verdict.isUnknown).toBe(true);

    const combinedCopy = `${verdict.headline} ${verdict.detail}`.toLowerCase();
    expect(combinedCopy).not.toContain("safe");
    expect(combinedCopy).not.toContain("clear");
    expect(combinedCopy).not.toContain("clean");
  });

  it("5. zero warnings, reviewedClear true -> tier reviewed-clear", () => {
    const episode = makeEpisode({ reviewedClear: true, warnings: [] });
    const verdict = computeVerdict(episode);
    expect(verdict.tier).toBe("reviewed-clear");
    expect(verdict.isUnknown).toBe(false);
  });

  it("6. a suppressed vomiting warning as the only warning -> must NOT block", () => {
    const episode = makeEpisode({
      reviewedClear: false,
      warnings: [
        makeWarning({
          category: "vomiting",
          scope: "episode",
          severity: "high",
          suppressed: true,
          provenance: { type: "subtitle-scan", confidence: 0.9, addedAt: "2026-01-01T00:00:00.000Z" },
        }),
      ],
    });
    const verdict = computeVerdict(episode);
    expect(verdict.tier).not.toBe("block");
    expect(verdict.blockingWarnings).toHaveLength(0);
  });

  it("7. mixed provenance (curated + subtitle-scan + dtdd series) all preserved distinctly", () => {
    const curated = makeWarning({
      category: "gore",
      scope: "episode",
      severity: "high",
      provenance: { type: "curated", confidence: 0.95, addedAt: "2026-01-01T00:00:00.000Z" },
    });
    const subtitleScan = makeWarning({
      category: "blood",
      scope: "episode",
      severity: "medium",
      provenance: { type: "subtitle-scan", confidence: 0.6, addedAt: "2026-01-01T00:00:00.000Z" },
    });
    const dtddSeries = makeWarning({
      category: "gore",
      scope: "series",
      severity: "medium",
      provenance: { type: "dtdd", confidence: 0.6, addedAt: "2026-01-01T00:00:00.000Z" },
    });

    const episode = makeEpisode({ warnings: [curated, subtitleScan] });
    const verdict = computeVerdict(episode, [dtddSeries]);

    expect(verdict.tier).toBe("caution");
    expect(verdict.cautionWarnings).toHaveLength(3);
    expect(verdict.cautionWarnings).toEqual(
      expect.arrayContaining([curated, subtitleScan, dtddSeries]),
    );
    expect(verdict.seriesLevelWarnings).toEqual([dtddSeries]);
  });

  it("8. effectiveStartSec math: startFrac + runtimeSec, fallback to startSecAtSource, else undefined", () => {
    const withFrac = makeWarning({ category: "gore", scope: "episode", startFrac: 0.5 });
    expect(effectiveStartSec(withFrac, 1800)).toBe(900);

    const fallback = makeWarning({ category: "gore", scope: "episode", startSecAtSource: 120 });
    expect(effectiveStartSec(fallback, undefined)).toBe(120);
    // Also falls back when startFrac is present but runtimeSec is missing.
    const fracNoRuntime = makeWarning({
      category: "gore",
      scope: "episode",
      startFrac: 0.5,
      startSecAtSource: 300,
    });
    expect(effectiveStartSec(fracNoRuntime, undefined)).toBe(300);

    const neither = makeWarning({ category: "gore", scope: "episode" });
    expect(effectiveStartSec(neither, 1800)).toBeUndefined();

    // effectiveEndSec counterpart.
    const withEndFrac = makeWarning({ category: "gore", scope: "episode", endFrac: 0.25 });
    expect(effectiveEndSec(withEndFrac, 2000)).toBe(500);
    const endNeither = makeWarning({ category: "gore", scope: "episode" });
    expect(effectiveEndSec(endNeither, 2000)).toBeUndefined();
  });

  it("9. hasTimedWarnings is false when the only evidence is a series-scope warning", () => {
    const seriesWarning = makeWarning({
      category: "gore",
      scope: "series",
      provenance: { type: "dtdd", confidence: 0.6, addedAt: "2026-01-01T00:00:00.000Z" },
      // No startFrac/startSecAtSource -- typical for crowdsourced series reports.
    });
    const episode = makeEpisode({ warnings: [] });
    const verdict = computeVerdict(episode, [seriesWarning]);

    expect(verdict.hasTimedWarnings).toBe(false);
    expect(verdict.seriesLevelWarnings).toHaveLength(1);
  });
});
