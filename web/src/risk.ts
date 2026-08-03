/**
 * Home-screen at-a-glance risk indicator, derived from `catalog/index.json`
 * entries (see `CatalogIndexEntry` in `src/catalog/build-index.ts` / the
 * local mirror in `web/src/types.ts`). Pure module, no DOM.
 *
 * This is intentionally coarser than the full verdict logic in
 * `src/verdict/compute-verdict.ts` — the index has no per-episode detail, so
 * this can only ever be a rough "should I even open this show" signal, not a
 * verdict. The real verdict is computed per-episode on the show/screening
 * page via `computeVerdict`.
 */

import type { CatalogIndexEntry } from "./types.js";

export type RiskLevel = "blocked" | "flagged" | "clear-ish" | "unknown";

export interface RiskDisplay {
  level: RiskLevel;
  label: string;
}

/**
 * `hasVomiting` is the hard-blocker signal (see policy.ts HARD_BLOCK_CATEGORIES)
 * so it always wins regardless of other warning counts. Otherwise: any
 * warnings at all -> flagged; some reviewed-clear episodes and zero warnings
 * -> clear-ish; nothing known at all -> unknown (never presented as "safe").
 */
export function computeHomeRisk(entry: CatalogIndexEntry): RiskDisplay {
  if (entry.hasVomiting) {
    return { level: "blocked", label: "Vomiting reported" };
  }
  if (entry.warningCount > 0) {
    const n = entry.warningCount;
    return { level: "flagged", label: `${n} warning${n === 1 ? "" : "s"}` };
  }
  if (entry.reviewedClearCount > 0) {
    return { level: "clear-ish", label: "Reviewed, no flags" };
  }
  return { level: "unknown", label: "Not covered yet" };
}
