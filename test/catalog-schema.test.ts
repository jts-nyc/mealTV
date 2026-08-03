import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseShow, safeParseShow } from "../src/schema/catalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "..", "fixtures", "catalog");

function loadFixture(name: string): unknown {
  const raw = readFileSync(path.join(fixturesDir, name), "utf-8");
  return JSON.parse(raw);
}

describe("catalog schema", () => {
  it("parses a valid show fixture and preserves its shape", () => {
    const data = loadFixture("example-show.json");
    const result = parseShow(data);

    expect(result.slug).toBe("test-show");
    expect(result.title).toBe("Test Show");
    expect(result.seasons).toHaveLength(1);
    expect(result.seasons[0].episodes).toHaveLength(2);
    expect(result.seasons[0].episodes[0].warnings).toHaveLength(2);
    expect(result.seasons[0].episodes[1].reviewedClear).toBe(true);
    expect(result.seasons[0].episodes[1].warnings).toHaveLength(0);

    const vomitWarning = result.seasons[0].episodes[0].warnings.find(
      (w) => w.category === "vomiting",
    );
    expect(vomitWarning).toBeDefined();
    expect(vomitWarning?.scope).toBe("episode");
    expect(vomitWarning?.startFrac).toBeCloseTo(1610 / 2640);
    expect(vomitWarning?.endFrac).toBeCloseTo(1640 / 2640);

    const goreWarning = result.seasons[0].episodes[0].warnings.find(
      (w) => w.category === "gore",
    );
    expect(goreWarning?.severity).toBe("high");

    expect(result.seriesWarnings).toHaveLength(1);
    expect(result.seriesWarnings[0].scope).toBe("series");
    expect(result.seriesWarnings[0].provenance.type).toBe("dtdd");
  });

  it("throws via parseShow on the broken fixture", () => {
    const data = loadFixture("example-show-broken.json");
    expect(() => parseShow(data)).toThrow();
  });

  it("safeParseShow reports success:false and flags the exact broken fields", () => {
    const data = loadFixture("example-show-broken.json");
    const result = safeParseShow(data);

    expect(result.success).toBe(false);
    if (result.success) return; // narrow for TS

    const issuePaths = result.error.issues.map((issue) => issue.path.join("."));

    // Bad enum value for category.
    expect(issuePaths).toContain(
      "seasons.0.episodes.0.warnings.0.category",
    );
    // startFrac out of the 0-1 range.
    expect(issuePaths).toContain(
      "seasons.0.episodes.0.warnings.0.startFrac",
    );
  });
});
