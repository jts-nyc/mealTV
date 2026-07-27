/**
 * Merges same-category lexicon hits that occur close together in time into
 * a single scene-level hit.
 *
 * Real SDH tracks frequently split one continuous vomiting beat across
 * several cues -- e.g. `[gags]` at 10:00 followed by `[vomits]` four
 * seconds later -- and each cue would otherwise produce its own warning.
 * Emitting one warning per cue would spam the viewer with near-duplicate
 * countdowns for what is clearly one scene, so hits of the same category
 * whose gap is within `CLUSTER_GAP_MS` get merged into one.
 */

import type { Category, Channel, Severity } from "../schema/catalog.js";

/** Default merge threshold: cues up to 12 seconds apart count as one scene. */
export const CLUSTER_GAP_MS = 12_000;

const SEVERITY_RANK: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export type ClusterableHit = {
  category: Category;
  severity: Severity;
  channel: Channel;
  /** 0-1 detection confidence. */
  confidence: number;
  startMs: number;
  endMs: number;
};

export type ClusteredHit = ClusterableHit;

function highestSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

function mergeChannel(a: Channel, b: Channel): Channel {
  if (a === b) return a;
  return "both";
}

function mergeTwo(a: ClusterableHit, b: ClusterableHit): ClusterableHit {
  return {
    category: a.category,
    severity: highestSeverity(a.severity, b.severity),
    channel: mergeChannel(a.channel, b.channel),
    confidence: Math.max(a.confidence, b.confidence),
    startMs: Math.min(a.startMs, b.startMs),
    endMs: Math.max(a.endMs, b.endMs),
  };
}

/**
 * Merge hits within the same category whose time gap is <= `gapMs`.
 * Input order does not matter; output is sorted by `startMs` within each
 * category, and categories are emitted in first-seen order.
 */
export function clusterHits(
  hits: ClusterableHit[],
  gapMs: number = CLUSTER_GAP_MS,
): ClusteredHit[] {
  const categoryOrder: Category[] = [];
  const byCategory = new Map<Category, ClusterableHit[]>();

  for (const hit of hits) {
    let bucket = byCategory.get(hit.category);
    if (!bucket) {
      bucket = [];
      byCategory.set(hit.category, bucket);
      categoryOrder.push(hit.category);
    }
    bucket.push(hit);
  }

  const result: ClusteredHit[] = [];

  for (const category of categoryOrder) {
    const sorted = [...byCategory.get(category)!].sort(
      (a, b) => a.startMs - b.startMs,
    );

    let current: ClusterableHit | undefined;
    for (const hit of sorted) {
      if (!current) {
        current = { ...hit };
        continue;
      }
      const gap = hit.startMs - current.endMs;
      if (gap <= gapMs) {
        current = mergeTwo(current, hit);
      } else {
        result.push(current);
        current = { ...hit };
      }
    }
    if (current) {
      result.push(current);
    }
  }

  return result;
}
