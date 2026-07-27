import { describe, expect, it } from "vitest";
import type { Show, Warning } from "../src/schema/catalog.js";
import { isPoorlyCovered } from "../web/src/coverage.js";

function makeWarning(overrides: Partial<Warning> = {}): Warning {
  return {
    id: "w1",
    category: "gore",
    severity: "medium",
    channel: "video",
    scope: "episode",
    suppressed: false,
    provenance: { type: "curated", confidence: 0.9, addedAt: "2026-01-01T00:00:00.000Z" },
    ...overrides,
  };
}

function makeShow(overrides: Partial<Show> = {}): Show {
  return {
    slug: "test-show",
    title: "Test Show",
    seriesWarnings: [],
    seasons: [{ seasonNumber: 1, episodes: [{ episodeNumber: 1, reviewedClear: false, warnings: [] }] }],
    ...overrides,
  };
}

describe("isPoorlyCovered", () => {
  it("is true for a show with no series warnings, no episode warnings, no reviews", () => {
    expect(isPoorlyCovered(makeShow())).toBe(true);
  });

  it("is false when the show has a series-level warning", () => {
    const show = makeShow({ seriesWarnings: [makeWarning({ scope: "series" })] });
    expect(isPoorlyCovered(show)).toBe(false);
  });

  it("is false when any episode has been reviewed clear", () => {
    const show = makeShow({
      seasons: [{ seasonNumber: 1, episodes: [{ episodeNumber: 1, reviewedClear: true, warnings: [] }] }],
    });
    expect(isPoorlyCovered(show)).toBe(false);
  });

  it("is false when any episode has a non-suppressed warning", () => {
    const show = makeShow({
      seasons: [
        { seasonNumber: 1, episodes: [{ episodeNumber: 1, reviewedClear: false, warnings: [makeWarning()] }] },
      ],
    });
    expect(isPoorlyCovered(show)).toBe(false);
  });

  it("ignores suppressed warnings and treats the show as still poorly covered", () => {
    const show = makeShow({
      seriesWarnings: [makeWarning({ scope: "series", suppressed: true })],
      seasons: [
        {
          seasonNumber: 1,
          episodes: [
            { episodeNumber: 1, reviewedClear: false, warnings: [makeWarning({ suppressed: true })] },
          ],
        },
      ],
    });
    expect(isPoorlyCovered(show)).toBe(true);
  });
});
