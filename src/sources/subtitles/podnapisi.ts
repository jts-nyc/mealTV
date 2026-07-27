/**
 * Podnapisi.net subtitle search — keyless, so this is the first provider the
 * CLI tries by default.
 *
 * UNTESTED AGAINST THE LIVE API: outbound HTTPS to podnapisi.net is blocked
 * in this sandbox. Written from Podnapisi's documented JSON search endpoint;
 * verify against the real API on first live run, in particular the exact
 * result field names and the download redirect chain (Podnapisi typically
 * serves a `.zip` containing the `.srt`, which would need unzipping — not
 * implemented here, `downloadSubtitle` assumes `downloadRef` resolves
 * directly to text).
 */

import { fetchJson, HttpError, type FetchLike } from "../http.js";
import type {
  SubtitleProvider,
  SubtitleSearchParams,
  SubtitleSearchResult,
} from "./common.js";

const PODNAPISI_BASE = "https://www.podnapisi.net/subtitles/search/";

export interface PodnapisiOptions {
  fetchImpl?: FetchLike;
  baseUrl?: string;
}

export async function searchSubtitles(
  params: SubtitleSearchParams,
  opts: PodnapisiOptions = {},
): Promise<SubtitleSearchResult[]> {
  const url = new URL(opts.baseUrl ?? PODNAPISI_BASE);
  if (params.query) url.searchParams.set("keywords", params.query);
  url.searchParams.set("seasons", String(params.seasonNumber));
  url.searchParams.set("episodes", String(params.episodeNumber));
  url.searchParams.set("language", params.language ?? "en");

  const data = await fetchJson<Record<string, unknown>>(url, {
    fetchImpl: opts.fetchImpl,
    headers: { Accept: "application/json" },
  });

  const raw = Array.isArray((data as { data?: unknown[] }).data)
    ? (data as { data: unknown[] }).data
    : Array.isArray(data)
      ? (data as unknown[])
      : [];

  return raw.map((r): SubtitleSearchResult => {
    const item = r as Record<string, unknown>;
    const flags = Array.isArray(item.flags) ? (item.flags as unknown[]) : [];
    return {
      id: String(item.id ?? item.pid ?? ""),
      language: (item.language as string) ?? params.language ?? "en",
      hearingImpaired: flags.includes("hi") || Boolean(item.hearing_impaired),
      downloadRef: String(item.download ?? item.url ?? item.id ?? ""),
      releaseName: (item.release as string) || undefined,
    };
  });
}

export async function downloadSubtitle(
  ref: string,
  opts: PodnapisiOptions = {},
): Promise<string> {
  // UNTESTED AGAINST THE LIVE API — see module docstring.
  const fetchImpl = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(ref);
  } catch (err) {
    throw new Error(
      `mealtv: Podnapisi download request failed for ${ref}: ${(err as Error).message}`,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new HttpError(
      `mealtv: Podnapisi download failed for ${ref} with status ${res.status}`,
      res.status,
      text.slice(0, 300),
    );
  }
  return await res.text();
}

export const podnapisiProvider: SubtitleProvider = {
  name: "podnapisi",
  searchSubtitles,
  downloadSubtitle,
};
