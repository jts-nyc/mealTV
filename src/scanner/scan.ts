/**
 * Orchestrates: parse subtitles -> per-cue lexicon match -> cluster ->
 * emit `Warning[]` valid against the catalog schema's `WarningSchema`.
 */

import type { Warning } from "../schema/catalog.js";
import { parseSubtitles, type Cue, type SubtitleFormat } from "./parse-subtitles.js";
import { LEXICON, type LexiconEntry } from "./lexicon.js";
import { clusterHits, type ClusterableHit } from "./cluster.js";

export type ScanSubtitlesOptions = {
  /** Source filename, recorded in `provenance.detail`. */
  filename?: string;
  /** Episode duration in seconds. Falls back to the final cue's end time. */
  durationSec?: number;
  format?: SubtitleFormat;
};

const BRACKET_RE = /\[([^\]]+)\]/g;
const PAREN_RE = /\(([^)]+)\)/g;

/** Extract the inner text of every `[...]` and `(...)` segment in a cue. */
function extractBracketSegments(text: string): string[] {
  const segments: string[] = [];
  for (const match of text.matchAll(BRACKET_RE)) {
    segments.push(match[1]);
  }
  for (const match of text.matchAll(PAREN_RE)) {
    segments.push(match[1]);
  }
  return segments;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/**
 * Match a single cue against the lexicon, returning zero or more raw hits
 * (pre-clustering). A cue can produce multiple hits: several bracket
 * segments, several matching entries per segment, and/or a dialogue-mention
 * match on top of bracket-cue matches.
 */
function matchCue(cue: Cue, lexicon: LexiconEntry[]): ClusterableHit[] {
  const hits: ClusterableHit[] = [];

  const bracketSegments = extractBracketSegments(cue.text);
  const bracketEntries = lexicon.filter((e) => e.kind === "bracket-cue");
  for (const segment of bracketSegments) {
    for (const entry of bracketEntries) {
      if (entry.pattern.test(segment)) {
        hits.push({
          category: entry.category,
          severity: entry.severity,
          channel: entry.channel,
          confidence: entry.confidence,
          startMs: cue.startMs,
          endMs: cue.endMs,
        });
      }
    }
  }

  const dialogueEntries = lexicon.filter((e) => e.kind === "dialogue-mention");
  for (const entry of dialogueEntries) {
    if (entry.pattern.test(cue.text)) {
      hits.push({
        category: entry.category,
        severity: entry.severity,
        channel: entry.channel,
        confidence: entry.confidence,
        startMs: cue.startMs,
        endMs: cue.endMs,
      });
    }
  }

  return hits;
}

/**
 * Deterministic id: category + start/end ms. Clustering guarantees hits
 * within the same category never overlap and are sorted by start time, so
 * this triple is unique within a single scan's output -- no counter or
 * hashing needed, and re-scanning identical content yields identical ids.
 */
function makeId(category: string, startMs: number, endMs: number): string {
  return `scan-${category}-${startMs}-${endMs}`;
}

export function scanSubtitles(
  content: string,
  opts: ScanSubtitlesOptions = {},
): Warning[] {
  const cues = parseSubtitles(content, opts.format);
  if (cues.length === 0) {
    return [];
  }

  const allHits: ClusterableHit[] = [];
  for (const cue of cues) {
    allHits.push(...matchCue(cue, LEXICON));
  }

  const clustered = clusterHits(allHits);

  const sourceDurationSec =
    opts.durationSec ?? cues[cues.length - 1].endMs / 1000;
  const addedAt = new Date().toISOString();

  return clustered.map((hit): Warning => {
    const startSecAtSource = hit.startMs / 1000;
    const endSecAtSource = hit.endMs / 1000;

    const canComputeFrac = sourceDurationSec > 0;
    const startFrac = canComputeFrac
      ? clamp01(startSecAtSource / sourceDurationSec)
      : undefined;
    const endFrac = canComputeFrac
      ? clamp01(endSecAtSource / sourceDurationSec)
      : undefined;

    return {
      id: makeId(hit.category, hit.startMs, hit.endMs),
      category: hit.category,
      severity: hit.severity,
      channel: hit.channel,
      scope: "episode",
      startFrac,
      endFrac,
      startSecAtSource,
      endSecAtSource,
      sourceDurationSec: canComputeFrac ? sourceDurationSec : undefined,
      suppressed: false,
      provenance: {
        type: "subtitle-scan",
        confidence: hit.confidence,
        addedAt,
        detail: opts.filename,
      },
    };
  });
}
