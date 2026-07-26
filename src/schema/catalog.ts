/**
 * mealTV catalog schema.
 *
 * This file is imported by BOTH the Node data-pipeline CLI and the browser web app
 * (bundled in via esbuild). It must stay pure zod + TypeScript with zero Node-only
 * imports (no `fs`, `path`, `node:*`, etc.) so it can run unmodified in a browser.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Category
// ---------------------------------------------------------------------------

/**
 * Content-warning categories.
 *
 * `vomiting` is THE hard-blocker category for this app (the whole point of mealTV
 * is avoiding vomiting/emetophobia-triggering content while eating). It is named
 * `vomiting` rather than `emetophobia` so app logic reads naturally (e.g.
 * `warning.category === "vomiting"`), even though "emetophobia" is the term used by
 * the MovieContentFilter project's taxonomy that this schema's category list is
 * inspired by.
 */
export const CategorySchema = z.enum([
  "vomiting",
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
]);
export type Category = z.infer<typeof CategorySchema>;

// ---------------------------------------------------------------------------
// Severity
// ---------------------------------------------------------------------------

export const SeveritySchema = z.enum(["low", "medium", "high"]);
export type Severity = z.infer<typeof SeveritySchema>;

// ---------------------------------------------------------------------------
// Channel
// ---------------------------------------------------------------------------

/**
 * Whether the bad thing is visual, audio (e.g. a retching SOUND), or both.
 *
 * NOTE: the web app treats this as informational display only in v1 (e.g. "this one
 * is audio-only, you could look away and be fine but you'll still hear it"), NOT as a
 * mute/skip control — nothing about mealTV can actually control the user's TV.
 */
export const ChannelSchema = z.enum(["video", "audio", "both"]);
export type Channel = z.infer<typeof ChannelSchema>;

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

/**
 * How specific a warning's placement is.
 *
 * `episode`-scope warnings carry real timestamps (start/end fractions and/or
 * source seconds) and can drive the synced countdown timer. `season`/`series`-scope
 * warnings typically come from crowdsourced sources (e.g. Does the Dog Die) that only
 * know "this happens somewhere in this show" with no timestamp, so they can only
 * inform the pre-play verdict, not the in-playback timer.
 */
export const ScopeSchema = z.enum(["episode", "season", "series"]);
export type Scope = z.infer<typeof ScopeSchema>;

// ---------------------------------------------------------------------------
// SourceType
// ---------------------------------------------------------------------------

export const SourceTypeSchema = z.enum([
  "curated",
  "dtdd",
  "subtitle-scan",
  "self-logged",
]);
export type SourceType = z.infer<typeof SourceTypeSchema>;

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

export const ProvenanceSchema = z.object({
  type: SourceTypeSchema,
  confidence: z.number().min(0).max(1),
  addedAt: z.iso.datetime(),
  /** e.g. subtitle filename, DTDD topic id, curator note. */
  detail: z.string().optional(),
  sourceRef: z.string().optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

// ---------------------------------------------------------------------------
// Warning
// ---------------------------------------------------------------------------

export const WarningSchema = z.object({
  id: z.string(),
  category: CategorySchema,
  severity: SeveritySchema,
  channel: ChannelSchema,
  scope: ScopeSchema,
  /**
   * Canonical portable position: a fraction (0-1) of episode runtime. This is what
   * the web app's synced countdown timer actually uses, since it's independent of
   * which specific video source/cut the user is watching.
   */
  startFrac: z.number().min(0).max(1).optional(),
  endFrac: z.number().min(0).max(1).optional(),
  /** Raw seconds as timestamped in whatever source produced this warning (e.g. the
   * actual subtitle file that was scanned). */
  startSecAtSource: z.number().nonnegative().optional(),
  endSecAtSource: z.number().nonnegative().optional(),
  /** The source's own implied total duration, used to derive startFrac/endFrac so the
   * fraction is auditable/recomputable (startFrac = startSecAtSource / sourceDurationSec). */
  sourceDurationSec: z.number().positive().optional(),
  note: z.string().optional(),
  /** Set true to mark a confirmed false positive WITHOUT deleting the record. */
  suppressed: z.boolean().default(false),
  provenance: ProvenanceSchema,
});
export type Warning = z.infer<typeof WarningSchema>;

// ---------------------------------------------------------------------------
// Episode
// ---------------------------------------------------------------------------

export const EpisodeSchema = z.object({
  episodeNumber: z.number().int(),
  title: z.string().optional(),
  tmdbId: z.number().int().optional(),
  runtimeSec: z.number().int().positive().optional(),
  /** An explicit human "I watched this, it's clean" flag — the ONLY path to a green
   * verdict for an episode. */
  reviewedClear: z.boolean().default(false),
  warnings: z.array(WarningSchema).default([]),
});
export type Episode = z.infer<typeof EpisodeSchema>;

// ---------------------------------------------------------------------------
// Season
// ---------------------------------------------------------------------------

export const SeasonSchema = z.object({
  seasonNumber: z.number().int(),
  episodes: z.array(EpisodeSchema),
});
export type Season = z.infer<typeof SeasonSchema>;

// ---------------------------------------------------------------------------
// Show
// ---------------------------------------------------------------------------

export const ShowSchema = z.object({
  slug: z.string(),
  title: z.string(),
  tmdbId: z.number().int().optional(),
  dtddId: z.number().int().optional(),
  /** scope:"series" or "season" warnings that apply broadly, not to one timestamped
   * episode. */
  seriesWarnings: z.array(WarningSchema).default([]),
  seasons: z.array(SeasonSchema),
});
export type Show = z.infer<typeof ShowSchema>;

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

export function parseShow(data: unknown): Show {
  return ShowSchema.parse(data);
}

export function safeParseShow(
  data: unknown,
): ReturnType<typeof ShowSchema.safeParse> {
  return ShowSchema.safeParse(data);
}
