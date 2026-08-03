/**
 * Builds the mealTV web app into `web-dist/`: a complete, self-contained
 * static site deployable to GitHub Pages as-is.
 *
 * What it does:
 *   1. Bundles each `web/src/*.ts` DOM entry point (main.ts, screen.ts,
 *      watch.ts, export-page.ts) with esbuild into `web-dist/src/*.js`
 *      (ESM, target modern browsers, minified unless run with --dev).
 *   2. Copies `web/*.html` and `web/style.css` to `web-dist/`.
 *   3. Copies `catalog/` (index.json + shows/*.json) into `web-dist/catalog/`
 *      so the app's runtime `fetch("catalog/...")` calls resolve relative to
 *      wherever the site is served from.
 *
 * Run via `npm run build:web` (see package.json), which invokes this file
 * directly with Node's native TypeScript support
 * (`node --experimental-strip-types`) — no extra build-of-the-build-script
 * step, no new devDependency.
 */

import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

const webDir = path.join(repoRoot, "web");
const webSrcDir = path.join(webDir, "src");
const catalogDir = path.join(repoRoot, "catalog");
const distDir = path.join(repoRoot, "web-dist");

const isDev = process.argv.includes("--dev");

/** DOM entry points only — the pure logic modules (alert-state.ts,
 * export-log.ts, etc.) are bundled in transitively via imports, they don't
 * get their own output file. */
const ENTRY_POINTS = ["main.ts", "screen.ts", "watch.ts", "export-page.ts"].map((f) =>
  path.join(webSrcDir, f),
);

function log(msg: string): void {
  console.log(`[build:web] ${msg}`);
}

async function main(): Promise<void> {
  if (!existsSync(webDir)) {
    throw new Error(`build-web: expected a web/ directory at ${webDir}`);
  }

  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });

  // 1. Bundle JS entry points.
  const result = await build({
    entryPoints: ENTRY_POINTS,
    bundle: true,
    format: "esm",
    target: ["es2022"],
    platform: "browser",
    outdir: path.join(distDir, "src"),
    minify: !isDev,
    sourcemap: isDev ? "inline" : false,
    logLevel: "info",
    metafile: true,
  });
  log(`bundled ${ENTRY_POINTS.length} entry point(s) into web-dist/src/ (${isDev ? "dev" : "production"} mode)`);

  // 2. Copy HTML pages + stylesheet, flat at the dist root (fetch() calls in
  // the app use root-relative paths like "catalog/index.json", so every page
  // must sit at the same directory depth).
  const htmlFiles = readdirSync(webDir).filter((f) => f.endsWith(".html"));
  if (htmlFiles.length === 0) {
    throw new Error("build-web: no .html files found in web/");
  }
  for (const file of htmlFiles) {
    cpSync(path.join(webDir, file), path.join(distDir, file));
  }
  log(`copied ${htmlFiles.length} HTML page(s): ${htmlFiles.join(", ")}`);

  const cssPath = path.join(webDir, "style.css");
  if (existsSync(cssPath)) {
    cpSync(cssPath, path.join(distDir, "style.css"));
    log("copied style.css");
  }

  // 2b. Copy the web app manifest + home-screen icons (favicon, apple-touch-icon,
  // maskable icon) so "Add to Home Screen" has a name/icon to install with.
  const PWA_ASSETS = ["manifest.webmanifest", "favicon.svg", "apple-touch-icon.png", "icon-512-maskable.png"];
  let copiedAssets = 0;
  for (const asset of PWA_ASSETS) {
    const src = path.join(webDir, asset);
    if (existsSync(src)) {
      cpSync(src, path.join(distDir, asset));
      copiedAssets++;
    } else {
      log(`WARNING: expected PWA asset not found: web/${asset}`);
    }
  }
  log(`copied ${copiedAssets}/${PWA_ASSETS.length} PWA asset(s) (manifest + icons)`);

  // 3. Copy the catalog JSON so runtime fetch("catalog/...") calls resolve.
  if (existsSync(catalogDir)) {
    cpSync(catalogDir, path.join(distDir, "catalog"), { recursive: true });
    log("copied catalog/ -> web-dist/catalog/");
  } else {
    log("WARNING: no catalog/ directory found — web-dist/catalog will be missing entirely");
  }

  log(`done. Output: ${path.relative(repoRoot, distDir)}/`);
  void result;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
