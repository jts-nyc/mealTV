import type { Command } from "commander";
import { loadShow, saveShow } from "../../catalog/store.js";
import { writeIndex } from "../../catalog/build-index.js";
import { getMediaWarnings, searchItems } from "../../sources/dtdd.js";
import { requireEnv } from "../lib/env.js";

export function register(program: Command): void {
  program
    .command("fetch-dtdd <slug>")
    .description(
      "Search Does the Dog Die by the show's title (or use --dtdd-id) and write " +
        "mapped series-level warnings into seriesWarnings, replacing any previously-fetched " +
        "dtdd warnings rather than duplicating them",
    )
    .option(
      "--dtdd-id <id>",
      "Skip search and use this exact DTDD media id",
      (v: string) => Number.parseInt(v, 10),
    )
    .action(async (slug: string, options: { dtddId?: number }) => {
      requireEnv("DTDD_API_KEY", "fetch-dtdd");

      const show = loadShow(slug);

      let dtddId = options.dtddId ?? show.dtddId;
      if (!dtddId) {
        const results = await searchItems(show.title);
        if (results.length === 0) {
          throw new Error(
            `mealtv fetch-dtdd: no DTDD results found for "${show.title}" — pass --dtdd-id to specify one directly`,
          );
        }
        dtddId = results[0].id;
        console.log(`Matched DTDD item: "${results[0].name}" (dtdd id ${dtddId})`);
      }

      const warnings = await getMediaWarnings(dtddId);

      // Replace previously-fetched dtdd warnings rather than duplicating on re-run.
      const nonDtddWarnings = show.seriesWarnings.filter((w) => w.provenance.type !== "dtdd");
      show.seriesWarnings = [...nonDtddWarnings, ...warnings];
      show.dtddId = dtddId;

      saveShow(show);
      const { path: indexPath } = writeIndex();

      console.log(`Wrote ${warnings.length} DTDD warning(s) to catalog/shows/${slug}.json`);
      console.log(`Wrote ${indexPath}`);
    });
}
