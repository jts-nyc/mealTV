import { describe, expect, it } from "vitest";
import { computeHomeRisk } from "../web/src/risk.js";
import type { CatalogIndexEntry } from "../web/src/types.js";

function makeEntry(overrides: Partial<CatalogIndexEntry> = {}): CatalogIndexEntry {
  return {
    slug: "test-show",
    title: "Test Show",
    seasonCount: 1,
    episodeCount: 1,
    warningCount: 0,
    reviewedClearCount: 0,
    hasVomiting: false,
    ...overrides,
  };
}

describe("computeHomeRisk", () => {
  it("flags vomiting as the top-priority signal regardless of other counts", () => {
    const result = computeHomeRisk(makeEntry({ hasVomiting: true, reviewedClearCount: 5, warningCount: 0 }));
    expect(result.level).toBe("blocked");
  });

  it("shows a warning count when there are non-vomiting warnings", () => {
    const result = computeHomeRisk(makeEntry({ warningCount: 3 }));
    expect(result.level).toBe("flagged");
    expect(result.label).toContain("3 warning");
  });

  it("singularizes the warning count label", () => {
    const result = computeHomeRisk(makeEntry({ warningCount: 1 }));
    expect(result.label).toBe("1 warning");
  });

  it("is clear-ish when reviewed and free of warnings", () => {
    const result = computeHomeRisk(makeEntry({ reviewedClearCount: 2 }));
    expect(result.level).toBe("clear-ish");
  });

  it("is unknown (never 'safe') when there's no signal at all", () => {
    const result = computeHomeRisk(makeEntry());
    expect(result.level).toBe("unknown");
    expect(result.level).not.toBe("clear-ish");
  });
});
