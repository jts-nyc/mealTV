/**
 * On-disk catalog store: read/write layer over `catalog/shows/<slug>.json`.
 *
 * Node-only (uses `fs`/`path`). This module is NOT shared with the browser web app
 * (unlike `src/schema/catalog.ts`, which is pure zod and imported by both).
 *
 * -----------------------------------------------------------------------------
 * Repo-root resolution
 * -----------------------------------------------------------------------------
 * The CLI can be invoked from any working directory, so we can't just use
 * `process.cwd()`. Instead we resolve the catalog directory in this order:
 *
 *   1. `MEALTV_CATALOG_DIR` env var, if set — an absolute (or cwd-relative) path
 *      used AS the catalog directory directly, bypassing repo-root detection
 *      entirely. This is the mechanism tests use to point the store at a
 *      temporary directory (see test/catalog-store.test.ts).
 *   2. `MEALTV_REPO_ROOT` env var, if set — treated as the repo root; the
 *      catalog directory is `<MEALTV_REPO_ROOT>/catalog`.
 *   3. Otherwise, walk up the directory tree starting from this module's own
 *      location (`import.meta.url`) looking for a `package.json` whose `name`
 *      field is `"mealtv"`. That directory is the repo root.
 *
 * This makes the store robust to being invoked via the installed `mealtv` bin,
 * via `node dist/cli/index.js` from an arbitrary cwd, or from tests.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ShowSchema,
  type Episode,
  type Season,
  type Show,
  type Warning,
} from "../schema/catalog.js";

// ---------------------------------------------------------------------------
// Repo root / catalog dir resolution
// ---------------------------------------------------------------------------

/** How many parent directories to walk before giving up looking for package.json. */
const MAX_WALK_UP = 12;

function resolveRepoRoot(): string {
  if (process.env.MEALTV_REPO_ROOT) {
    return path.resolve(process.env.MEALTV_REPO_ROOT);
  }

  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < MAX_WALK_UP; i++) {
    const candidate = path.join(dir, "package.json");
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, "utf-8")) as {
          name?: string;
        };
        if (pkg.name === "mealtv") {
          return dir;
        }
      } catch {
        // Malformed package.json; keep walking up.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(
    'mealtv: could not locate the repo root (no package.json with name "mealtv" found by ' +
      "walking up from " +
      path.dirname(fileURLToPath(import.meta.url)) +
      "). Set MEALTV_REPO_ROOT or MEALTV_CATALOG_DIR to override.",
  );
}

/**
 * Absolute path to the repo root (honors `MEALTV_REPO_ROOT`, else walks up
 * looking for `package.json` with `"name": "mealtv"`). Exposed mainly for the
 * CLI (e.g. reading `package.json` for `--version`); most catalog code should
 * prefer {@link getCatalogDir}/{@link getShowsDir}, which also honor the more
 * direct `MEALTV_CATALOG_DIR` override used by tests.
 */
export function getRepoRoot(): string {
  return resolveRepoRoot();
}

/** Absolute path to the `catalog/` directory. See module docs for resolution order. */
export function getCatalogDir(): string {
  if (process.env.MEALTV_CATALOG_DIR) {
    return path.resolve(process.env.MEALTV_CATALOG_DIR);
  }
  return path.join(resolveRepoRoot(), "catalog");
}

/** Absolute path to the `catalog/shows/` directory. */
export function getShowsDir(): string {
  return path.join(getCatalogDir(), "shows");
}

/** Absolute path to `catalog/index.json`. */
export function getIndexPath(): string {
  return path.join(getCatalogDir(), "index.json");
}

/** Resolves to `catalog/shows/<slug>.json` for the given slug. */
export function showPath(slug: string): string {
  return path.join(getShowsDir(), `${slug}.json`);
}

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

/**
 * Derives a URL/filename-safe slug from a show title: lowercase, alphanumeric
 * and hyphens only, repeated separators collapsed, leading/trailing hyphens
 * trimmed.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritical marks left by NFKD
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------

/**
 * Loads and validates `catalog/shows/<slug>.json`.
 * Throws a clear error if the file is missing, isn't valid JSON, or fails
 * schema validation.
 */
export function loadShow(slug: string): Show {
  const file = showPath(slug);
  if (!existsSync(file)) {
    throw new Error(`mealtv: no show file found for slug "${slug}" (expected ${file})`);
  }

  let raw: string;
  try {
    raw = readFileSync(file, "utf-8");
  } catch (err) {
    throw new Error(`mealtv: failed to read ${file}: ${(err as Error).message}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`mealtv: ${file} is not valid JSON: ${(err as Error).message}`);
  }

  const result = ShowSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`mealtv: ${file} failed schema validation:\n${issues}`);
  }

  return result.data;
}

/** Like {@link loadShow}, but returns `undefined` instead of throwing. */
export function tryLoadShow(slug: string): Show | undefined {
  try {
    return loadShow(slug);
  } catch {
    return undefined;
  }
}

/**
 * Validates `show` against the schema and writes it to `catalog/shows/<slug>.json`
 * as pretty-printed JSON with a trailing newline, creating directories as needed.
 *
 * Validation happens BEFORE any filesystem write — an invalid show never touches
 * disk (an existing file for the same slug is left untouched, and no new file is
 * created).
 *
 * Determinism note: we serialize the result of `ShowSchema.parse(show)` rather
 * than `show` itself. Zod builds its parsed output object by assigning keys in
 * the order the schema declares them (see `ShowSchema` in `src/schema/catalog.ts`),
 * so re-parsing gives us stable, schema-defined key order "for free" without a
 * bespoke recursive key-sorter (which would otherwise fight the schema, since a
 * generic alphabetical sort would scramble the deliberately-ordered fields like
 * `startFrac`/`endFrac`). We additionally sort `seasons` by `seasonNumber` and
 * each season's `episodes` by `episodeNumber` for clean diffs when episodes/seasons
 * are created out of order via `upsertEpisodeWarnings`. We deliberately do NOT
 * reorder `warnings` arrays — their append order can carry meaning (e.g. rough
 * chronological order of when they were added), and `upsertEpisodeWarnings`
 * already replaces same-id entries in place rather than duplicating them.
 */
export function saveShow(show: Show): void {
  const validated = ShowSchema.parse(show); // throws on invalid input, nothing written yet

  const normalized: Show = {
    ...validated,
    seasons: [...validated.seasons]
      .sort((a, b) => a.seasonNumber - b.seasonNumber)
      .map((season) => ({
        ...season,
        episodes: [...season.episodes].sort(
          (a, b) => a.episodeNumber - b.episodeNumber,
        ),
      })),
  };

  const file = showPath(normalized.slug);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(normalized, null, 2) + "\n", "utf-8");
}

/** Lists slugs of all `*.json` files in `catalog/shows/` (does not validate them). */
export function listShowSlugs(): string[] {
  const dir = getShowsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .sort();
}

// ---------------------------------------------------------------------------
// Season / episode helpers
// ---------------------------------------------------------------------------

/**
 * Finds the season with `seasonNumber` in `show`, creating (and appending) an
 * empty one if it doesn't exist yet. Mutates and returns `show.seasons`'s entry
 * in place — the returned Season is a live reference into `show`.
 */
export function findOrCreateSeason(show: Show, seasonNumber: number): Season {
  let season = show.seasons.find((s) => s.seasonNumber === seasonNumber);
  if (!season) {
    season = { seasonNumber, episodes: [] };
    show.seasons.push(season);
  }
  return season;
}

/**
 * Finds the episode with `episodeNumber` within `season`, creating (and
 * appending) a bare one if it doesn't exist yet. Mutates and returns a live
 * reference into `season.episodes`.
 */
export function findOrCreateEpisode(
  season: Season,
  episodeNumber: number,
): Episode {
  let episode = season.episodes.find((e) => e.episodeNumber === episodeNumber);
  if (!episode) {
    episode = { episodeNumber, reviewedClear: false, warnings: [] };
    season.episodes.push(episode);
  }
  return episode;
}

export interface UpsertEpisodeWarningsOptions {
  /**
   * If `false`, throw instead of creating a missing season/episode.
   * Defaults to `true` (create as needed) since this is the common case for
   * pipeline stages (subtitle scan, curation) discovering new episodes.
   */
  createIfMissing?: boolean;
}

/**
 * Upserts `warnings` into `show`'s season `seasonNumber` / episode
 * `episodeNumber`, mutating `show` in place and returning it.
 *
 * Contract:
 *  - The season and episode are found or, by default, created (see
 *    `createIfMissing`).
 *  - Each incoming warning is matched against the episode's existing warnings
 *    by `id`. A match REPLACES the existing warning at its current array
 *    position (so re-running a scan with corrected data updates in place
 *    rather than duplicating). No match APPENDS the warning at the end.
 *  - This function does not call `saveShow` — callers decide when to persist.
 *
 * This is the single funnel later slices (subtitle scanning, curation,
 * self-log import) should use to add warnings, so behavior here is the
 * canonical "how do warnings get merged" contract.
 */
export function upsertEpisodeWarnings(
  show: Show,
  seasonNumber: number,
  episodeNumber: number,
  warnings: Warning[],
  opts: UpsertEpisodeWarningsOptions = {},
): Show {
  const { createIfMissing = true } = opts;

  let season = show.seasons.find((s) => s.seasonNumber === seasonNumber);
  if (!season) {
    if (!createIfMissing) {
      throw new Error(
        `mealtv: season ${seasonNumber} not found on show "${show.slug}" (createIfMissing is false)`,
      );
    }
    season = findOrCreateSeason(show, seasonNumber);
  }

  let episode = season.episodes.find((e) => e.episodeNumber === episodeNumber);
  if (!episode) {
    if (!createIfMissing) {
      throw new Error(
        `mealtv: episode ${episodeNumber} not found in season ${seasonNumber} of show "${show.slug}" (createIfMissing is false)`,
      );
    }
    episode = findOrCreateEpisode(season, episodeNumber);
  }

  for (const warning of warnings) {
    const existingIndex = episode.warnings.findIndex((w) => w.id === warning.id);
    if (existingIndex === -1) {
      episode.warnings.push(warning);
    } else {
      episode.warnings[existingIndex] = warning;
    }
  }

  return show;
}
