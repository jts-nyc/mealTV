/**
 * Fully offline, no network, no API key. This is the fallback that always
 * works: given a local .srt/.vtt file (however it got onto disk), run the
 * lexicon scanner and upsert the resulting warnings.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { loadShow, saveShow, upsertEpisodeWarnings } from "../../catalog/store.js";
import { writeIndex } from "../../catalog/build-index.js";
import { scanSubtitles } from "../../scanner/scan.js";
import type { Warning } from "../../schema/catalog.js";
import { parseIntOption } from "../lib/options.js";

const SXXEYY_RE = /[sS](\d{1,2})[eE](\d{1,3})/;
const SUBTITLE_EXT_RE = /\.(srt|vtt)$/i;

function scanFile(filePath: string): Warning[] {
  const content = readFileSync(filePath, "utf-8");
  return scanSubtitles(content, { filename: path.basename(filePath) });
}

export function register(program: Command): void {
  program
    .command("scan-subtitles <slug>")
    .description(
      "Scan a local .srt/.vtt file (or a directory of them) for content-warning " +
        "cues and upsert the results onto the matching episode(s). No network, no API key.",
    )
    .option("--season <n>", "season number (required with --file)", parseIntOption)
    .option("--episode <n>", "episode number (required with --file)", parseIntOption)
    .option("--file <path>", "path to a single .srt/.vtt file")
    .option(
      "--dir <path>",
      "directory of .srt/.vtt files; season/episode are parsed from each filename's SxxEyy",
    )
    .action(
      (
        slug: string,
        options: { season?: number; episode?: number; file?: string; dir?: string },
      ) => {
        const show = loadShow(slug);

        if (options.file) {
          if (options.season == null || options.episode == null) {
            throw new Error(
              "mealtv scan-subtitles: --season and --episode are required when using --file",
            );
          }
          const warnings = scanFile(options.file);
          upsertEpisodeWarnings(show, options.season, options.episode, warnings);
          console.log(
            `Scanned ${options.file}: ${warnings.length} warning(s) for S${options.season}E${options.episode}`,
          );
        } else if (options.dir) {
          const files = readdirSync(options.dir).filter((f) => SUBTITLE_EXT_RE.test(f));
          let scannedCount = 0;
          let skippedCount = 0;
          let totalWarnings = 0;

          for (const file of files) {
            const match = SXXEYY_RE.exec(file);
            if (!match) {
              skippedCount += 1;
              console.log(`  skip (no SxxEyy in filename): ${file}`);
              continue;
            }
            const season = Number.parseInt(match[1], 10);
            const episode = Number.parseInt(match[2], 10);
            const fullPath = path.join(options.dir, file);
            const warnings = scanFile(fullPath);
            upsertEpisodeWarnings(show, season, episode, warnings);
            scannedCount += 1;
            totalWarnings += warnings.length;
            console.log(`  S${season}E${episode} <- ${file}: ${warnings.length} warning(s)`);
          }

          console.log(
            `Scanned ${scannedCount} file(s), skipped ${skippedCount}, ${totalWarnings} warning(s) total.`,
          );
        } else {
          throw new Error(
            "mealtv scan-subtitles: provide either --file <path> (with --season/--episode) or --dir <path>",
          );
        }

        saveShow(show);
        const { path: indexPath } = writeIndex();
        console.log(`Wrote ${indexPath}`);
      },
    );
}
