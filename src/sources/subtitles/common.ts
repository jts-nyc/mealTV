/**
 * Common interface every subtitle provider (`podnapisi.ts`, `subdl.ts`,
 * `opensubtitles.ts`) implements, so the CLI's `fetch-subtitles` command can
 * swap providers via a single `--source` flag without caring which one it's
 * talking to.
 *
 * Provider priority (documented in the CLI, not enforced here): Podnapisi
 * first (keyless, simplest), then SubDL (free key), then OpenSubtitles last
 * (needs an API key AND a JWT login, with a harsh 5-20 downloads/day free
 * quota) — see each provider module for details.
 */

export interface SubtitleSearchParams {
  tmdbId?: number;
  imdbId?: string;
  seasonNumber: number;
  episodeNumber: number;
  /** Free-text fallback (e.g. show title) for providers that can't search by id. */
  query?: string;
  /** ISO 639-1-ish language code. Defaults to "en" in each provider. */
  language?: string;
  /**
   * Prefer hearing-impaired/SDH tracks. Only SDH tracks reliably carry the
   * `[retching]`-style bracketed sound-effect cues the scanner
   * (`src/scanner/scan.ts`) looks for — a plain dialogue-only track can miss
   * everything. Providers that expose an HI/SDH flag should sort/filter
   * toward it when this is set; providers that don't expose the flag ignore it.
   */
  preferHearingImpaired?: boolean;
}

export interface SubtitleSearchResult {
  id: string;
  language: string;
  hearingImpaired?: boolean;
  /** Opaque value passed back into `downloadSubtitle`. Provider-specific — may
   * be a file id, a direct URL, or something else entirely. */
  downloadRef: string;
  releaseName?: string;
}

export interface SubtitleProvider {
  name: "podnapisi" | "subdl" | "opensubtitles";
  searchSubtitles(params: SubtitleSearchParams): Promise<SubtitleSearchResult[]>;
  downloadSubtitle(ref: string): Promise<string>;
}
