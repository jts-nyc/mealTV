/**
 * Builds `catalog/index.json`: a compact per-show summary the web app's home
 * screen / search UI loads instead of fetching every show file up front.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Show } from "../schema/catalog.js";
import { getCatalogDir, getIndexPath, listShowSlugs, tryLoadShow } from "./store.js";

export interface CatalogIndexEntry {
  slug: string;
  title: string;
  tmdbId?: number;
  seasonCount: number;
  episodeCount: number;
  /** Total warning count across seriesWarnings + all episodes, suppressed or not. */
  warningCount: number;
  /** Count of episodes with `reviewedClear: true`, cheap "how much is vetted" signal. */
  reviewedClearCount: number;
  /**
   * True if any NON-suppressed warning anywhere on the show (episode-scoped or
   * seriesWarnings) has category "vomiting" — the hard-blocker category this
   * whole app exists for.
   */
  hasVomiting: boolean;
}

function summarizeShow(show: Show): CatalogIndexEntry {
  let episodeCount = 0;
  let warningCount = show.seriesWarnings.length;
  let reviewedClearCount = 0;
  let hasVomiting = show.seriesWarnings.some(
    (w) => w.category === "vomiting" && !w.suppressed,
  );

  for (const season of show.seasons) {
    for (const episode of season.episodes) {
      episodeCount += 1;
      warningCount += episode.warnings.length;
      if (episode.reviewedClear) reviewedClearCount += 1;
      if (
        !hasVomiting &&
        episode.warnings.some((w) => w.category === "vomiting" && !w.suppressed)
      ) {
        hasVomiting = true;
      }
    }
  }

  return {
    slug: show.slug,
    title: show.title,
    tmdbId: show.tmdbId,
    seasonCount: show.seasons.length,
    episodeCount,
    warningCount,
    reviewedClearCount,
    hasVomiting,
  };
}

/**
 * Builds the index entries by loading every show in `catalog/shows/`.
 * Shows that fail schema validation are skipped (run `mealtv validate` to find
 * and fix them) rather than aborting the whole index build.
 */
export function buildIndex(): CatalogIndexEntry[] {
  const entries: CatalogIndexEntry[] = [];
  for (const slug of listShowSlugs()) {
    const show = tryLoadShow(slug);
    if (!show) continue;
    entries.push(summarizeShow(show));
  }
  entries.sort((a, b) => a.slug.localeCompare(b.slug));
  return entries;
}

/** Builds the index and writes it to `catalog/index.json` (pretty-printed, trailing newline). */
export function writeIndex(): { path: string; entries: CatalogIndexEntry[] } {
  const entries = buildIndex();
  const file = getIndexPath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(entries, null, 2) + "\n", "utf-8");
  return { path: file, entries };
}

export { getCatalogDir };
