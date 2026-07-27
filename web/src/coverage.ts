/**
 * Coverage-honesty check for the Screening page: does this show have ANY
 * real signal behind it (a timestamped episode warning, or a human review),
 * or is it just... nothing? Pure module, no DOM.
 *
 * Context this exists for: shows with no automated source at all (e.g. some
 * C-dramas on iQiyi, older Korean films) will have an empty `seriesWarnings`
 * and no `reviewedClear` episodes — NOT because they're clean, but because
 * nobody and nothing has looked. Silence must never be read as safety.
 */

import type { Show } from "../../src/schema/catalog.js";

export function isPoorlyCovered(show: Show): boolean {
  const hasSeriesWarnings = show.seriesWarnings.some((w) => !w.suppressed);
  if (hasSeriesWarnings) return false;

  for (const season of show.seasons) {
    for (const episode of season.episodes) {
      if (episode.reviewedClear) return false;
      if (episode.warnings.some((w) => !w.suppressed)) return false;
    }
  }
  return true;
}
