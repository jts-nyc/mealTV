import type { Command } from "commander";
import { validateAll } from "../../catalog/validate.js";
import { getShowsDir } from "../../catalog/store.js";

export function register(program: Command): void {
  program
    .command("validate")
    .description(
      "Validate every show file in catalog/shows/ against the schema and print a per-show report",
    )
    .action(() => {
      const results = validateAll();

      if (results.length === 0) {
        console.log(`No show files found in ${getShowsDir()}.`);
        return;
      }

      let failures = 0;
      for (const result of results) {
        if (result.ok) {
          console.log(`  ok    ${result.slug}`);
        } else {
          failures += 1;
          console.log(`  FAIL  ${result.slug}`);
          for (const err of result.errors ?? []) {
            console.log(`          ${err}`);
          }
        }
      }

      console.log("");
      console.log(
        `${results.length} show(s) checked, ${results.length - failures} ok, ${failures} failed.`,
      );

      if (failures > 0) {
        process.exitCode = 1;
      }
    });
}
