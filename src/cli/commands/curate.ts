import { randomUUID } from "node:crypto";
import type { Command } from "commander";
import {
  findOrCreateEpisode,
  findOrCreateSeason,
  loadShow,
  saveShow,
  upsertEpisodeWarnings,
} from "../../catalog/store.js";
import { writeIndex } from "../../catalog/build-index.js";
import {
  CategorySchema,
  ChannelSchema,
  SeveritySchema,
  type Category,
  type Channel,
  type Severity,
  type Warning,
} from "../../schema/catalog.js";
import { clamp01, parseTimeToSeconds } from "../lib/time.js";
import { parseIntOption } from "../lib/options.js";

function parseCategory(value: string): Category {
  const result = CategorySchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `mealtv curate add: invalid --category "${value}" — expected one of: ${CategorySchema.options.join(", ")}`,
    );
  }
  return result.data;
}

function parseSeverity(value: string): Severity {
  const result = SeveritySchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `mealtv curate add: invalid --severity "${value}" — expected one of: ${SeveritySchema.options.join(", ")}`,
    );
  }
  return result.data;
}

function parseChannel(value: string): Channel {
  const result = ChannelSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `mealtv curate add: invalid --channel "${value}" — expected one of: ${ChannelSchema.options.join(", ")}`,
    );
  }
  return result.data;
}

export function register(program: Command): void {
  const curate = program
    .command("curate")
    .description("Hand-authored curation of episode warnings (no network, no API key)");

  curate
    .command("add <slug>")
    .description("Add a hand-authored warning to one episode")
    .requiredOption("--season <n>", "season number", parseIntOption)
    .requiredOption("--episode <n>", "episode number", parseIntOption)
    .requiredOption("--category <category>", `one of: ${CategorySchema.options.join(", ")}`)
    .requiredOption("--severity <severity>", `one of: ${SeveritySchema.options.join(", ")}`)
    .option("--channel <channel>", `one of: ${ChannelSchema.options.join(", ")}`, "both")
    .option("--start <time>", "mm:ss, hh:mm:ss, or raw seconds")
    .option("--end <time>", "mm:ss, hh:mm:ss, or raw seconds")
    .option("--confidence <n>", "0-1, defaults to 1.0 (hand-authored is trusted)", "1")
    .option("--note <note>", "free-text note, also stored as provenance.detail")
    .action(
      (
        slug: string,
        options: {
          season: number;
          episode: number;
          category: string;
          severity: string;
          channel: string;
          start?: string;
          end?: string;
          confidence: string;
          note?: string;
        },
      ) => {
        const category = parseCategory(options.category);
        const severity = parseSeverity(options.severity);
        const channel = parseChannel(options.channel);

        const confidence = Number(options.confidence);
        if (Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
          throw new Error(
            `mealtv curate add: invalid --confidence "${options.confidence}" — expected a number between 0 and 1`,
          );
        }

        const show = loadShow(slug);
        const season = findOrCreateSeason(show, options.season);
        const episode = findOrCreateEpisode(season, options.episode);

        const startSecAtSource =
          options.start !== undefined ? parseTimeToSeconds(options.start) : undefined;
        const endSecAtSource =
          options.end !== undefined ? parseTimeToSeconds(options.end) : undefined;

        const hasTiming = startSecAtSource !== undefined || endSecAtSource !== undefined;
        const sourceDurationSec = hasTiming ? episode.runtimeSec : undefined;

        const startFrac =
          startSecAtSource !== undefined && sourceDurationSec
            ? clamp01(startSecAtSource / sourceDurationSec)
            : undefined;
        const endFrac =
          endSecAtSource !== undefined && sourceDurationSec
            ? clamp01(endSecAtSource / sourceDurationSec)
            : undefined;

        const warning: Warning = {
          id: `curated-${randomUUID()}`,
          category,
          severity,
          channel,
          scope: "episode",
          startFrac,
          endFrac,
          startSecAtSource,
          endSecAtSource,
          sourceDurationSec,
          note: options.note,
          suppressed: false,
          provenance: {
            type: "curated",
            confidence,
            addedAt: new Date().toISOString(),
            detail: options.note,
          },
        };

        upsertEpisodeWarnings(show, options.season, options.episode, [warning]);
        saveShow(show);
        const { path: indexPath } = writeIndex();

        console.log(
          `Added curated warning ${warning.id} (${category}/${severity}) to ${slug} S${options.season}E${options.episode}`,
        );
        console.log(`Wrote ${indexPath}`);
      },
    );

  curate
    .command("clear <slug>")
    .description('Mark an episode reviewedClear: true — the explicit "I watched this, it\'s fine" record')
    .requiredOption("--season <n>", "season number", parseIntOption)
    .requiredOption("--episode <n>", "episode number", parseIntOption)
    .action((slug: string, options: { season: number; episode: number }) => {
      const show = loadShow(slug);
      const season = findOrCreateSeason(show, options.season);
      const episode = findOrCreateEpisode(season, options.episode);
      episode.reviewedClear = true;

      saveShow(show);
      const { path: indexPath } = writeIndex();

      console.log(`Marked ${slug} S${options.season}E${options.episode} reviewedClear = true`);
      console.log(`Wrote ${indexPath}`);
    });
}
