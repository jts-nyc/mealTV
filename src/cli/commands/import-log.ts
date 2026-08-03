import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { z } from "zod";
import { findOrCreateEpisode, findOrCreateSeason, loadShow, saveShow, upsertEpisodeWarnings } from "../../catalog/store.js";
import { writeIndex } from "../../catalog/build-index.js";
import { CategorySchema, SeveritySchema, type Show, type Warning } from "../../schema/catalog.js";
import { clamp01 } from "../lib/time.js";

/**
 * Expected shape of one entry in a self-logged export from the web app.
 * Required: slug, season, episode, category, atSec. Optional: severity, note.
 */
const LogEntrySchema = z.object({
  slug: z.string().min(1, "slug is required"),
  season: z.number().int(),
  episode: z.number().int(),
  category: CategorySchema,
  severity: SeveritySchema.optional(),
  atSec: z.number().nonnegative(),
  note: z.string().optional(),
});
type LogEntry = z.infer<typeof LogEntrySchema>;

function formatIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

export function register(program: Command): void {
  program
    .command("import-log <file>")
    .description(
      "Ingest self-logged warnings exported from the web app: a JSON array of " +
        "{ slug, season, episode, category, severity?, atSec, note? }. Bad rows are " +
        "reported individually rather than aborting the whole import.",
    )
    .action((file: string) => {
      let raw: string;
      try {
        raw = readFileSync(file, "utf-8");
      } catch (err) {
        throw new Error(`mealtv import-log: failed to read ${file}: ${(err as Error).message}`);
      }

      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch (err) {
        throw new Error(`mealtv import-log: ${file} is not valid JSON: ${(err as Error).message}`);
      }

      if (!Array.isArray(data)) {
        throw new Error(`mealtv import-log: expected a top-level JSON array in ${file}`);
      }

      const showCache = new Map<string, Show>();
      const errors: string[] = [];
      let imported = 0;

      data.forEach((rawEntry, index) => {
        const parsed = LogEntrySchema.safeParse(rawEntry);
        if (!parsed.success) {
          errors.push(`entry ${index}: ${formatIssues(parsed.error.issues)}`);
          return;
        }
        const entry: LogEntry = parsed.data;

        try {
          let show = showCache.get(entry.slug);
          if (!show) {
            show = loadShow(entry.slug);
            showCache.set(entry.slug, show);
          }

          const season = findOrCreateSeason(show, entry.season);
          const episode = findOrCreateEpisode(season, entry.episode);
          const sourceDurationSec = episode.runtimeSec;
          const startFrac = sourceDurationSec
            ? clamp01(entry.atSec / sourceDurationSec)
            : undefined;

          const warning: Warning = {
            id: `self-logged-${randomUUID()}`,
            category: entry.category,
            severity: entry.severity ?? "medium",
            channel: "both",
            scope: "episode",
            startFrac,
            startSecAtSource: entry.atSec,
            sourceDurationSec,
            note: entry.note,
            suppressed: false,
            provenance: {
              type: "self-logged",
              confidence: 1,
              addedAt: new Date().toISOString(),
              detail: entry.note,
            },
          };

          upsertEpisodeWarnings(show, entry.season, entry.episode, [warning]);
          imported += 1;
        } catch (err) {
          errors.push(
            `entry ${index} (${entry.slug} S${entry.season}E${entry.episode}): ${(err as Error).message}`,
          );
        }
      });

      for (const show of showCache.values()) {
        saveShow(show);
      }
      if (showCache.size > 0) {
        const { path: indexPath } = writeIndex();
        console.log(`Wrote ${indexPath}`);
      }

      console.log(`Imported ${imported} of ${data.length} entr${data.length === 1 ? "y" : "ies"}.`);
      if (errors.length > 0) {
        console.log(`${errors.length} error(s):`);
        for (const err of errors) {
          console.log(`  ${err}`);
        }
        process.exitCode = 1;
      }
    });
}
