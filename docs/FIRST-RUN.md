# First run

The ordered, copy-pasteable path from a fresh clone to using mealTV at
dinner tonight. This is not the reference manual — see
[`README.md`](../README.md) for the full flag tables, the data model, and the
limitations section (read that one eventually; it explains what this tool
can't do).

## Step 0 — make the repo public, enable Pages

GitHub Pages on the free plan requires a public repository. Do this first,
before anything else, or the deploy workflow will just fail.

1. **Settings → General → Danger Zone → Change repository visibility → Public.**
2. **Settings → Pages → Source → GitHub Actions.**
3. **Actions → "Deploy to GitHub Pages" → Run workflow.**

Being honest about the tradeoff: making the repo public means `catalog/**` —
the shows you watch and what's flagged in them — is publicly readable.
Nothing about that is sensitive by default, but it means you should never put
anything private in a warning's `note` field.

Step 2 is not optional and cannot be automated. The workflow has no way to
turn Pages on for you — creating a Pages site needs permissions the Actions
token doesn't have — so if you skip it the deploy just skips itself with a
warning and no site ever appears. Once it's set, every push to `main`
deploys automatically and you won't need to run the workflow by hand again.

A gotcha worth knowing: because the deploy step is deliberately
non-blocking, a run where Pages isn't configured still shows up **green**.
If the site isn't updating, open the newest "Deploy to GitHub Pages" run and
check whether the `deploy` job actually ran or was skipped.

## Step 1 — put it on your phone

Open the published Pages URL in your phone's browser, then **Add to Home
Screen**. It opens full-screen, like an app. The catalog is baked into the
build, so once it's loaded it works offline — no connection needed at the
dinner table.

## Step 2 — try it before signing up for anything

The catalog already ships with one fully-worked example: **Shrinking, Season
1, Episode 6**. Open it in Screen mode first — you should see a **block**
verdict for vomiting. Then open the same episode in Watch-along mode and tap
START to feel the countdown and the warning fire.

Everything else currently in the catalog is thinner than this — see Step 4
for what that means for your shows.

## Step 3 — two keys, ten minutes

```bash
npm install
cp .env.example .env
```

Get these two keys and drop them into `.env`:

- **TMDB** — instant, free self-serve signup at
  [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api).
  Get this first; `add-show` needs it to scaffold a show's seasons and
  episodes.
- **DoesTheDogDie** — free signup at
  [doesthedogdie.com](https://www.doesthedogdie.com/). Gets you crowdsourced,
  series-level warnings.

Skip SubDL and OpenSubtitles for now. `fetch-subtitles` defaults to
Podnapisi, which needs no key at all, and that's enough to get started.
OpenSubtitles in particular has the worst effort-to-value ratio of the three
— it needs a full login flow (not just an API key) and caps free accounts at
5–20 downloads a day.

Build the CLI once (and again any time you pull changes to `src/`):

```bash
npm run build
```

The CLI isn't globally installed — every command below is
`node dist/cli/index.js <command>`.

## Step 4 — your shows: three different paths

Not every show gets the same treatment. Figure out which bucket your show is
in before you start.

### Path A — the full pipeline works

Ted Lasso, Silo, Shrinking, Tehran, Rick and Morty, Futurama are all English
with SDH subtitle tracks available, so the full automated pipeline applies:

```bash
node dist/cli/index.js add-show "Rick and Morty"
node dist/cli/index.js fetch-dtdd rick-and-morty
node dist/cli/index.js fetch-subtitles rick-and-morty --season 1 --episode 1 --hearing-impaired
```

Always pass `--hearing-impaired` to `fetch-subtitles`. Only SDH tracks carry
the bracketed `[retching]`-style cues the scanner looks for — a plain
dialogue track will usually get you zero hits, silently.

**Highest-value target here: Rick and Morty.** Research found recurring
gross-out and body horror scattered throughout the show, not confined to a
couple of episodes — this is the show most worth running the full pipeline
across every episode of.

### Path B — same pipeline, just bulky

Murdoch Mysteries has 18+ seasons and 300+ episodes — recurring autopsy
scenes, though how graphic they get is unverified. Don't run
`fetch-subtitles` one episode at a time for that. If you've got a folder of
subtitle files for a season, point `scan-subtitles` at the directory instead;
it parses season/episode straight from each filename's `SxxEyy` pattern:

```bash
node dist/cli/index.js scan-subtitles murdoch-mysteries --dir ~/Downloads/murdoch-s01-subs/
```

### Path C — the pipeline cannot help

C-dramas on iQiyi and older Son Ye Jin Korean films fall outside what any of
this can automate. Their English tracks are plain translation subtitles —
there are no bracketed SDH sound cues for the scanner to find, so there's
literally no signal to scan. DoesTheDogDie also has little to no crowd data
on this kind of content.

This isn't a gap you work around — it's the case Watch-along mode was built
for. Tap the log button when something happens, export the log from the
phone, then:

```bash
node dist/cli/index.js import-log ~/Downloads/mealtv-self-log.json
```

You only have to do this once per episode. Every rewatch after that is
protected, same as any other show in the catalog.

## Step 5 — three things to remember

- **Grey ("no data") does not mean safe.** It means nobody has checked yet.
  The only way an episode goes green is a person explicitly marking it
  reviewed-clear.
- **The countdown drifts.** Subtitle timings are tied to whatever cut the
  subtitle file was authored against — recaps, bumpers, and frame rates
  differ. Use the phone app's ±5-second resync buttons when it's off.
- **`curate clear` is the only path to green:**

  ```bash
  node dist/cli/index.js curate clear <slug> --season <n> --episode <n>
  ```

  Nothing else — not a clean scan, not silence from DTDD — marks an episode
  safe on its own.

## Two things to know about the seeded data

`add-show` is what scaffolds a show's full season/episode list with
runtimes. The shows already in `catalog/` only have the specific episodes
that research flagged — not a complete season list — so don't be surprised
to open a show and find most episodes missing. Run `add-show` with your TMDB
key to fill that in properly.

Also: two shows were ambiguous enough that both candidates got seeded —
Cape Fear (the 1991 film and the 2026 Apple TV+ series) and Ride or Die (the
2021 Japanese Netflix film and the 2026 Prime series). Delete whichever one
isn't the one you actually watch.

For everything else — the full command reference, the data model, why the
scanner works the way it does — see [`README.md`](../README.md).
