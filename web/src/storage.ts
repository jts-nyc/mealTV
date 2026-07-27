/**
 * localStorage persistence. Browser-only — touches the `localStorage`
 * global directly, so this module is intentionally NOT imported by any pure
 * logic module or by vitest tests (no top-level DOM/browser globals rule).
 * Only the DOM-wiring entry points (`watch.ts`, `export-page.ts`) import it.
 */

import { DEFAULT_LEAD_TIME_SEC } from "./constants.js";
import type { LoggedEntry } from "./export-log.js";

const RESYNC_PREFIX = "mealtv:resync:";
const LOG_KEY = "mealtv:log-entries";
const LEAD_TIME_KEY = "mealtv:lead-time-sec";
const SOUND_KEY = "mealtv:sound-enabled";

function episodeKey(slug: string, season: number, episode: number): string {
  return `${RESYNC_PREFIX}${slug}:${season}:${episode}`;
}

/** Per-episode resync offset in seconds, from the −5s/+5s buttons. Defaults to 0. */
export function getResyncOffset(slug: string, season: number, episode: number): number {
  const raw = localStorage.getItem(episodeKey(slug, season, episode));
  const n = raw !== null ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

export function setResyncOffset(slug: string, season: number, episode: number, offsetSec: number): void {
  localStorage.setItem(episodeKey(slug, season, episode), String(offsetSec));
}

/** User-adjustable global lead time override. Falls back to DEFAULT_LEAD_TIME_SEC. */
export function getLeadTimeSec(): number {
  const raw = localStorage.getItem(LEAD_TIME_KEY);
  const n = raw !== null ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LEAD_TIME_SEC;
}

export function setLeadTimeSec(sec: number): void {
  localStorage.setItem(LEAD_TIME_KEY, String(sec));
}

/** Whether the WebAudio beep is enabled. Off by default until the user opts in
 * (it needs a user gesture to initialize anyway). */
export function getSoundEnabled(): boolean {
  return localStorage.getItem(SOUND_KEY) === "1";
}

export function setSoundEnabled(enabled: boolean): void {
  localStorage.setItem(SOUND_KEY, enabled ? "1" : "0");
}

export function getLogEntries(): LoggedEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LoggedEntry[]) : [];
  } catch {
    return [];
  }
}

function saveLogEntries(entries: LoggedEntry[]): void {
  localStorage.setItem(LOG_KEY, JSON.stringify(entries));
}

export function addLogEntry(entry: LoggedEntry): void {
  const entries = getLogEntries();
  entries.push(entry);
  saveLogEntries(entries);
}

export function removeLogEntry(id: string): void {
  saveLogEntries(getLogEntries().filter((e) => e.id !== id));
}
