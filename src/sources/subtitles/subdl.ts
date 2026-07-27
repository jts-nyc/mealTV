/**
 * SubDL subtitle search — second provider tried, needs a free API key.
 *
 * UNTESTED AGAINST THE LIVE API: outbound HTTPS to api.subdl.com is blocked
 * in this sandbox. Written from SubDL's documented `/api/v1/subtitles`
 * endpoint; verify against the real API on first live run. Note SubDL's
 * search response typically returns a relative `url` under a static asset
 * host serving a `.zip`, not a directly downloadable `.srt` — `downloadSubtitle`
 * here assumes `downloadRef` resolves directly to subtitle text and will need
 * revisiting (zip extraction) once tested live.
 */

import { fetchJson, HttpError, type FetchLike } from "../http.js";
import type {
  SubtitleProvider,
  SubtitleSearchParams,
  SubtitleSearchResult,
} from "./common.js";

const SUBDL_BASE = "https://api.subdl.com/api/v1/subtitles";

export interface SubdlOptions {
  /** Defaults to `process.env.SUBDL_API_KEY`. */
  apiKey?: string;
  fetchImpl?: FetchLike;
  baseUrl?: string;
}

function requireApiKey(apiKey: string | undefined): string {
  if (!apiKey) {
    throw new Error(
      "mealtv: SUBDL_API_KEY is not set. This request needs a SubDL API key — " +
        "set SUBDL_API_KEY in your .env (see .env.example, free signup at " +
        "subdl.com) and retry.",
    );
  }
  return apiKey;
}

export async function searchSubtitles(
  params: SubtitleSearchParams,
  opts: SubdlOptions = {},
): Promise<SubtitleSearchResult[]> {
  const apiKey = requireApiKey(opts.apiKey ?? process.env.SUBDL_API_KEY);
  const url = new URL(opts.baseUrl ?? SUBDL_BASE);
  url.searchParams.set("api_key", apiKey);
  if (params.tmdbId) url.searchParams.set("tmdb_id", String(params.tmdbId));
  if (params.imdbId) url.searchParams.set("imdb_id", params.imdbId);
  url.searchParams.set("season_number", String(params.seasonNumber));
  url.searchParams.set("episode_number", String(params.episodeNumber));
  url.searchParams.set("languages", (params.language ?? "en").toUpperCase());

  const data = await fetchJson<Record<string, unknown>>(url, {
    fetchImpl: opts.fetchImpl,
  });

  const raw = Array.isArray(data.subtitles) ? data.subtitles : [];
  return raw.map((r): SubtitleSearchResult => {
    const item = r as Record<string, unknown>;
    return {
      id: String(item.subtitle_id ?? item.url ?? item.name ?? ""),
      language: (item.language as string) ?? params.language ?? "en",
      hearingImpaired: Boolean(item.hi ?? item.hearing_impaired),
      downloadRef: String(item.url ?? item.download_url ?? ""),
      releaseName: (item.release_name as string) ?? (item.name as string) ?? undefined,
    };
  });
}

export async function downloadSubtitle(
  ref: string,
  opts: SubdlOptions = {},
): Promise<string> {
  // UNTESTED AGAINST THE LIVE API — see module docstring.
  const fetchImpl = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(ref);
  } catch (err) {
    throw new Error(
      `mealtv: SubDL download request failed for ${ref}: ${(err as Error).message}`,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new HttpError(
      `mealtv: SubDL download failed for ${ref} with status ${res.status}`,
      res.status,
      text.slice(0, 300),
    );
  }
  return await res.text();
}

export const subdlProvider: SubtitleProvider = {
  name: "subdl",
  searchSubtitles,
  downloadSubtitle,
};
