/**
 * "Does the Dog Die" client — crowdsourced, series-level content-warning
 * topics (no per-episode timestamps on the free tier).
 *
 * UNTESTED AGAINST THE LIVE API: outbound HTTPS to doesthedogdie.com is
 * blocked in this sandbox. Written from DTDD's documented `/api/v3` shape and
 * exercised only against the committed fixture in `fixtures/http/dtdd-media.json`
 * (see `test/sources.test.ts`). Verify against the real API on first live run.
 */

import type { Category, Warning } from "../schema/catalog.js";
import { fetchJson, type FetchLike } from "./http.js";

const DTDD_BASE = "https://www.doesthedogdie.com/api/v3";
const DEFAULT_USER_AGENT = "mealtv-cli/0.1 (+personal content-warning tool)";

export interface DtddOptions {
  /** Defaults to `process.env.DTDD_API_KEY`. */
  apiKey?: string;
  fetchImpl?: FetchLike;
  baseUrl?: string;
  userAgent?: string;
}

export interface DtddSearchResult {
  id: number;
  name: string;
  itemType?: string;
}

export interface DtddTopicStat {
  topicId: number;
  topicName: string;
  yesSum: number;
  noSum: number;
  numComments?: number;
}

export interface DtddMedia {
  id: number;
  name?: string;
  topicItemStats: DtddTopicStat[];
}

function requireApiKey(apiKey: string | undefined): string {
  if (!apiKey) {
    throw new Error(
      "mealtv: DTDD_API_KEY is not set. This request needs a Does the Dog Die " +
        "API key — set DTDD_API_KEY in your .env (see .env.example, free signup " +
        "at doesthedogdie.com) and retry.",
    );
  }
  return apiKey;
}

function authHeaders(opts: DtddOptions, apiKey: string): Record<string, string> {
  return {
    "X-API-KEY": apiKey,
    "User-Agent": opts.userAgent ?? DEFAULT_USER_AGENT,
  };
}

// ---------------------------------------------------------------------------
// Topic name -> Category mapping
// ---------------------------------------------------------------------------

/**
 * Ordered list of (category, keyword) rules. Matched case-insensitively as a
 * substring of the DTDD topic name. First match wins. Topics that match
 * nothing are skipped entirely (NOT coerced to "other" — DTDD has plenty of
 * topics irrelevant to this app, e.g. "does a dog die", and flooding the
 * catalog with those would defeat the point).
 */
export const DTDD_TOPIC_KEYWORD_MAP: ReadonlyArray<{
  category: Category;
  keywords: readonly string[];
}> = [
  {
    category: "vomiting",
    keywords: ["vomit", "throws up", "throw up", "emetophobia", "retch"],
  },
  { category: "gore", keywords: ["gore", "graphic violence"] },
  { category: "blood", keywords: ["blood"] },
  { category: "needles_medical", keywords: ["needle", "medical"] },
  { category: "bugs_insects", keywords: ["insect", "spider", "bug"] },
];

/** Maps a raw DTDD topic name to our `Category`, or `undefined` if unmapped. */
export function mapTopicNameToCategory(topicName: string): Category | undefined {
  const lower = topicName.toLowerCase();
  for (const rule of DTDD_TOPIC_KEYWORD_MAP) {
    if (rule.keywords.some((kw) => lower.includes(kw))) return rule.category;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

/** `GET /items?q=` — search DTDD's item (title) index by name. */
export async function searchItems(
  query: string,
  opts: DtddOptions = {},
): Promise<DtddSearchResult[]> {
  const apiKey = requireApiKey(opts.apiKey ?? process.env.DTDD_API_KEY);
  const url = new URL((opts.baseUrl ?? DTDD_BASE) + "/items");
  url.searchParams.set("q", query);

  const data = await fetchJson<unknown>(url, {
    fetchImpl: opts.fetchImpl,
    headers: authHeaders(opts, apiKey),
  });

  // Defensive: DTDD may wrap results in `{ items: [...] }` or return a bare
  // array depending on endpoint version; handle both.
  const raw = Array.isArray(data)
    ? data
    : Array.isArray((data as { items?: unknown[] })?.items)
      ? (data as { items: unknown[] }).items
      : [];

  return raw.map((r): DtddSearchResult => {
    const item = r as Record<string, unknown>;
    return {
      id: Number(item.id),
      name: String(item.name ?? ""),
      itemType: (item.itemType as string) || undefined,
    };
  });
}

/** `GET /media/{id}` — full topic-vote breakdown for one title. */
export async function getMedia(
  id: number,
  opts: DtddOptions = {},
): Promise<DtddMedia> {
  const apiKey = requireApiKey(opts.apiKey ?? process.env.DTDD_API_KEY);
  const url = new URL(`${opts.baseUrl ?? DTDD_BASE}/media/${id}`);

  const data = await fetchJson<Record<string, unknown>>(url, {
    fetchImpl: opts.fetchImpl,
    headers: authHeaders(opts, apiKey),
  });

  const rawStats = Array.isArray(data.topicItemStats) ? data.topicItemStats : [];
  const topicItemStats = rawStats.map((raw): DtddTopicStat => {
    const s = raw as Record<string, unknown>;
    return {
      topicId: Number(s.topicId),
      topicName: String(s.topicName ?? ""),
      yesSum: Number(s.yesSum ?? 0),
      noSum: Number(s.noSum ?? 0),
      numComments:
        typeof s.numComments === "number" ? s.numComments : undefined,
    };
  });

  return {
    id: Number(data.id),
    name: (data.name as string) || undefined,
    topicItemStats,
  };
}

/**
 * Fetches a title's DTDD media record and maps its topic stats into
 * catalog-schema `Warning[]`. Only topics that (a) map to a known `Category`
 * and (b) have `yesSum > 0` are emitted — everything else is silently
 * dropped rather than surfaced as noise. All emitted warnings are
 * `scope: "series"` since DTDD's free tier carries no per-episode timing.
 */
export async function getMediaWarnings(
  id: number,
  opts: DtddOptions = {},
): Promise<Warning[]> {
  const media = await getMedia(id, opts);
  const addedAt = new Date().toISOString();

  const warnings: Warning[] = [];
  for (const stat of media.topicItemStats) {
    if (stat.yesSum <= 0) continue;
    const category = mapTopicNameToCategory(stat.topicName);
    if (!category) continue;

    const total = stat.yesSum + stat.noSum;
    const confidence = total > 0 ? stat.yesSum / total : 0;

    warnings.push({
      id: `dtdd-${id}-${stat.topicId}`,
      category,
      severity: "medium",
      channel: "both",
      scope: "series",
      suppressed: false,
      provenance: {
        type: "dtdd",
        confidence,
        addedAt,
        detail: stat.topicName,
        sourceRef: String(stat.topicId),
      },
    });
  }
  return warnings;
}
