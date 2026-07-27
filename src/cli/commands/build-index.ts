import type { Command } from "commander";
import { writeIndex } from "../../catalog/build-index.js";

export function register(program: Command): void {
  program
    .command("build-index")
    .description(
      "Regenerate catalog/index.json from every show file in catalog/shows/",
    )
    .action(() => {
      const { path: indexPath, entries } = writeIndex();

      console.log(`Wrote ${indexPath}`);
      console.log(`${entries.length} show(s) indexed.`);
      for (const entry of entries) {
        const flag = entry.hasVomiting ? "[vomiting]" : "";
        console.log(
          `  ${entry.slug}: ${entry.seasonCount} season(s), ${entry.episodeCount} episode(s), ${entry.warningCount} warning(s) ${flag}`,
        );
      }
    });
}
