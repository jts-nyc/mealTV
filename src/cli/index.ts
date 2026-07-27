#!/usr/bin/env node
/**
 * mealtv CLI entry point.
 *
 * Adding a new command later: create `src/cli/commands/<name>.ts` exporting a
 * `register(program: Command): void` that calls `program.command(...)`, then
 * add one line importing and calling it below, next to the existing commands.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import dotenv from "dotenv";
import { getRepoRoot } from "../catalog/store.js";
import { register as registerValidate } from "./commands/validate.js";
import { register as registerBuildIndex } from "./commands/build-index.js";
import { register as registerAddShow } from "./commands/add-show.js";
import { register as registerFetchDtdd } from "./commands/fetch-dtdd.js";
import { register as registerScanSubtitles } from "./commands/scan-subtitles.js";
import { register as registerFetchSubtitles } from "./commands/fetch-subtitles.js";
import { register as registerCurate } from "./commands/curate.js";
import { register as registerImportLog } from "./commands/import-log.js";

const repoRoot = getRepoRoot();

// Load .env from the repo root regardless of cwd. Silently no-ops if the file
// doesn't exist (e.g. a fresh checkout before `cp .env.example .env`).
dotenv.config({ path: path.join(repoRoot, ".env"), quiet: true });

const pkg = JSON.parse(
  readFileSync(path.join(repoRoot, "package.json"), "utf-8"),
) as { version?: string };

const program = new Command();

program
  .name("mealtv")
  .description(
    "mealTV: build and maintain a JSON catalog of TV content warnings " +
      "(vomiting/gore/etc.) so a static web app can help you avoid ambush " +
      "scenes while eating dinner in front of the TV.",
  )
  .version(pkg.version ?? "0.0.0");

registerValidate(program);
registerBuildIndex(program);
registerAddShow(program);
registerFetchDtdd(program);
registerScanSubtitles(program);
registerFetchSubtitles(program);
registerCurate(program);
registerImportLog(program);

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
