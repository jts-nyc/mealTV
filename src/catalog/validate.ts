/**
 * Validates every show file in `catalog/shows/` against the schema.
 */

import { readFileSync } from "node:fs";
import { safeParseShow } from "../schema/catalog.js";
import { getShowsDir, listShowSlugs, showPath } from "./store.js";

export interface ShowValidationResult {
  slug: string;
  ok: boolean;
  /** Human-readable `path: message` strings, present only when `ok` is false. */
  errors?: string[];
}

/**
 * Loads and schema-validates every `*.json` file in `catalog/shows/`. Does NOT
 * throw on a bad file — each failure is captured as its own result entry so a
 * single corrupt file doesn't stop the report.
 */
export function validateAll(): ShowValidationResult[] {
  const slugs = listShowSlugs();
  return slugs.map((slug) => validateOne(slug));
}

function validateOne(slug: string): ShowValidationResult {
  const file = showPath(slug);

  let raw: string;
  try {
    raw = readFileSync(file, "utf-8");
  } catch (err) {
    return { slug, ok: false, errors: [`(file): failed to read: ${(err as Error).message}`] };
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return { slug, ok: false, errors: [`(file): invalid JSON: ${(err as Error).message}`] };
  }

  const result = safeParseShow(data);
  if (result.success) {
    return { slug, ok: true };
  }

  const errors = result.error.issues.map(
    (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
  );
  return { slug, ok: false, errors };
}

/** Re-exported for callers that want the directory being scanned (e.g. CLI output). */
export { getShowsDir };
