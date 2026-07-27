# mealTV

mealTV exists for one reason: to keep vomiting and gore scenes from ambushing
someone who's trying to eat dinner in front of the TV. It does two things:

1. **Before you press play** — a CLI pipeline builds a committed JSON catalog
   of content warnings per show/episode. Check an episode against the catalog
   before you start it, and you get a verdict: block, caution, reviewed-clear,
   or no data.
2. **While you're watching** — a static mobile web app (opened on your phone,
   next to the Google TV) runs a countdown synced to the episode, so it can
   warn you a few seconds before a flagged moment even if you're mid-bite and
   not watching the show's timeline.

There's no way to hook into a Google TV directly — it can't intercept
playback, read the video stream, or know what's currently on screen. The
phone app is a manual, best-effort companion: you tell it what you're
watching and roughly where you are, and it does the rest.

## Limitations — read this before trusting it

This is the most important section in this document. mealTV is a heuristic
tool built from incomplete data, not a certified content-safety system.

- **Timestamps come from scanning SDH (hearing-impaired) closed captions**
  for bracketed sound cues like `[retching]` or `[gags, vomits]`. This is a
  best-effort heuristic, not a real scan of the video:
  - It **misses** scenes that are visually obvious but silent or uncaptioned
    (no cue in the subtitle track means no warning, even if the scene is bad).
  - It can **false-alarm** when a character merely *says* something like "I
    think I'm gonna be sick" and nothing actually happens on screen. The
    scanner deliberately keeps these low-confidence dialogue mentions instead
    of silently dropping them — see `src/scanner/lexicon.ts` — because for
    the vomiting category specifically, a missed real scene is worse than an
    extra warning you can shrug off.
- **Timings drift.** A subtitle file's timestamps are tied to whatever cut it
  was authored against. The stream you're actually watching may have a
  different recap, different bumpers, or a slightly different frame rate, so
  the countdown can be off by a few seconds. This is why the phone app has
  manual resync controls — treat the timer as "close," not exact, and adjust
  as needed.
- **DoesTheDogDie (DTDD) crowd data is series-level, not per-episode.** The
  free tier tells you "this show has vomiting somewhere," not which episode
  or scene. mealTV folds that into the pre-play verdict (see below), but it
  can't drive the in-playback countdown, because there's no timestamp to
  drive it with.
- **Non-English content is effectively uncovered.** C-dramas, older Korean
  films, and similar are typically only available with plain translation
  subtitles — no bracketed SDH sound cues for the scanner to find — and DTDD
  has little to no crowd data on them either. For that content, the intended
  path is the phone app's self-logging feature: you flag it yourself the
  first time you watch, and `import-log` folds that into the catalog for next
  time.
- **No warning does not mean safe.** This is the single most important
  correctness property in the whole system, and it's enforced in the data
  model, not just the UI copy: an episode with zero warnings and no human
  review is tier `no-data` (grey) — "nobody has checked this" — which is a
  distinct, unmissable state from tier `reviewed-clear` (green) — "a human
  explicitly watched this episode and confirmed it's fine." Only
  `episode.reviewedClear === true` can ever produce a green verdict. See the
  design note at the top of `src/verdict/compute-verdict.ts` for the full
  rules, including how series/season-level crowd reports interact with a
  per-episode review.

## Setup

```bash
npm install
cp .env.example .env
```

Then fill in `.env` with the keys you actually want. None of them are
required to install or build — only specific commands need them:

| Variable | Needed for | Notes |
| --- | --- | --- |
| `TMDB_API_KEY` | `add-show` | Free, instant self-serve signup at [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api). Resolves show/season/episode metadata (titles, runtimes, TMDB ids). Get this one first — most other commands assume a show already has episodes scaffolded from TMDB. |
| `DTDD_API_KEY` | `fetch-dtdd` | Free signup at [doesthedogdie.com](https://www.doesthedogdie.com/). Pulls crowdsourced, series-level content-warning flags. |
| `SUBDL_API_KEY` | `fetch-subtitles --source subdl` | Optional. Free signup at [subdl.com](https://subdl.com/). |
| `OPENSUBTITLES_API_KEY`, `OPENSUBTITLES_USERNAME`, `OPENSUBTITLES_PASSWORD` | `fetch-subtitles --source opensubtitles` | Optional. Free signup at [opensubtitles.com](https://www.opensubtitles.com/en/consumers). Downloads require a logged-in account, not just an API key. |

`fetch-subtitles` defaults to Podnapisi, which needs no key at all.

**`scan-subtitles` and `curate` need no keys, no network, and no TMDB show
even set up beyond what's already in `catalog/`.** They're the fallback path
that always works: point `scan-subtitles` at a subtitle file you already have
on disk, or hand-author a warning with `curate add`.

## Usage

The CLI isn't published or globally linked — run it against the compiled
output: `npm run build` once (or any time `src/` changes), then
`node dist/cli/index.js <command>`. Below is a realistic end-to-end pass, in
the order you'd actually do it, with real flags (see `src/cli/commands/*.ts`
for the exact option parsing).

**1. Add a show.** Searches TMDB and scaffolds
`catalog/shows/<slug>.json` with every season/episode and runtime, zero
warnings.

```bash
node dist/cli/index.js add-show "Severance"
# or, to skip the search and pin an exact TMDB show:
node dist/cli/index.js add-show "Severance" --tmdb-id 95396
```

**2. Pull crowd flags.** Searches DoesTheDogDie by the show's title (or
`--dtdd-id`) and writes series-level warnings into `seriesWarnings`. Re-running
replaces previously-fetched DTDD warnings rather than duplicating them.

```bash
node dist/cli/index.js fetch-dtdd severance
```

**3. Scan a subtitle file you already have.** No network, no API key —
just a local `.srt`/`.vtt` file.

```bash
node dist/cli/index.js scan-subtitles severance --file ~/Downloads/severance.s01e01.en.sdh.srt --season 1 --episode 1
```

You can also point `--dir` at a folder of subtitle files; season/episode are
parsed from each filename's `SxxEyy` pattern:

```bash
node dist/cli/index.js scan-subtitles severance --dir ~/Downloads/severance-s01-subs/
```

**4. Curate a warning by hand.** For anything the scanner missed, or content
where you already know exactly what's in it.

```bash
node dist/cli/index.js curate add severance \
  --season 1 --episode 1 \
  --category vomiting --severity high --channel video \
  --start 18:42 --end 18:55 \
  --note "cold open, no SDH cue for it"
```

`--channel` defaults to `both`; `--confidence` defaults to `1` (hand-authored
entries are trusted). `--start`/`--end` accept `mm:ss`, `hh:mm:ss`, or raw
seconds.

**5. Mark an episode reviewed-clear.** The only path to a green verdict —
an explicit "a person watched this episode and it's fine" record.

```bash
node dist/cli/index.js curate clear severance --season 1 --episode 2
```

**6. Import self-logged entries from the phone.** The web app can export
what you flagged yourself while watching (useful for non-English content the
scanner and DTDD don't cover) as a JSON array of
`{ slug, season, episode, category, severity?, atSec, note? }`. Bad rows are
reported individually rather than aborting the whole import.

```bash
node dist/cli/index.js import-log ~/Downloads/mealtv-self-log.json
```

After any of the above, `catalog/index.json` is regenerated automatically. To
rebuild it by hand, or check the whole catalog against the schema:

```bash
npm run catalog:build-index   # regenerate catalog/index.json from catalog/shows/
npm run validate              # schema-validate every show file, per-show report
```

## Deploying to your phone

1. In the GitHub repo, go to **Settings → Pages → Source** and choose
   **GitHub Actions**.
2. Push to the branch this repo deploys from — `.github/workflows/deploy.yml`
   builds the web app (`npm run build:web`, output `web-dist/`) and publishes
   it via GitHub Pages on every push, or on demand via
   **Actions → Deploy to GitHub Pages → Run workflow**.
3. Open the published URL on your phone's browser and add it to your home
   screen, so it opens full-screen like an app.

**GitHub Pages on the free tier requires a public repository.** That means
`catalog/**` — the list of shows you watch and what's flagged in them — is
publicly visible. Nothing in there is sensitive, but it is a conscious
tradeoff: don't put anything in a warning's `note` field you wouldn't want
public.

## A note on subtitle files

Raw `.srt`/`.vtt` files are third-party copyrighted content and are
deliberately **not** committed — `.gitignore` excludes `subtitles/incoming/`.
Only the *derived* warning metadata (category, severity, timestamp fraction,
a short note) that `scan-subtitles`/`fetch-subtitles` extract from them ends
up in `catalog/`. If you re-clone this repo, you'll need to re-fetch or
re-supply subtitle files yourself to re-run a scan; the catalog itself
doesn't depend on having them around afterward.

## Project layout

```
src/
  cli/                commander CLI: src/cli/index.ts wires up each command
    commands/          one file per subcommand (add-show, fetch-dtdd, scan-subtitles,
                        fetch-subtitles, curate, import-log, validate, build-index)
    lib/                small shared helpers (env var checks, time parsing, option parsing)
  catalog/             reading/writing catalog/shows/*.json and catalog/index.json
  schema/              zod schema for the catalog data model (Show/Season/Episode/Warning) —
                        pure, no Node imports, shared with the web app
  scanner/             subtitle parsing + the lexicon-based content-warning scanner
  sources/             TMDB, DoesTheDogDie, and subtitle-provider (Podnapisi/SubDL/
                        OpenSubtitles) API clients
  verdict/             pre-play verdict logic (compute-verdict.ts, policy.ts) — also
                        pure/shared with the web app
web/                   static mobile web app source (built into web-dist/ for Pages)
scripts/               build/dev helper scripts
catalog/
  shows/               one committed JSON file per show
  index.json           generated compact summary of every show, rebuilt by build-index
fixtures/              sample subtitle files and API responses used by the test suite
test/                  vitest suite
.github/workflows/     ci.yml (typecheck/test/validate) and deploy.yml (GitHub Pages)
```

`web/` and `scripts/` are the static web app and its build tooling; `catalog/`
is the committed data. Both are actively evolving alongside this document —
if a path above looks stale, the source tree is the ground truth.
