/**
 * The vocabulary that turns raw subtitle cue text into content warnings.
 *
 * Two kinds of entries:
 *
 * - "bracket-cue": matched against the text INSIDE a bracketed/parenthesized
 *   SDH sound descriptor (e.g. the `retches, vomits` inside `[retches,
 *   vomits]`). The scanner (scan.ts) is responsible for extracting bracket
 *   contents before testing these patterns -- these regexes are written to
 *   match anywhere the keyword appears within that extracted string (real
 *   SDH cues frequently combine several comma-separated sounds in one
 *   bracket, e.g. `[gags, retches]`), not to match the whole bracket
 *   contents exactly.
 * - "dialogue-mention": matched against the FULL cue text (ordinary spoken
 *   dialogue, no brackets involved).
 *
 * All patterns are case-insensitive.
 *
 * Confidence calibration:
 * - bracket-cue vomiting entries below are built directly from real SDH
 *   cues confirmed present in actual subtitle files during research, so
 *   they get the highest confidence band (~0.85-0.95).
 * - bracket-cue gore/blood/body_horror/bugs_insects/rot_decay/
 *   bathroom_bodily/needles_medical entries have NO confirmed real-world
 *   sample backing them (unlike the vomiting set) -- they're reasonable
 *   guesses at what SDH authors might write, so they are deliberately kept
 *   at a modest confidence (~0.3-0.55) even though they are still
 *   "bracket-cue" kind. See inline comments on each group.
 * - dialogue-mention entries are intentionally LOW confidence (~0.2-0.3).
 *   Research turned up a documented failure mode where a character merely
 *   SAYS something like "I think I'm gonna be sick" and no vomiting
 *   actually occurs on screen -- these phrases are false-positive-prone.
 *   They are kept in the lexicon and MUST still be emitted (never silently
 *   dropped): for the vomiting category specifically, this app's whole
 *   purpose is protecting an emetophobic viewer, so a missed real scene is
 *   worse than an extra low-confidence warning the verdict/UI layer can
 *   choose to downweight. Dropping them here would take that choice away
 *   from downstream consumers.
 */

import type { Category, Channel, Severity } from "../schema/catalog.js";

export type LexiconKind = "bracket-cue" | "dialogue-mention";

export type LexiconEntry = {
  category: Category;
  kind: LexiconKind;
  pattern: RegExp;
  severity: Severity;
  channel: Channel;
  /** 0-1. See calibration notes in the module docstring. */
  confidence: number;
};

export const LEXICON: LexiconEntry[] = [
  // ---------------------------------------------------------------------
  // vomiting -- bracket-cue, HIGH confidence.
  // Built directly from real confirmed SDH cues (research-verified).
  // Channel is "both": these sound descriptors typically accompany
  // on-screen vomiting/retching action, not just an off-screen noise.
  // ---------------------------------------------------------------------
  {
    category: "vomiting",
    kind: "bracket-cue",
    pattern: /\bvomit(s|ing|ed)?\b/i,
    severity: "high",
    channel: "both",
    confidence: 0.95,
  },
  {
    category: "vomiting",
    kind: "bracket-cue",
    pattern: /\bretch(es|ing|ed)?\b/i,
    severity: "high",
    channel: "both",
    confidence: 0.9,
  },
  {
    category: "vomiting",
    kind: "bracket-cue",
    pattern: /\bgag(s|ging|ged)?\b/i,
    severity: "high",
    channel: "both",
    confidence: 0.85,
  },
  {
    category: "vomiting",
    kind: "bracket-cue",
    pattern: /\bdry heav(es|ing|ed)?\b/i,
    severity: "high",
    channel: "both",
    confidence: 0.88,
  },
  {
    category: "vomiting",
    kind: "bracket-cue",
    pattern: /\bheaving\b/i,
    severity: "high",
    channel: "both",
    confidence: 0.85,
  },
  {
    category: "vomiting",
    kind: "bracket-cue",
    // e.g. "[coughing, gagging]" -- the coughing half is generic on its
    // own, but "gagging" above already covers that; this pattern exists so
    // a bracket that mentions coughing ALONGSIDE gagging still reads as a
    // vomiting-adjacent cue even if scanned in isolation from other rules.
    pattern: /\bcoughing,?\s*gagging\b/i,
    severity: "medium",
    channel: "both",
    confidence: 0.75,
  },
  {
    category: "vomiting",
    kind: "bracket-cue",
    // "[spits]" alone is ambiguous (could be a normal spit-take), so this
    // sits lower than the other confirmed vomiting cues.
    pattern: /\bspits?\b/i,
    severity: "medium",
    channel: "both",
    confidence: 0.65,
  },
  {
    category: "vomiting",
    kind: "bracket-cue",
    // "[wet splattering]" is a real confirmed cue but the phrase itself is
    // generic (could describe rain, a spill, etc.), hence sub-0.8.
    pattern: /\bwet splattering\b/i,
    severity: "medium",
    channel: "both",
    confidence: 0.75,
  },

  // ---------------------------------------------------------------------
  // gore / blood / body_horror -- bracket-cue, LOWER confidence.
  // NOTE: unlike the vomiting set above, research found NO confirmed
  // real-world SDH sample for these exact phrasings -- they are reasonable
  // guesses at plausible SDH wording, not verified cues. Kept modest.
  // ---------------------------------------------------------------------
  {
    category: "gore",
    kind: "bracket-cue",
    pattern: /\bbones? crack(s|ing|ed)?\b/i,
    severity: "medium",
    channel: "audio",
    confidence: 0.5,
  },
  {
    category: "gore",
    kind: "bracket-cue",
    pattern: /\bbones? snap(s|ping|ped)?\b/i,
    severity: "medium",
    channel: "audio",
    confidence: 0.5,
  },
  {
    category: "gore",
    kind: "bracket-cue",
    pattern: /\bbone crunch(ing|es|ed)?\b/i,
    severity: "medium",
    channel: "audio",
    confidence: 0.5,
  },
  {
    category: "gore",
    kind: "bracket-cue",
    // Very generic on its own -- "crunching" could be footsteps on gravel.
    pattern: /\bcrunching\b/i,
    severity: "low",
    channel: "audio",
    confidence: 0.3,
  },
  {
    category: "body_horror",
    kind: "bracket-cue",
    // Also generic (wet footsteps, mud, etc.) so kept low.
    pattern: /\bsquelching\b/i,
    severity: "low",
    channel: "audio",
    confidence: 0.3,
  },
  {
    category: "gore",
    kind: "bracket-cue",
    pattern: /\bflesh tear(ing|s)?\b/i,
    severity: "high",
    channel: "both",
    confidence: 0.55,
  },
  {
    category: "blood",
    kind: "bracket-cue",
    pattern: /\bblood splatter(s|ing)?\b/i,
    severity: "medium",
    channel: "both",
    confidence: 0.55,
  },
  {
    category: "blood",
    kind: "bracket-cue",
    pattern: /\bblood spurt(s|ing)?\b/i,
    severity: "high",
    channel: "both",
    confidence: 0.55,
  },
  {
    category: "gore",
    kind: "bracket-cue",
    pattern: /\bwet splatter\b/i,
    severity: "low",
    channel: "audio",
    confidence: 0.3,
  },
  {
    category: "body_horror",
    kind: "bracket-cue",
    pattern: /\bgurgling\b/i,
    severity: "low",
    channel: "audio",
    confidence: 0.3,
  },
  {
    category: "blood",
    kind: "bracket-cue",
    pattern: /\bchoking on blood\b/i,
    severity: "high",
    channel: "both",
    confidence: 0.6,
  },
  {
    category: "needles_medical",
    kind: "bracket-cue",
    pattern: /\bflatlin(e|es|ing)\b/i,
    severity: "high",
    channel: "audio",
    confidence: 0.5,
  },
  {
    category: "body_horror",
    kind: "bracket-cue",
    pattern: /\bskin sizzling\b/i,
    severity: "medium",
    channel: "both",
    confidence: 0.45,
  },

  // ---------------------------------------------------------------------
  // bugs_insects / rot_decay / bathroom_bodily / needles_medical --
  // modest, deliberately low-confidence entries. These categories weren't
  // part of the research sample at all; kept minimal and clearly marked so
  // they don't masquerade as verified.
  // ---------------------------------------------------------------------
  {
    category: "bugs_insects",
    kind: "bracket-cue",
    pattern: /\binsects? (crawling|swarming|buzzing)\b/i,
    severity: "low",
    channel: "both",
    confidence: 0.35,
  },
  {
    category: "bugs_insects",
    kind: "bracket-cue",
    pattern: /\bflies buzzing\b/i,
    severity: "low",
    channel: "audio",
    confidence: 0.3,
  },
  {
    category: "rot_decay",
    kind: "bracket-cue",
    pattern: /\b(decaying|rotting) (flesh|body|corpse)\b/i,
    severity: "medium",
    channel: "video",
    confidence: 0.35,
  },
  {
    category: "rot_decay",
    kind: "bracket-cue",
    pattern: /\bmaggots (crawling|squirming)\b/i,
    severity: "medium",
    channel: "video",
    confidence: 0.35,
  },
  {
    category: "bathroom_bodily",
    kind: "bracket-cue",
    pattern: /\b(toilet flushing|urinating|diarrhea)\b/i,
    severity: "low",
    channel: "audio",
    confidence: 0.3,
  },
  {
    category: "needles_medical",
    kind: "bracket-cue",
    pattern: /\b(needle piercing skin|injection|syringe)\b/i,
    severity: "low",
    channel: "video",
    confidence: 0.3,
  },

  // ---------------------------------------------------------------------
  // vomiting -- dialogue-mention, LOW confidence (see module docstring for
  // why these are kept despite the false-positive risk).
  // ---------------------------------------------------------------------
  {
    category: "vomiting",
    kind: "dialogue-mention",
    pattern: /\bgonna be sick\b/i,
    severity: "low",
    channel: "audio",
    confidence: 0.25,
  },
  {
    category: "vomiting",
    kind: "dialogue-mention",
    pattern: /\bgoing to throw up\b/i,
    severity: "low",
    channel: "audio",
    confidence: 0.3,
  },
  {
    category: "vomiting",
    kind: "dialogue-mention",
    pattern: /\bgonna puke\b/i,
    severity: "low",
    channel: "audio",
    confidence: 0.3,
  },
  {
    category: "vomiting",
    kind: "dialogue-mention",
    // The most generic/false-positive-prone phrase in the set -- "feel
    // sick" is said constantly for reasons that have nothing to do with
    // vomiting (colds, nerves, motion sickness that passes, etc).
    pattern: /\bfeel(s|ing)? sick\b/i,
    severity: "low",
    channel: "audio",
    confidence: 0.2,
  },
  {
    category: "vomiting",
    kind: "dialogue-mention",
    pattern: /\bgonna vomit\b/i,
    severity: "low",
    channel: "audio",
    confidence: 0.3,
  },
  {
    category: "vomiting",
    kind: "dialogue-mention",
    pattern: /\bgonna hurl\b/i,
    severity: "low",
    channel: "audio",
    confidence: 0.25,
  },
];
