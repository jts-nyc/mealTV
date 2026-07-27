/**
 * Fetches the catalog JSON at runtime. Browser-only (uses the `fetch`
 * global). All paths are relative so the app works whether it's served from
 * a domain root or a GitHub Pages project subpath — see
 * `scripts/build-web.ts` for how `catalog/` ends up alongside the HTML in
 * `web-dist/`.
 */

import type { Show } from "../../src/schema/catalog.js";
import type { CatalogIndexEntry } from "./types.js";

export async function loadCatalogIndex(): Promise<CatalogIndexEntry[]> {
  const res = await fetch("catalog/index.json");
  if (!res.ok) {
    throw new Error(`Failed to load catalog index: HTTP ${res.status}`);
  }
  return (await res.json()) as CatalogIndexEntry[];
}

export async function loadShowBySlug(slug: string): Promise<Show> {
  const res = await fetch(`catalog/shows/${encodeURIComponent(slug)}.json`);
  if (!res.ok) {
    throw new Error(`Failed to load show "${slug}": HTTP ${res.status}`);
  }
  return (await res.json()) as Show;
}
