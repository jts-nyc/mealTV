import type { Command } from "commander";
import { loadShow, saveShow, upsertEpisodeWarnings } from "../../catalog/store.js";
import { writeIndex } from "../../catalog/build-index.js";
import { scanSubtitles } from "../../scanner/scan.js";
import { podnapisiProvider } from "../../sources/subtitles/podnapisi.js";
import { subdlProvider } from "../../sources/subtitles/subdl.js";
import { openSubtitlesProvider } from "../../sources/subtitles/opensubtitles.js";
import type { SubtitleProvider } from "../../sources/subtitles/common.js";
import { requireEnv } from "../lib/env.js";
import { parseIntOption } from "../lib/options.js";

/** Priority order: Podnapisi (keyless) -> SubDL (free key) -> OpenSubtitles (key + login, harsh quota). */
const PROVIDERS: Record<string, SubtitleProvider> = {
  podnapisi: podnapisiProvider,
  subdl: subdlProvider,
  opensubtitles: openSubtitlesProvider,
};

const REQUIRED_ENV: Record<string, string | undefined> = {
  podnapisi: undefined,
  subdl: "SUBDL_API_KEY",
  opensubtitles: "OPENSUBTITLES_API_KEY",
};

export function register(program: Command): void {
  program
    .command("fetch-subtitles <slug>")
    .description(
      "Fetch a subtitle file from a provider (Podnapisi by default) then run the " +
        "same offline scan as scan-subtitles, upserting the resulting warnings",
    )
    .requiredOption("--season <n>", "season number", parseIntOption)
    .requiredOption("--episode <n>", "episode number", parseIntOption)
    .option(
      "--source <name>",
      "podnapisi|subdl|opensubtitles",
      "podnapisi",
    )
    .option(
      "--hearing-impaired",
      "prefer hearing-impaired/SDH tracks — only SDH reliably carries the " +
        "[retching]-style bracketed cues the scanner looks for",
    )
    .action(
      async (
        slug: string,
        options: { season: number; episode: number; source: string; hearingImpaired?: boolean },
      ) => {
        const provider = PROVIDERS[options.source];
        if (!provider) {
          throw new Error(
            `mealtv fetch-subtitles: unknown --source "${options.source}", expected one of: ` +
              `${Object.keys(PROVIDERS).join(", ")}`,
          );
        }
        const requiredEnvVar = REQUIRED_ENV[options.source];
        if (requiredEnvVar) {
          requireEnv(requiredEnvVar, "fetch-subtitles");
        }

        const show = loadShow(slug);

        const results = await provider.searchSubtitles({
          tmdbId: show.tmdbId,
          seasonNumber: options.season,
          episodeNumber: options.episode,
          query: show.title,
          language: "en",
          preferHearingImpaired: options.hearingImpaired,
        });

        if (results.length === 0) {
          throw new Error(
            `mealtv fetch-subtitles: no subtitles found via ${options.source} for ${slug} ` +
              `S${options.season}E${options.episode}`,
          );
        }

        const chosen = options.hearingImpaired
          ? (results.find((r) => r.hearingImpaired) ?? results[0])
          : results[0];

        const content = await provider.downloadSubtitle(chosen.downloadRef);
        const warnings = scanSubtitles(content, {
          filename: `${options.source}:${chosen.id}${chosen.releaseName ? ` (${chosen.releaseName})` : ""}`,
        });

        upsertEpisodeWarnings(show, options.season, options.episode, warnings);
        saveShow(show);
        const { path: indexPath } = writeIndex();

        console.log(
          `Fetched subtitle from ${options.source} (id ${chosen.id}): ${warnings.length} warning(s) ` +
            `for S${options.season}E${options.episode}`,
        );
        console.log(`Wrote ${indexPath}`);
      },
    );
}
