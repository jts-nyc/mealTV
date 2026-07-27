/**
 * Normalizes SRT and WebVTT subtitle files into a common `Cue[]` shape.
 *
 * Uses the `subtitle` npm package's `parseSync`, which already auto-detects
 * SRT vs WebVTT from the input text itself (it looks for a `WEBVTT` header
 * line) and returns cue timestamps in milliseconds. The `format` param is
 * therefore accepted for caller intent / documentation purposes but is not
 * required for correct parsing -- `subtitle` figures it out either way.
 *
 * Multi-line cue text (e.g. a two-line SRT block) is joined with a single
 * space, not a newline. This keeps downstream regex matching (lexicon.ts)
 * simple -- callers match against one flat string per cue rather than having
 * to worry about `\n` inside bracket contents.
 *
 * Robustness contract: malformed or empty input never throws. A file with
 * zero cues (e.g. a header-only VTT file, or an empty string) returns `[]`.
 * If the underlying parser throws (e.g. on a truly garbled timestamp line),
 * that error is caught and `[]` is returned as well -- for this app, a
 * subtitle file we can't parse should degrade to "no scan-derived warnings",
 * not crash the pipeline. Callers who want to distinguish "empty" from
 * "unparsable" should inspect the raw content themselves before calling in.
 */

import { parseSync, type Node as SubtitleNode } from "subtitle";

export type Cue = {
  startMs: number;
  endMs: number;
  text: string;
};

export type SubtitleFormat = "srt" | "vtt";

/**
 * Best-effort format sniff from raw content. WebVTT files must start with a
 * `WEBVTT` line (per spec, optionally preceded by a BOM); anything else is
 * treated as SRT. This is only used for caller-facing metadata -- the actual
 * parse is format-agnostic (see module docstring).
 */
export function detectSubtitleFormat(content: string): SubtitleFormat {
  const stripped = content.replace(/^﻿/, "").trimStart();
  return stripped.startsWith("WEBVTT") ? "vtt" : "srt";
}

export function parseSubtitles(
  content: string,
  _format?: SubtitleFormat,
): Cue[] {
  if (!content || !content.trim()) {
    return [];
  }

  let nodes: SubtitleNode[];
  try {
    nodes = parseSync(content);
  } catch {
    // See module docstring: unparsable input degrades to no cues rather
    // than throwing.
    return [];
  }

  const cues: Cue[] = [];
  for (const node of nodes) {
    if (node.type !== "cue") continue;
    const { start, end, text } = node.data;
    if (typeof start !== "number" || typeof end !== "number") continue;
    const joined = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join(" ")
      .trim();
    if (!joined) continue;
    cues.push({ startMs: start, endMs: end, text: joined });
  }

  return cues;
}
