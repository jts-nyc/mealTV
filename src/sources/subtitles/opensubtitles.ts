/**
 * OpenSubtitles.com subtitle search — last-resort provider: needs an API key
 * AND a JWT login to actually download (search alone only needs the key),
 * and the free tier's download quota is a harsh 5-20/day.
 *
 * UNTESTED AGAINST THE LIVE API: outbound HTTPS to api.opensubtitles.com is
 * blocked in this sandbox. Written from OpenSubtitles' documented `/api/v1`
 * REST shape; verify against the real API on first live run, in particular
 * the exact `/login` and `/download` request/response bodies.
 */

import { fetchJson, HttpError, type FetchLike } from "../http.js";
import type {
  SubtitleProvider,
  SubtitleSearchParams,
  SubtitleSearchResult,
} from "./common.js";

const OPENSUBTITLES_BASE = "https://api.opensubtitles.com/api/v1";
const DEFAULT_USER_AGENT = "mealtv-cli/0.1 (+personal content-warning tool)";

export interface OpenSubtitlesOptions {
  /** Defaults to `process.env.OPENSUBTITLES_API_KEY`. */
  apiKey?: string;
  /** Defaults to `process.env.OPENSUBTITLES_USERNAME`. Only needed for download. */
  username?: string;
  /** Defaults to `process.env.OPENSUBTITLES_PASSWORD`. Only needed for download. */
  password?: string;
  fetchImpl?: FetchLike;
  baseUrl?: string;
  userAgent?: string;
}

function requireApiKey(apiKey: string | undefined): string {
  if (!apiKey) {
    throw new Error(
      "mealtv: OPENSUBTITLES_API_KEY is not set. This request needs an " +
        "OpenSubtitles API key — set OPENSUBTITLES_API_KEY in your .env (see " +
        ".env.example, free signup at opensubtitles.com/en/consumers) and retry.",
    );
  }
  return apiKey;
}

function baseHeaders(opts: OpenSubtitlesOptions, apiKey: string): Record<string, string> {
  return {
    "Api-Key": apiKey,
    "User-Agent": opts.userAgent ?? DEFAULT_USER_AGENT,
  };
}

/**
 * `GET /subtitles?parent_tmdb_id=&season_number=&episode_number=&languages=`.
 * Search only — no login required. Results are sorted hearing-impaired-first
 * when `params.preferHearingImpaired` is set, since only SDH tracks reliably
 * carry the bracketed sound-effect cues the scanner needs.
 */
export async function searchSubtitles(
  params: SubtitleSearchParams,
  opts: OpenSubtitlesOptions = {},
): Promise<SubtitleSearchResult[]> {
  const apiKey = requireApiKey(opts.apiKey ?? process.env.OPENSUBTITLES_API_KEY);
  const url = new URL((opts.baseUrl ?? OPENSUBTITLES_BASE) + "/subtitles");
  if (params.tmdbId) url.searchParams.set("parent_tmdb_id", String(params.tmdbId));
  url.searchParams.set("season_number", String(params.seasonNumber));
  url.searchParams.set("episode_number", String(params.episodeNumber));
  url.searchParams.set("languages", params.language ?? "en");

  const data = await fetchJson<Record<string, unknown>>(url, {
    fetchImpl: opts.fetchImpl,
    headers: baseHeaders(opts, apiKey),
  });

  const raw = Array.isArray(data.data) ? data.data : [];
  let results = raw.map((r): SubtitleSearchResult => {
    const item = r as Record<string, unknown>;
    const attrs = (item.attributes ?? {}) as Record<string, unknown>;
    const files = Array.isArray(attrs.files) ? (attrs.files as Record<string, unknown>[]) : [];
    return {
      id: String(item.id ?? ""),
      language: (attrs.language as string) ?? params.language ?? "en",
      hearingImpaired: Boolean(attrs.hearing_impaired),
      downloadRef: String(files[0]?.file_id ?? ""),
      releaseName: (attrs.release as string) || undefined,
    };
  });

  if (params.preferHearingImpaired) {
    results = [...results].sort(
      (a, b) => Number(b.hearingImpaired ?? false) - Number(a.hearingImpaired ?? false),
    );
  }

  return results;
}

export interface OpenSubtitlesLogin {
  token: string;
}

/** `POST /login` — required before `/download` works. */
export async function login(
  opts: OpenSubtitlesOptions = {},
): Promise<OpenSubtitlesLogin> {
  const apiKey = requireApiKey(opts.apiKey ?? process.env.OPENSUBTITLES_API_KEY);
  const username = opts.username ?? process.env.OPENSUBTITLES_USERNAME;
  const password = opts.password ?? process.env.OPENSUBTITLES_PASSWORD;
  if (!username || !password) {
    throw new Error(
      "mealtv: OPENSUBTITLES_USERNAME and OPENSUBTITLES_PASSWORD must both be " +
        "set to download from OpenSubtitles (search alone works with just " +
        "OPENSUBTITLES_API_KEY, but download requires logging in for a JWT). " +
        "Set both in your .env and retry.",
    );
  }

  const url = new URL((opts.baseUrl ?? OPENSUBTITLES_BASE) + "/login");
  const data = await fetchJson<Record<string, unknown>>(url, {
    fetchImpl: opts.fetchImpl,
    method: "POST",
    headers: {
      ...baseHeaders(opts, apiKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username, password }),
  });

  const token = data.token;
  if (typeof token !== "string" || !token) {
    throw new Error("mealtv: OpenSubtitles login response did not include a token");
  }
  return { token };
}

/**
 * `POST /download` with a `file_id`, then fetches the returned signed link.
 * `ref` is the `downloadRef` (`file_id`) from a `searchSubtitles` result.
 */
export async function downloadSubtitle(
  ref: string,
  opts: OpenSubtitlesOptions = {},
): Promise<string> {
  // UNTESTED AGAINST THE LIVE API — see module docstring.
  const apiKey = requireApiKey(opts.apiKey ?? process.env.OPENSUBTITLES_API_KEY);
  const { token } = await login(opts);

  const downloadUrl = new URL((opts.baseUrl ?? OPENSUBTITLES_BASE) + "/download");
  const data = await fetchJson<Record<string, unknown>>(downloadUrl, {
    fetchImpl: opts.fetchImpl,
    method: "POST",
    headers: {
      ...baseHeaders(opts, apiKey),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file_id: Number(ref) }),
  });

  const link = data.link;
  if (typeof link !== "string" || !link) {
    throw new Error("mealtv: OpenSubtitles download response did not include a link");
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(link);
  } catch (err) {
    throw new Error(
      `mealtv: OpenSubtitles file download failed for ${link}: ${(err as Error).message}`,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new HttpError(
      `mealtv: OpenSubtitles file download failed for ${link} with status ${res.status}`,
      res.status,
      text.slice(0, 300),
    );
  }
  return await res.text();
}

export const openSubtitlesProvider: SubtitleProvider = {
  name: "opensubtitles",
  searchSubtitles,
  downloadSubtitle,
};
