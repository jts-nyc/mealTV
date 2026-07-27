import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Show, Warning } from "../src/schema/catalog.js";

// All store/validate/build-index functions read `process.env.MEALTV_CATALOG_DIR`
// fresh on every call (no module-level caching), so we can point them at a
// throwaway temp directory per test instead of touching the real catalog/.
let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "mealtv-catalog-test-"));
  process.env.MEALTV_CATALOG_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.MEALTV_CATALOG_DIR;
  rmSync(tmpDir, { recursive: true, force: true });
});

function baseWarning(overrides: Partial<Warning> = {}): Warning {
  return {
    id: "w-1",
    category: "vomiting",
    severity: "high",
    channel: "both",
    scope: "episode",
    suppressed: false,
    provenance: {
      type: "subtitle-scan",
      confidence: 0.8,
      addedAt: "2026-02-01T00:00:00.000Z",
    },
    ...overrides,
  };
}

function baseShow(overrides: Partial<Show> = {}): Show {
  return {
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
            warnings: [baseWarning()],
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("catalog store", () => {
  it("round-trips a show through saveShow then loadShow", async () => {
    const { saveShow, loadShow, showPath } = await import("../src/catalog/store.js");
    const show = baseShow();

    saveShow(show);

    expect(existsSync(showPath("my-show"))).toBe(true);
    const loaded = loadShow("my-show");
    expect(loaded.slug).toBe("my-show");
    expect(loaded.title).toBe("My Show");
    expect(loaded.seasons).toHaveLength(1);
    expect(loaded.seasons[0].episodes).toHaveLength(1);
    expect(loaded.seasons[0].episodes[0].warnings).toHaveLength(1);
    expect(loaded.seasons[0].episodes[0].warnings[0].id).toBe("w-1");
    expect(loaded.seasons[0].episodes[0].warnings[0].category).toBe("vomiting");
  });

  it("saveShow rejects an invalid show and never writes a file", async () => {
    const { saveShow, showPath } = await import("../src/catalog/store.js");

    const invalid = baseShow({
      seasons: [
        {
          seasonNumber: 1,
          episodes: [
            {
              episodeNumber: 1,
              reviewedClear: false,
              // @ts-expect-error deliberately invalid category to test rejection
              warnings: [baseWarning({ category: "not-a-real-category" })],
            },
          ],
        },
      ],
    });

    expect(() => saveShow(invalid)).toThrow();
    expect(existsSync(showPath("my-show"))).toBe(false);
  });

  it("slugify handles spaces, punctuation, mixed case, and repeated separators", async () => {
    const { slugify } = await import("../src/catalog/store.js");

    expect(slugify("My Show!")).toBe("my-show");
    expect(slugify("  Leading and Trailing  ")).toBe("leading-and-trailing");
    expect(slugify("Multiple   Spaces")).toBe("multiple-spaces");
    expect(slugify("Punctuation: It's Wild!! (2026)")).toBe("punctuation-it-s-wild-2026");
    expect(slugify("UPPER-CASE---Hyphens")).toBe("upper-case-hyphens");
    expect(slugify("Already-slugged-title")).toBe("already-slugged-title");
  });

  it("upsertEpisodeWarnings appends new warnings and replaces one with an existing id", async () => {
    const { upsertEpisodeWarnings } = await import("../src/catalog/store.js");
    const show = baseShow();

    // Replace the existing "w-1" warning's severity, and add a brand new "w-2".
    upsertEpisodeWarnings(show, 1, 1, [
      baseWarning({ id: "w-1", severity: "low", note: "corrected on rescan" }),
      baseWarning({ id: "w-2", category: "gore" }),
    ]);

    const warnings = show.seasons[0].episodes[0].warnings;
    expect(warnings).toHaveLength(2);

    const w1 = warnings.find((w) => w.id === "w-1");
    expect(w1?.severity).toBe("low");
    expect(w1?.note).toBe("corrected on rescan");

    const w2 = warnings.find((w) => w.id === "w-2");
    expect(w2?.category).toBe("gore");
  });

  it("upsertEpisodeWarnings creates a missing season/episode by default", async () => {
    const { upsertEpisodeWarnings } = await import("../src/catalog/store.js");
    const show = baseShow({ seasons: [] });

    upsertEpisodeWarnings(show, 2, 5, [baseWarning({ id: "w-new" })]);

    const season = show.seasons.find((s) => s.seasonNumber === 2);
    expect(season).toBeDefined();
    const episode = season?.episodes.find((e) => e.episodeNumber === 5);
    expect(episode).toBeDefined();
    expect(episode?.warnings.map((w) => w.id)).toEqual(["w-new"]);
  });

  it("validateAll reports a corrupted show file as failing with the broken field path", async () => {
    const { getShowsDir } = await import("../src/catalog/store.js");
    const { validateAll } = await import("../src/catalog/validate.js");

    mkdirSync(getShowsDir(), { recursive: true });
    const corrupted = {
      slug: "broken-show",
      title: "Broken Show",
      seriesWarnings: [],
      seasons: [
        {
          seasonNumber: 1,
          episodes: [
            {
              episodeNumber: 1,
              reviewedClear: false,
              warnings: [
                {
                  id: "bad-1",
                  category: "not-a-real-category",
                  severity: "high",
                  channel: "video",
                  scope: "episode",
                  suppressed: false,
                  provenance: {
                    type: "curated",
                    confidence: 0.9,
                    addedAt: "2026-02-02T10:00:00.000Z",
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    writeFileSync(
      path.join(getShowsDir(), "broken-show.json"),
      JSON.stringify(corrupted, null, 2) + "\n",
      "utf-8",
    );

    const results = validateAll();
    expect(results).toHaveLength(1);
    expect(results[0].slug).toBe("broken-show");
    expect(results[0].ok).toBe(false);
    expect(results[0].errors?.some((e) => e.includes("seasons.0.episodes.0.warnings.0.category"))).toBe(
      true,
    );
  });

  it("build-index produces correct counts and hasVomiting handling of suppressed/series-scope warnings", async () => {
    const { saveShow } = await import("../src/catalog/store.js");
    const { buildIndex } = await import("../src/catalog/build-index.js");

    // Show A: vomiting warning exists but is suppressed -> hasVomiting must be false.
    saveShow(
      baseShow({
        slug: "show-a",
        title: "Show A",
        seasons: [
          {
            seasonNumber: 1,
            episodes: [
              {
                episodeNumber: 1,
                reviewedClear: false,
                warnings: [baseWarning({ id: "a-1", suppressed: true })],
              },
              {
                episodeNumber: 2,
                reviewedClear: true,
                warnings: [],
              },
            ],
          },
        ],
      }),
    );

    // Show B: vomiting only appears in seriesWarnings (not suppressed) -> hasVomiting true.
    saveShow(
      baseShow({
        slug: "show-b",
        title: "Show B",
        seriesWarnings: [baseWarning({ id: "b-series-1", scope: "series" })],
        seasons: [
          {
            seasonNumber: 1,
            episodes: [
              {
                episodeNumber: 1,
                reviewedClear: false,
                warnings: [baseWarning({ id: "b-1", category: "gore" })],
              },
            ],
          },
        ],
      }),
    );

    const entries = buildIndex();
    expect(entries).toHaveLength(2);

    const a = entries.find((e) => e.slug === "show-a")!;
    expect(a.seasonCount).toBe(1);
    expect(a.episodeCount).toBe(2);
    expect(a.warningCount).toBe(1);
    expect(a.reviewedClearCount).toBe(1);
    expect(a.hasVomiting).toBe(false);

    const b = entries.find((e) => e.slug === "show-b")!;
    expect(b.seasonCount).toBe(1);
    expect(b.episodeCount).toBe(1);
    expect(b.warningCount).toBe(2); // 1 series + 1 episode
    expect(b.hasVomiting).toBe(true);
  });
});
