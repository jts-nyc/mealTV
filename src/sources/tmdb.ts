/**
 * TMDB (The Movie Database) client — the backbone metadata source: show
 * title, season/episode numbering, and per-episode runtimes.
 *
 * UNTESTED AGAINST THE LIVE API: outbound HTTPS to api.themoviedb.org is
 * blocked in this sandbox. Everything here is written from TMDB's documented
 * `/3` REST shapes and exercised only against the committed fixtures in
 * `fixtures/http/` (see `test/sources.test.ts`). Verify against the real API
 * on first live run.
 *
 * Auth: TMDB supports two key styles. A classic v3 "API key" goes as an
 * `api_key` query param; a v4 "read access token" (a long JWT-looking
 * string) must go as an `Authorization: Bearer` header instead. We pick
 * automatically based on the shape of the key so either kind of
 * `TMDB_API_KEY` works.
 */

import { fetchJson, type FetchLike } from "./http.js";

const TMDB_BASE = "https://api.themoviedb.org/3";

export interface TmdbOptions {
  /** Defaults to `process.env.TMDB_API_KEY`. */
  apiKey?: string;
  fetchImpl?: FetchLike;
  baseUrl?: string;
}

export interface TmdbSearchResult {
  tmdbId: number;
  name: string;
  firstAirDate?: string;
  overview?: string;
}

export interface TmdbSeasonSummary {
  seasonNumber: number;
  episodeCount: number;
}

export interface TmdbShow {
  tmdbId: number;
  name: string;
  seasons: TmdbSeasonSummary[];
}

export interface TmdbEpisode {
  episodeNumber: number;
  name: string;
  /** Converted from TMDB's `runtime` (minutes). Undefined (never 0) when TMDB
   * doesn't know the runtime yet, since downstream startFrac/endFrac math
   * depends on this being honest rather than a fake zero. */
  runtimeSec?: number;
  tmdbId: number;
  airDate?: string;
}

function requireApiKey(apiKey: string | undefined): string {
  if (!apiKey) {
    throw new Error(
      "mealtv: TMDB_API_KEY is not set. This request needs a TMDB API key — " +
        "set TMDB_API_KEY in your .env (see .env.example, free signup at " +
        "themoviedb.org/settings/api) and retry.",
    );
  }
  return apiKey;
}

/** A v4 read access token is a JWT: three dot-separated base64url segments, long. */
function looksLikeBearerToken(key: string): boolean {
  return key.split(".").length === 3 && key.length > 100;
}

function buildUrl(
  baseUrl: string,
  pathname: string,
  apiKey: string,
  headers: Record<string, string>,
  params: Record<string, string | number | undefined> = {},
): URL {
  const url = new URL(baseUrl + pathname);
  if (looksLikeBearerToken(apiKey)) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  } else {
    url.searchParams.set("api_key", apiKey);
  }
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url;
}

/** `GET /search/tv?query=` — find candidate shows by title. */
export async function searchTv(
  query: string,
  opts: TmdbOptions = {},
): Promise<TmdbSearchResult[]> {
  const apiKey = requireApiKey(opts.apiKey ?? process.env.TMDB_API_KEY);
  const headers: Record<string, string> = {};
  const url = buildUrl(opts.baseUrl ?? TMDB_BASE, "/search/tv", apiKey, headers, {
    query,
  });

  const data = await fetchJson<{ results?: unknown[] }>(url, {
    fetchImpl: opts.fetchImpl,
    headers,
  });

  const results = Array.isArray(data.results) ? data.results : [];
  return results.map((raw): TmdbSearchResult => {
    const r = raw as Record<string, unknown>;
    return {
      tmdbId: Number(r.id),
      name: String(r.name ?? ""),
      firstAirDate: (r.first_air_date as string) || undefined,
      overview: (r.overview as string) || undefined,
    };
  });
}

/** `GET /tv/{id}` — show-level metadata plus the list of seasons. */
export async function getShow(
  tmdbId: number,
  opts: TmdbOptions = {},
): Promise<TmdbShow> {
  const apiKey = requireApiKey(opts.apiKey ?? process.env.TMDB_API_KEY);
  const headers: Record<string, string> = {};
  const url = buildUrl(opts.baseUrl ?? TMDB_BASE, `/tv/${tmdbId}`, apiKey, headers);

  const data = await fetchJson<Record<string, unknown>>(url, {
    fetchImpl: opts.fetchImpl,
    headers,
  });

  const rawSeasons = Array.isArray(data.seasons) ? data.seasons : [];
  return {
    tmdbId: Number(data.id),
    name: String(data.name ?? ""),
    seasons: rawSeasons.map((raw): TmdbSeasonSummary => {
      const s = raw as Record<string, unknown>;
      return {
        seasonNumber: Number(s.season_number),
        episodeCount: Number(s.episode_count ?? 0),
      };
    }),
  };
}

/** `GET /tv/{id}/season/{n}` — full episode list for one season. */
export async function getSeason(
  tmdbId: number,
  seasonNumber: number,
  opts: TmdbOptions = {},
): Promise<TmdbEpisode[]> {
  const apiKey = requireApiKey(opts.apiKey ?? process.env.TMDB_API_KEY);
  const headers: Record<string, string> = {};
  const url = buildUrl(
    opts.baseUrl ?? TMDB_BASE,
    `/tv/${tmdbId}/season/${seasonNumber}`,
    apiKey,
    headers,
  );

  const data = await fetchJson<Record<string, unknown>>(url, {
    fetchImpl: opts.fetchImpl,
    headers,
  });

  const rawEpisodes = Array.isArray(data.episodes) ? data.episodes : [];
  return rawEpisodes.map((raw): TmdbEpisode => {
    const e = raw as Record<string, unknown>;
    const runtimeMin = e.runtime;
    return {
      episodeNumber: Number(e.episode_number),
      name: String(e.name ?? ""),
      runtimeSec:
        typeof runtimeMin === "number" ? runtimeMin * 60 : undefined,
      tmdbId: Number(e.id),
      airDate: (e.air_date as string) || undefined,
    };
  });
}
