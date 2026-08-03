/**
 * Plain-language display copy for schema enums. Pure module, no DOM.
 */

import type { Category, Channel, SourceType } from "../../src/schema/catalog.js";

/** `SourceType` -> plain language, per the product spec. */
export const PROVENANCE_LABELS: Record<SourceType, string> = {
  curated: "Checked by you",
  dtdd: "Viewer-reported",
  "subtitle-scan": "Detected in captions",
  "self-logged": "You logged this",
};

export function provenanceLabel(type: SourceType): string {
  return PROVENANCE_LABELS[type];
}

/** eye = visual, speaker = audio, both = eye+speaker. Text glyphs, not emoji,
 * so they render consistently and are easy to pair with an sr-only label. */
export const CHANNEL_GLYPHS: Record<Channel, string> = {
  video: "\u{1F441}", // eye
  audio: "\u{1F50A}", // speaker
  both: "\u{1F441}\u{1F50A}",
};

export const CHANNEL_LABELS: Record<Channel, string> = {
  video: "Visual",
  audio: "Audio",
  both: "Visual + audio",
};

export function categoryLabel(category: Category): string {
  return category.replace(/_/g, " ");
}
