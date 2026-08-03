import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/sources/http.js";
import { HttpError, HttpParseError, NetworkError } from "../src/sources/http.js";
import { WarningSchema } from "../src/schema/catalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "..", "fixtures", "http");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(fixturesDir, name), "utf-8"));
}

/** Builds a stub `fetch` that serves a fixed JSON body + status for every call. */
function jsonStub(body: unknown, status = 200): FetchLike {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
}

/** Builds a stub `fetch` that returns a fixed non-JSON body (for parse-error tests). */
function rawStub(body: string, status = 200): FetchLike {
  return async () => new Response(body, { status });
}

/** Builds a stub `fetch` that always throws (for network-failure tests). */
function throwingStub(message: string): FetchLike {
  return async () => {
    throw new Error(message);
  };
}

describe("sources/tmdb", () => {
  it("searchTv normalizes results from the TMDB fixture", async () => {
    const { searchTv } = await import("../src/sources/tmdb.js");
    const fixture = loadFixture("tmdb-search-tv.json");

    const results = await searchTv("The Gravy Train", {
      apiKey: "fake-tmdb-key",
      fetchImpl: jsonStub(fixture),
    });

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      tmdbId: 999901,
      name: "The Gravy Train",
      firstAirDate: "2019-04-12",
      overview: expect.stringContaining("fictional"),
    });
  });

  it("getShow normalizes seasons from the TMDB fixture", async () => {
    const { getShow } = await import("../src/sources/tmdb.js");
    const fixture = loadFixture("tmdb-show.json");

    const show = await getShow(999901, {
      apiKey: "fake-tmdb-key",
      fetchImpl: jsonStub(fixture),
    });

    expect(show.tmdbId).toBe(999901);
    expect(show.name).toBe("The Gravy Train");
    expect(show.seasons).toEqual([
      { seasonNumber: 1, episodeCount: 3 },
      { seasonNumber: 2, episodeCount: 2 },
    ]);
  });

  it("getSeason converts runtime minutes -> seconds, and leaves null runtime as undefined (never 0)", async () => {
    const { getSeason } = await import("../src/sources/tmdb.js");
    const fixture = loadFixture("tmdb-season.json");

    const episodes = await getSeason(999901, 1, {
      apiKey: "fake-tmdb-key",
      fetchImpl: jsonStub(fixture),
    });

    expect(episodes).toHaveLength(3);

    const ep1 = episodes.find((e) => e.episodeNumber === 1)!;
    expect(ep1.runtimeSec).toBe(42 * 60);
    expect(ep1.tmdbId).toBe(5551001);
    expect(ep1.name).toBe("Pilot");

    const ep2 = episodes.find((e) => e.episodeNumber === 2)!;
    expect(ep2.runtimeSec).toBeUndefined();
    expect("runtimeSec" in ep2 && ep2.runtimeSec !== 0).toBe(true);

    const ep3 = episodes.find((e) => e.episodeNumber === 3)!;
    expect(ep3.runtimeSec).toBe(45 * 60);
  });

  it("throws a clear error when TMDB_API_KEY is missing and no apiKey option is given", async () => {
    const { searchTv } = await import("../src/sources/tmdb.js");
    delete process.env.TMDB_API_KEY;

    await expect(
      searchTv("anything", { fetchImpl: jsonStub({ results: [] }) }),
    ).rejects.toThrow(/TMDB_API_KEY/);
  });

  it("surfaces a 401 as a typed HttpError carrying status + body snippet", async () => {
    const { searchTv } = await import("../src/sources/tmdb.js");

    await expect(
      searchTv("anything", {
        apiKey: "bad-key",
        fetchImpl: jsonStub({ status_message: "Invalid API key" }, 401),
      }),
    ).rejects.toMatchObject({
      name: "HttpError",
      status: 401,
    });
  });

  it("surfaces a 404 as a typed HttpError", async () => {
    const { getShow } = await import("../src/sources/tmdb.js");

    let caught: unknown;
    try {
      await getShow(404404, {
        apiKey: "fake-tmdb-key",
        fetchImpl: jsonStub({ status_message: "The resource you requested could not be found." }, 404),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).status).toBe(404);
    expect((caught as HttpError).bodySnippet).toContain("could not be found");
  });

  it("surfaces malformed JSON (2xx but unparsable body) as HttpParseError", async () => {
    const { searchTv } = await import("../src/sources/tmdb.js");

    let caught: unknown;
    try {
      await searchTv("anything", {
        apiKey: "fake-tmdb-key",
        fetchImpl: rawStub("<html>not json</html>", 200),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpParseError);
    expect((caught as HttpParseError).status).toBe(200);
  });

  it("surfaces a network failure as a typed NetworkError", async () => {
    const { searchTv } = await import("../src/sources/tmdb.js");

    let caught: unknown;
    try {
      await searchTv("anything", {
        apiKey: "fake-tmdb-key",
        fetchImpl: throwingStub("getaddrinfo ENOTFOUND api.themoviedb.org"),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NetworkError);
    expect((caught as NetworkError).message).toContain("ENOTFOUND");
  });
});

describe("sources/dtdd", () => {
  it("getMedia parses the topicItemStats fixture verbatim", async () => {
    const { getMedia } = await import("../src/sources/dtdd.js");
    const fixture = loadFixture("dtdd-media.json");

    const media = await getMedia(42001, {
      apiKey: "fake-dtdd-key",
      fetchImpl: jsonStub(fixture),
    });

    expect(media.id).toBe(42001);
    expect(media.topicItemStats).toHaveLength(5);
  });

  it("mapTopicNameToCategory maps known DTDD topic names and skips unmapped ones", async () => {
    const { mapTopicNameToCategory } = await import("../src/sources/dtdd.js");

    expect(mapTopicNameToCategory("Vomit")).toBe("vomiting");
    expect(mapTopicNameToCategory("Someone throws up")).toBe("vomiting");
    expect(mapTopicNameToCategory("Emetophobia trigger")).toBe("vomiting");
    expect(mapTopicNameToCategory("Graphic Violence / Gore")).toBe("gore");
    expect(mapTopicNameToCategory("Blood shown")).toBe("blood");
    expect(mapTopicNameToCategory("Needles / Medical Content")).toBe("needles_medical");
    expect(mapTopicNameToCategory("Insects / spiders")).toBe("bugs_insects");
    expect(mapTopicNameToCategory("Does a Dog Die")).toBeUndefined();
    expect(mapTopicNameToCategory("Someone gets a papercut")).toBeUndefined();
  });

  it("getMediaWarnings emits only mapped topics with yesSum > 0, all series-scope and schema-valid", async () => {
    const { getMediaWarnings } = await import("../src/sources/dtdd.js");
    const fixture = loadFixture("dtdd-media.json");

    const warnings = await getMediaWarnings(42001, {
      apiKey: "fake-dtdd-key",
      fetchImpl: jsonStub(fixture),
    });

    // Fixture has 5 topics: Vomit (mapped, yes>0), Gore (mapped, yes>0),
    // Needles (mapped, yes>0), Does a Dog Die (UNMAPPED, yes>0 -> must be
    // skipped), Emetophobia Trigger (mapped, yesSum=0 -> must be skipped).
    expect(warnings).toHaveLength(3);

    const categories = warnings.map((w) => w.category).sort();
    expect(categories).toEqual(["gore", "needles_medical", "vomiting"].sort());

    // The unmapped "Does a Dog Die" topic must never appear, and must NOT be
    // coerced into "other".
    expect(warnings.some((w) => w.provenance.detail === "Does a Dog Die")).toBe(false);
    expect(warnings.some((w) => w.category === "other")).toBe(false);

    for (const w of warnings) {
      expect(w.scope).toBe("series");
      expect(w.provenance.type).toBe("dtdd");
      const result = WarningSchema.safeParse(w);
      expect(result.success).toBe(true);
    }

    const vomitWarning = warnings.find((w) => w.category === "vomiting")!;
    expect(vomitWarning.provenance.confidence).toBeCloseTo(18 / 20);
    expect(vomitWarning.provenance.sourceRef).toBe("1");

    const goreWarning = warnings.find((w) => w.category === "gore")!;
    expect(goreWarning.provenance.confidence).toBeCloseTo(9 / 15);
  });

  it("guards divide-by-zero when yesSum and noSum are both 0 (never emitted anyway since yesSum > 0 is required)", async () => {
    const { getMediaWarnings } = await import("../src/sources/dtdd.js");

    const warnings = await getMediaWarnings(1, {
      apiKey: "fake-dtdd-key",
      fetchImpl: jsonStub({
        id: 1,
        name: "Zero Votes Show",
        topicItemStats: [
          { topicId: 9, topicName: "Vomit", yesSum: 0, noSum: 0, numComments: 0 },
        ],
      }),
    });

    expect(warnings).toHaveLength(0);
  });

  it("throws a clear error when DTDD_API_KEY is missing", async () => {
    const { getMedia } = await import("../src/sources/dtdd.js");
    delete process.env.DTDD_API_KEY;

    await expect(
      getMedia(1, { fetchImpl: jsonStub({ id: 1, topicItemStats: [] }) }),
    ).rejects.toThrow(/DTDD_API_KEY/);
  });

  it("surfaces a 401 from DTDD as a typed HttpError", async () => {
    const { getMedia } = await import("../src/sources/dtdd.js");

    await expect(
      getMedia(1, {
        apiKey: "bad-key",
        fetchImpl: jsonStub({ error: "unauthorized" }, 401),
      }),
    ).rejects.toMatchObject({ name: "HttpError", status: 401 });
  });

  it("surfaces a 404 from DTDD as a typed HttpError", async () => {
    const { getMedia } = await import("../src/sources/dtdd.js");

    await expect(
      getMedia(999999999, {
        apiKey: "fake-dtdd-key",
        fetchImpl: jsonStub({ error: "not found" }, 404),
      }),
    ).rejects.toMatchObject({ name: "HttpError", status: 404 });
  });

  it("surfaces malformed JSON from DTDD as HttpParseError", async () => {
    const { getMedia } = await import("../src/sources/dtdd.js");

    await expect(
      getMedia(1, {
        apiKey: "fake-dtdd-key",
        fetchImpl: rawStub("not json at all", 200),
      }),
    ).rejects.toBeInstanceOf(HttpParseError);
  });
});
