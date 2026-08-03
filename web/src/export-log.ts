/**
 * Self-logging: turn a "LOG THIS" tap during Watch-along into a stored entry,
 * and turn stored entries into the exact JSON payload the CLI's
 * `mealtv import-log <file.json>` command expects.
 *
 * Pure module — no DOM, no localStorage — so it's directly importable by
 * vitest. `web/src/storage.ts` is the (untested, browser-only) layer that
 * persists `LoggedEntry[]` to localStorage.
 *
 * The payload shape here MUST match `LogEntrySchema` in
 * `src/cli/commands/import-log.ts`:
 *   { slug, season, episode, category, severity?, atSec, note? }
 */

import type { Category, Severity } from "../../src/schema/catalog.js";
import { REACTION_OFFSET_SEC } from "./constants.js";

/** A self-logged entry as stored locally (includes bookkeeping fields the CLI doesn't need). */
export interface LoggedEntry {
  /** Local-only id, used for the "delete before export" UI. Not sent to the CLI. */
  id: string;
  slug: string;
  season: number;
  episode: number;
  category: Category;
  severity: Severity;
  /** Seconds into the episode, already corrected by REACTION_OFFSET_SEC. */
  atSec: number;
  note?: string;
  /** When the entry was logged, ISO-8601. Local-only, not sent to the CLI. */
  loggedAt: string;
}

/** Exactly the shape `mealtv import-log` expects for one array entry. */
export interface ImportLogEntry {
  slug: string;
  season: number;
  episode: number;
  category: Category;
  severity: Severity;
  atSec: number;
  note?: string;
}

export interface CreateLoggedEntryParams {
  id: string;
  slug: string;
  season: number;
  episode: number;
  /** Raw elapsed seconds at the moment "LOG THIS" was tapped, BEFORE the reaction-time correction. */
  elapsedSec: number;
  category: Category;
  /** Defaults to "medium" — the app doesn't ask for a severity on the quick-log path. */
  severity?: Severity;
  note?: string;
  /** Injectable for tests; defaults to `new Date()`. */
  now?: Date;
};

/**
 * Build a `LoggedEntry` from a "LOG THIS" tap, applying REACTION_OFFSET_SEC
 * so the stored timestamp is a beat earlier than when the button was
 * actually pressed. Never goes negative.
 */
export function createLoggedEntry(params: CreateLoggedEntryParams): LoggedEntry {
  const atSec = Math.max(0, Math.round(params.elapsedSec - REACTION_OFFSET_SEC));
  return {
    id: params.id,
    slug: params.slug,
    season: params.season,
    episode: params.episode,
    category: params.category,
    severity: params.severity ?? "medium",
    atSec,
    note: params.note,
    loggedAt: (params.now ?? new Date()).toISOString(),
  };
}

/**
 * Transform stored entries into the exact array shape `mealtv import-log`
 * expects. Drops the local-only `id`/`loggedAt` fields and omits `note` when
 * empty rather than sending an empty string.
 */
export function toImportLogPayload(entries: LoggedEntry[]): ImportLogEntry[] {
  return entries.map((entry) => {
    const out: ImportLogEntry = {
      slug: entry.slug,
      season: entry.season,
      episode: entry.episode,
      category: entry.category,
      severity: entry.severity,
      atSec: entry.atSec,
    };
    if (entry.note) out.note = entry.note;
    return out;
  });
}

/** The exact CLI invocation the Export view tells the user to run. */
export function importLogCliCommand(filename = "mealtv-log.json"): string {
  return `mealtv import-log ${filename}`;
}
