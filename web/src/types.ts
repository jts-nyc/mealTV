/**
 * Small browser-side type mirrors that intentionally do NOT import from
 * Node-only modules (e.g. `src/catalog/build-index.ts`, which touches
 * `node:fs`). Keeping a tiny duplicated shape here means the web bundle never
 * risks pulling Node built-ins into the browser bundle by accident.
 *
 * This must stay in sync with `CatalogIndexEntry` in
 * `src/catalog/build-index.ts` (that file's doc comment says why the shape
 * looks the way it does).
 */
export interface CatalogIndexEntry {
  slug: string;
  title: string;
  tmdbId?: number;
  seasonCount: number;
  episodeCount: number;
  warningCount: number;
  reviewedClearCount: number;
  hasVomiting: boolean;
}
