/**
 * Turns an episode's warnings (plus optional show-level series/season
 * warnings) into a single pre-play verdict.
 *
 * Pure module: no `fs`, no `node:*` imports, no side effects — this is
 * imported by both the Node CLI and the browser web app (bundled via
 * esbuild), so it must run unmodified in a browser.
 *
 * DESIGN NOTE — how series/season-level warnings affect the tier:
 * `scope: "series"` / `"season"` warnings (typically crowdsourced from Does
 * The Dog Die, with no timestamp) are a statement about the SHOW, not about
 * any one episode. They're folded into the same caution evaluation as
 * episode-scoped warnings, category-for-category — a series-level gore
 * report still produces "caution" the same as an episode-level one would,
 * because caution is "your call" anyway. For the HARD_BLOCK category
 * (vomiting) they still produce tier "block" by default (zero tolerance
 * doesn't get diluted just because nobody pinned the exact episode yet) —
 * *unless* a human has explicitly reviewed this specific episode.
 *
 * `episode.reviewedClear === true` means a person watched THIS episode and
 * confirmed it's fine. That's better evidence about this episode than a
 * crowd report about the show in general, so it overrides series/season-
 * scope blocking evidence: if there are no non-suppressed EPISODE-scope
 * warnings, the verdict is "reviewed-clear" even when series/season-scope
 * warnings exist. Those series-level warnings are still returned in
 * `seriesLevelWarnings` (so the UI can show them as "this show has reports
 * elsewhere" context) and the reviewed-clear copy names them rather than
 * pretending the show is spotless.
 *
 * An episode-scope hard-block warning, though, still wins over
 * `reviewedClear` — see `computeVerdict` for why that contradiction resolves
 * to "block" rather than being silently discarded. And review status has no
 * effect on the caution tier at all: a caution-category warning (episode- or
 * series-scoped) still produces "caution" regardless of `reviewedClear`,
 * since caution was never a hard gate to begin with.
 */

import type { Category, Episode, Severity, Warning } from "../schema/catalog.js";
import {
  CAUTION_CATEGORIES,
  HARD_BLOCK_CATEGORIES,
  SEVERITY_RANK,
  UNCONFIRMED_CONFIDENCE_THRESHOLD,
} from "./policy.js";

export type VerdictTier = "block" | "caution" | "no-data" | "reviewed-clear";

export type Verdict = {
  tier: VerdictTier;
  /** Short user-facing line — read one-handed at a dinner table. */
  headline: string;
  /** One sentence of honest explanation. */
  detail: string;
  /**
   * TRUE only for tier "no-data". An explicit flag (in addition to the tier
   * string) so a UI can never accidentally render absence-of-data as safety
   * by mis-handling the tier value.
   */
  isUnknown: boolean;
  blockingWarnings: Warning[];
  cautionWarnings: Warning[];
  /** scope "series" or "season" warnings — no timestamp, can't drive a timer. */
  seriesLevelWarnings: Warning[];
  /** Whether any non-suppressed episode-scope warning has a usable start position. */
  hasTimedWarnings: boolean;
};

function isHardBlockCategory(category: Category): boolean {
  return (HARD_BLOCK_CATEGORIES as readonly string[]).includes(category);
}

function isCautionCategory(category: Category): boolean {
  return (CAUTION_CATEGORIES as readonly string[]).includes(category);
}

function isSeriesLevel(w: Warning): boolean {
  return w.scope === "series" || w.scope === "season";
}

function categoryLabel(category: Category): string {
  return category.replace(/_/g, " ");
}

function worstSeverity(warnings: Warning[]): Severity {
  return warnings.reduce<Severity>(
    (worst, w) => (SEVERITY_RANK[w.severity] > SEVERITY_RANK[worst] ? w.severity : worst),
    "low",
  );
}

function buildBlockCopy(blockingWarnings: Warning[]): { headline: string; detail: string } {
  const categories = [...new Set(blockingWarnings.map((w) => categoryLabel(w.category)))];
  const categoryText = categories.join(", ");
  const headline = `Blocked: ${categoryText}`;

  const episodeScoped = blockingWarnings.filter((w) => w.scope === "episode");
  const maxConfidence = Math.max(...blockingWarnings.map((w) => w.provenance.confidence));

  if (episodeScoped.length === 0) {
    // Only series/season-level evidence — we know it happens somewhere in
    // the show, not where in *this* episode.
    return {
      headline,
      detail: `Viewers have reported ${categoryText} somewhere in this show. The exact scene in this episode isn't known, so we're blocking to be safe.`,
    };
  }

  if (maxConfidence < UNCONFIRMED_CONFIDENCE_THRESHOLD) {
    return {
      headline,
      detail: `This episode has an unconfirmed mention of ${categoryText} (a low-confidence detection, not a verified scene) — we're blocking it anyway rather than risk missing a real one.`,
    };
  }

  return {
    headline,
    detail: `This episode contains ${categoryText}. Skip it, or be ready to look away.`,
  };
}

function buildCautionCopy(cautionWarnings: Warning[]): { headline: string; detail: string } {
  const categories = [...new Set(cautionWarnings.map((w) => categoryLabel(w.category)))];
  const categoryText = categories.join(", ");
  const worst = worstSeverity(cautionWarnings);
  const headline = `Caution: ${categoryText}`;
  const detail = `Flagged for ${categoryText} (worst severity: ${worst}). Not a hard block — it's your call whether it's a dinner problem.`;
  return { headline, detail };
}

function buildReviewedClearCopy(seriesLevelWarnings: Warning[]): { headline: string; detail: string } {
  const headline = "Reviewed clear";

  if (seriesLevelWarnings.length === 0) {
    return {
      headline,
      detail: "A person watched this episode and confirmed there's nothing on your warning list.",
    };
  }

  // Honest, not spotless: a human cleared THIS episode, but the show still
  // carries crowd reports elsewhere. Say both things rather than letting the
  // "clear" headline imply the show has no reports at all.
  const categories = [...new Set(seriesLevelWarnings.map((w) => categoryLabel(w.category)))];
  const categoryText = categories.join(", ");
  return {
    headline,
    detail: `A person watched this specific episode and confirmed it's fine. The show does have other viewer reports (${categoryText}) elsewhere — just not in this episode.`,
  };
}

/**
 * Compute the pre-play verdict for an episode.
 *
 * @param episode The episode to evaluate.
 * @param seriesWarnings The show's series/season-level warnings (e.g.
 *   `Show.seriesWarnings`), if available. Optional because a caller may not
 *   have the parent Show loaded.
 */
export function computeVerdict(episode: Episode, seriesWarnings: Warning[] = []): Verdict {
  const episodeWarnings = episode.warnings.filter((w) => !w.suppressed);
  const seriesInput = seriesWarnings.filter((w) => !w.suppressed);
  const allWarnings = [...episodeWarnings, ...seriesInput];

  const allBlockingWarnings = allWarnings.filter((w) => isHardBlockCategory(w.category));
  const episodeBlockingWarnings = episodeWarnings.filter((w) => isHardBlockCategory(w.category));
  const cautionWarnings = allWarnings.filter((w) => isCautionCategory(w.category));
  const seriesLevelWarnings = allWarnings.filter(isSeriesLevel);

  const hasTimedWarnings = episodeWarnings.some(
    (w) => w.scope === "episode" && (w.startFrac !== undefined || w.startSecAtSource !== undefined),
  );

  // A human review is evidence about THIS episode; a series/season-scope
  // hard-block warning is evidence about the show in general. When the
  // episode has been reviewedClear, only an episode-scope hard-block warning
  // counts as blocking here — that would be a direct contradiction of the
  // review (someone logged a specific problem in the very episode a human
  // signed off on), and we resolve that contradiction by blocking rather
  // than trusting either side blindly. A series-level warning alone is not a
  // contradiction — it's just outstanding context, surfaced separately via
  // `seriesLevelWarnings` — so it does not override the review.
  const blockingWarnings = episode.reviewedClear ? episodeBlockingWarnings : allBlockingWarnings;

  const shared = { blockingWarnings, cautionWarnings, seriesLevelWarnings, hasTimedWarnings };

  if (blockingWarnings.length > 0) {
    const { headline, detail } = buildBlockCopy(blockingWarnings);
    return { tier: "block", headline, detail, isUnknown: false, ...shared };
  }

  if (cautionWarnings.length > 0) {
    const { headline, detail } = buildCautionCopy(cautionWarnings);
    return { tier: "caution", headline, detail, isUnknown: false, ...shared };
  }

  if (episode.reviewedClear) {
    const { headline, detail } = buildReviewedClearCopy(seriesLevelWarnings);
    return { tier: "reviewed-clear", headline, detail, isUnknown: false, ...shared };
  }

  return {
    tier: "no-data",
    headline: "No data",
    detail:
      "Nobody has reviewed or scanned this episode yet, so we don't know what's in it. This is not a verdict — it's an absence of information. Watch at your own discretion.",
    isUnknown: true,
    ...shared,
  };
}

// ---------------------------------------------------------------------------
// Timing helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a warning's start position in seconds for a given episode runtime.
 * Prefers the portable `startFrac * runtimeSec` (independent of which video
 * source/cut is playing); falls back to the source's raw `startSecAtSource`
 * when a fraction or runtime isn't available; `undefined` if neither is.
 */
export function effectiveStartSec(w: Warning, runtimeSec?: number): number | undefined {
  if (w.startFrac !== undefined && runtimeSec !== undefined) {
    return w.startFrac * runtimeSec;
  }
  return w.startSecAtSource;
}

/** `effectiveStartSec` counterpart for a warning's end position. */
export function effectiveEndSec(w: Warning, runtimeSec?: number): number | undefined {
  if (w.endFrac !== undefined && runtimeSec !== undefined) {
    return w.endFrac * runtimeSec;
  }
  return w.endSecAtSource;
}
