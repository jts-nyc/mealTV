import type { Command } from "commander";
import type { Episode, Season, Show } from "../../schema/catalog.js";
import { saveShow, slugify } from "../../catalog/store.js";
import { writeIndex } from "../../catalog/build-index.js";
import { getShow, getSeason, searchTv } from "../../sources/tmdb.js";
import { requireEnv } from "../lib/env.js";

export function register(program: Command): void {
  program
    .command("add-show <title>")
    .description(
      "Search TMDB for a show and scaffold catalog/shows/<slug>.json with all " +
        "seasons/episodes and runtimes, zero warnings",
    )
    .option(
      "--tmdb-id <id>",
      "Skip search and use this exact TMDB tv show id",
      (v: string) => Number.parseInt(v, 10),
    )
    .action(async (title: string, options: { tmdbId?: number }) => {
      requireEnv("TMDB_API_KEY", "add-show");

      let tmdbId = options.tmdbId;
      if (!tmdbId) {
        const results = await searchTv(title);
        if (results.length === 0) {
          throw new Error(`mealtv add-show: no TMDB results found for "${title}"`);
        }
        tmdbId = results[0].tmdbId;
        console.log(`Matched TMDB show: "${results[0].name}" (tmdb id ${tmdbId})`);
        if (results.length > 1) {
          console.log(
            `  (${results.length - 1} other candidate(s) found — pass --tmdb-id to pick a different one)`,
          );
        }
      }

      const tmdbShow = await getShow(tmdbId);
      const slug = slugify(tmdbShow.name);

      const seasons: Season[] = [];
      for (const s of tmdbShow.seasons) {
        const tmdbEpisodes = await getSeason(tmdbId, s.seasonNumber);
        const episodes: Episode[] = tmdbEpisodes.map((e) => ({
          episodeNumber: e.episodeNumber,
          title: e.name || undefined,
          tmdbId: e.tmdbId,
          runtimeSec: e.runtimeSec,
          reviewedClear: false,
          warnings: [],
        }));
        seasons.push({ seasonNumber: s.seasonNumber, episodes });
      }

      const show: Show = {
        slug,
        title: tmdbShow.name,
        tmdbId: tmdbShow.tmdbId,
        seriesWarnings: [],
        seasons,
      };

      saveShow(show);
      const { path: indexPath } = writeIndex();

      const episodeCount = seasons.reduce((n, s) => n + s.episodes.length, 0);
      console.log(`Created catalog/shows/${slug}.json`);
      console.log(`  ${seasons.length} season(s), ${episodeCount} episode(s)`);
      console.log(`Wrote ${indexPath}`);
    });
}
