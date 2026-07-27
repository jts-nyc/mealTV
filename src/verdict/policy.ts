/**
 * mealTV verdict policy: the tunable knobs that decide how episode/series
 * warnings map onto a pre-play verdict. Kept separate from compute-verdict.ts's
 * control flow so the actual thresholds are easy to find, audit, and change
 * without touching the logic that uses them.
 *
 * Pure module: no `fs`, no `node:*` imports, no side effects — this is imported
 * by both the Node CLI and the browser web app (bundled via esbuild).
 */

import type { Category, Severity } from "../schema/catalog.js";

// ---------------------------------------------------------------------------
// Category tiers
// ---------------------------------------------------------------------------

/**
 * The user's stated absolute dealbreaker. Zero tolerance: ANY non-suppressed
 * warning in this category blocks the episode, at ANY confidence level and at
 * ANY scope (a single low-confidence subtitle hit, or even a series-wide
 * crowdsourced report with no exact scene, both block). This is intentionally
 * a hard binary rule and not graded — the entire premise of mealTV is to never
 * be ambushed by this one specific thing while eating dinner.
 */
export const HARD_BLOCK_CATEGORIES: readonly Category[] = ["vomiting"];

/**
 * Everything else is graded, not binary. Most notably gore — "lots of gore is
 * bad, but it really depends on how it's done" — must never auto-escalate to a
 * hard block; it's surfaced with its severity so the user can make the call
 * themselves. The rest of the taxonomy (blood, body horror, bugs, rot, filth,
 * bathroom/bodily, needles/medical, animal harm, other) gets the same
 * non-blocking, judgment-preserving treatment.
 */
export const CAUTION_CATEGORIES: readonly Category[] = [
  "gore",
  "blood",
  "body_horror",
  "bugs_insects",
  "rot_decay",
  "filth_grime",
  "bathroom_bodily",
  "needles_medical",
  "animal_harm",
  "other",
];

// ---------------------------------------------------------------------------
// Severity ranking
// ---------------------------------------------------------------------------

/** Numeric ordering so "worst severity present in a set of warnings" is a plain max. */
export const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  low: 0,
  medium: 1,
  high: 2,
};

// ---------------------------------------------------------------------------
// Confidence thresholds
// ---------------------------------------------------------------------------

/**
 * Below this confidence, a hard-block detection (e.g. a subtitle-scan hit on
 * a word that's sometimes used figuratively, or a single crowd report) is
 * described in the copy as an *unconfirmed mention* rather than stated as
 * plain fact — even though it still blocks (see HARD_BLOCK_CATEGORIES doc
 * above). This keeps the copy honest about what's actually known, instead of
 * training the user to distrust every alert by overstating certainty.
 */
export const UNCONFIRMED_CONFIDENCE_THRESHOLD = 0.5;
