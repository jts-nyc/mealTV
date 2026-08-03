/**
 * DOM wiring for the Screening page (web/show.html): season/episode picker +
 * per-episode verdict. Not imported by tests — decision logic lives in the
 * pure modules it calls into (compute-verdict.ts, coverage.ts, labels.ts).
 */

import type { Season, Show, Warning } from "../../src/schema/catalog.js";
import { computeVerdict, effectiveEndSec, effectiveStartSec, type Verdict } from "../../src/verdict/compute-verdict.js";
import { loadShowBySlug } from "./catalog-client.js";
import { isPoorlyCovered } from "./coverage.js";
import { EPISODES_PER_PAGE } from "./constants.js";
import { CHANNEL_GLYPHS, CHANNEL_LABELS, categoryLabel, provenanceLabel } from "./labels.js";

const params = new URLSearchParams(location.search);
const slug = params.get("slug") ?? "";

const statusEl = document.getElementById("status") as HTMLElement;
const contentEl = document.getElementById("content") as HTMLElement;
const titleEl = document.getElementById("show-title") as HTMLElement;
const seasonTabsEl = document.getElementById("season-tabs") as HTMLElement;
const pagerEl = document.getElementById("pager") as HTMLElement;
const pageInfoEl = document.getElementById("page-info") as HTMLElement;
const prevPageBtn = document.getElementById("prev-page") as HTMLButtonElement;
const nextPageBtn = document.getElementById("next-page") as HTMLButtonElement;
const jumpForm = document.getElementById("jump-form") as HTMLFormElement;
const jumpInput = document.getElementById("jump-input") as HTMLInputElement;
const episodeListEl = document.getElementById("episode-list") as HTMLUListElement;

const verdictSectionEl = document.getElementById("verdict-section") as HTMLElement;
const verdictBannerEl = document.getElementById("verdict-banner") as HTMLElement;
const episodeWarningsEl = document.getElementById("episode-warnings") as HTMLElement;
const seriesSectionEl = document.getElementById("series-section") as HTMLElement;
const seriesWarningsEl = document.getElementById("series-warnings") as HTMLElement;
const coverageNoteEl = document.getElementById("coverage-note") as HTMLElement;
const watchLinkEl = document.getElementById("watch-link") as HTMLAnchorElement;

let show: Show | null = null;
let selectedSeasonNumber: number | null = null;
let selectedEpisodeNumber: number | null = null;
let page = 0;

const VERDICT_ICON: Record<Verdict["tier"], string> = {
  block: "⛔", // no entry
  caution: "⚠", // warning
  "reviewed-clear": "✓", // check
  "no-data": "?",
};

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function currentSeason(): Season | undefined {
  return show?.seasons.find((s) => s.seasonNumber === selectedSeasonNumber);
}

function renderSeasonTabs(): void {
  if (!show) return;
  seasonTabsEl.innerHTML = "";
  for (const season of show.seasons) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = `S${season.seasonNumber}`;
    btn.className = season.seasonNumber === selectedSeasonNumber ? "selected" : "";
    btn.addEventListener("click", () => {
      selectedSeasonNumber = season.seasonNumber;
      page = 0;
      renderSeasonTabs();
      renderEpisodeList();
    });
    seasonTabsEl.appendChild(btn);
  }
}

function renderEpisodeList(): void {
  const season = currentSeason();
  episodeListEl.innerHTML = "";
  if (!season) {
    pagerEl.hidden = true;
    jumpForm.hidden = true;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(season.episodes.length / EPISODES_PER_PAGE));
  page = Math.min(Math.max(page, 0), totalPages - 1);
  const start = page * EPISODES_PER_PAGE;
  const pageEpisodes = season.episodes.slice(start, start + EPISODES_PER_PAGE);

  const showPager = season.episodes.length > EPISODES_PER_PAGE;
  pagerEl.hidden = !showPager;
  jumpForm.hidden = !showPager;
  if (showPager) {
    pageInfoEl.textContent = `Episodes ${start + 1}–${start + pageEpisodes.length} of ${season.episodes.length}`;
    prevPageBtn.disabled = page === 0;
    nextPageBtn.disabled = page >= totalPages - 1;
  }

  for (const episode of pageEpisodes) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "episode-row" + (episode.episodeNumber === selectedEpisodeNumber ? " selected" : "");

    const num = document.createElement("span");
    num.className = "ep-num";
    num.textContent = `E${episode.episodeNumber}`;

    const title = document.createElement("span");
    title.className = "ep-title";
    title.textContent = episode.title ?? `Episode ${episode.episodeNumber}`;

    btn.appendChild(num);
    btn.appendChild(title);
    btn.addEventListener("click", () => selectEpisode(episode.episodeNumber));
    li.appendChild(btn);
    episodeListEl.appendChild(li);
  }
}

function renderWarningCard(w: Warning, runtimeSec: number | undefined): HTMLElement {
  const card = document.createElement("div");
  card.className = "warning-card";

  const row1 = document.createElement("div");
  row1.className = "row1";

  const category = document.createElement("span");
  category.className = "category";
  category.textContent = categoryLabel(w.category);
  row1.appendChild(category);

  const severity = document.createElement("span");
  severity.className = `severity-badge ${w.severity}`;
  severity.textContent = w.severity;
  row1.appendChild(severity);

  const channel = document.createElement("span");
  channel.className = "channel-icon";
  channel.textContent = CHANNEL_GLYPHS[w.channel];
  channel.title = CHANNEL_LABELS[w.channel];
  channel.setAttribute("aria-label", CHANNEL_LABELS[w.channel]);
  row1.appendChild(channel);

  card.appendChild(row1);

  const row2 = document.createElement("div");
  row2.className = "row2";

  const startSec = effectiveStartSec(w, runtimeSec);
  const endSec = effectiveEndSec(w, runtimeSec);
  if (startSec !== undefined) {
    const time = document.createElement("span");
    time.className = "time-range";
    time.textContent = endSec !== undefined ? `${formatTime(startSec)}–${formatTime(endSec)}` : `~${formatTime(startSec)}`;
    row2.appendChild(time);
  }

  const confidence = document.createElement("span");
  confidence.className = "confidence-badge";
  confidence.textContent = `${Math.round(w.provenance.confidence * 100)}% confidence`;
  row2.appendChild(confidence);

  const provenance = document.createElement("span");
  provenance.className = "provenance-tag";
  provenance.textContent = provenanceLabel(w.provenance.type);
  row2.appendChild(provenance);

  card.appendChild(row2);

  if (w.note) {
    const note = document.createElement("p");
    note.style.margin = "6px 0 0";
    note.style.fontSize = "0.85rem";
    note.textContent = w.note;
    card.appendChild(note);
  }

  return card;
}

/**
 * Some shows have series-level reports but zero catalogued episodes yet (a
 * real, current state — e.g. a DTDD sweep found series-wide warnings before
 * any season/episode data was added). Rather than showing a blank picker
 * with no explanation, surface what IS known (series warnings + the
 * coverage note) without pretending there's an episode to select.
 */
function renderNoEpisodesState(): void {
  if (!show) return;

  const emptyLi = document.createElement("li");
  emptyLi.className = "empty-state";
  emptyLi.textContent = "No episodes catalogued yet for this show.";
  episodeListEl.appendChild(emptyLi);

  verdictBannerEl.hidden = true;
  episodeWarningsEl.innerHTML = "";

  seriesWarningsEl.innerHTML = "";
  const seriesWarnings = show.seriesWarnings.filter((w) => !w.suppressed);
  if (seriesWarnings.length > 0) {
    seriesSectionEl.hidden = false;
    for (const w of seriesWarnings) {
      seriesWarningsEl.appendChild(renderWarningCard(w, undefined));
    }
  } else {
    seriesSectionEl.hidden = true;
  }

  if (isPoorlyCovered(show)) {
    coverageNoteEl.hidden = false;
    coverageNoteEl.textContent =
      "This title isn't well covered by automated sources yet (no episodes catalogued, no reports on record). " +
      "That means \"no data\", not \"clean\" — rely on your own judgment, and consider logging what you see.";
  } else {
    coverageNoteEl.hidden = false;
    coverageNoteEl.textContent =
      "No episodes are catalogued for this show yet, so there's no per-episode verdict or Watch-along mode " +
      "available. The reports above are everything known so far.";
  }

  const watchLinksEl = watchLinkEl.closest(".watch-links") as HTMLElement | null;
  if (watchLinksEl) watchLinksEl.hidden = true;

  verdictSectionEl.hidden = false;
}

function selectEpisode(episodeNumber: number): void {
  selectedEpisodeNumber = episodeNumber;
  renderEpisodeList();

  const season = currentSeason();
  const episode = season?.episodes.find((e) => e.episodeNumber === episodeNumber);
  if (!show || !season || !episode) {
    verdictSectionEl.hidden = true;
    return;
  }

  const verdict = computeVerdict(episode, show.seriesWarnings);

  verdictBannerEl.hidden = false;
  const watchLinksEl = watchLinkEl.closest(".watch-links") as HTMLElement | null;
  if (watchLinksEl) watchLinksEl.hidden = false;

  verdictBannerEl.className = `verdict-banner ${verdict.tier}`;
  verdictBannerEl.innerHTML = "";

  const headline = document.createElement("p");
  headline.className = "headline";
  const icon = document.createElement("span");
  icon.className = "icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = VERDICT_ICON[verdict.tier];
  headline.appendChild(icon);
  headline.appendChild(document.createTextNode(verdict.headline));
  verdictBannerEl.appendChild(headline);

  const detail = document.createElement("p");
  detail.className = "detail";
  detail.textContent = verdict.detail;
  verdictBannerEl.appendChild(detail);

  episodeWarningsEl.innerHTML = "";
  const episodeScopeWarnings = episode.warnings.filter((w) => !w.suppressed);
  if (episodeScopeWarnings.length > 0) {
    const label = document.createElement("p");
    label.className = "section-label";
    label.textContent = "This episode";
    episodeWarningsEl.appendChild(label);
    for (const w of episodeScopeWarnings) {
      episodeWarningsEl.appendChild(renderWarningCard(w, episode.runtimeSec));
    }
  }

  seriesWarningsEl.innerHTML = "";
  if (verdict.seriesLevelWarnings.length > 0) {
    seriesSectionEl.hidden = false;
    for (const w of verdict.seriesLevelWarnings) {
      seriesWarningsEl.appendChild(renderWarningCard(w, undefined));
    }
  } else {
    seriesSectionEl.hidden = true;
  }

  if (isPoorlyCovered(show)) {
    coverageNoteEl.hidden = false;
    coverageNoteEl.textContent =
      "This title isn't well covered by automated sources yet (no reviewed episodes, no reports on record). " +
      "That means \"no data\" here, not \"clean\" — rely on your own judgment, and consider logging what you see " +
      "during Watch-along so it's covered next time.";
  } else {
    coverageNoteEl.hidden = true;
  }

  watchLinkEl.href = `watch.html?slug=${encodeURIComponent(slug)}&season=${season.seasonNumber}&episode=${episode.episodeNumber}`;

  verdictSectionEl.hidden = false;
  verdictSectionEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

prevPageBtn.addEventListener("click", () => {
  page -= 1;
  renderEpisodeList();
});
nextPageBtn.addEventListener("click", () => {
  page += 1;
  renderEpisodeList();
});
jumpForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const season = currentSeason();
  if (!season) return;
  const n = Number(jumpInput.value);
  if (!Number.isFinite(n)) return;
  const idx = season.episodes.findIndex((ep) => ep.episodeNumber === n);
  if (idx === -1) return;
  page = Math.floor(idx / EPISODES_PER_PAGE);
  renderEpisodeList();
  selectEpisode(n);
});

async function init(): Promise<void> {
  if (!slug) {
    statusEl.textContent = "No show specified.";
    statusEl.className = "error-state";
    return;
  }

  try {
    show = await loadShowBySlug(slug);
  } catch (err) {
    statusEl.textContent = `Couldn't load this show: ${(err as Error).message}`;
    statusEl.className = "error-state";
    return;
  }

  titleEl.textContent = show.title;
  document.title = `mealTV — ${show.title}`;

  const requestedSeason = Number(params.get("season"));
  selectedSeasonNumber =
    show.seasons.find((s) => s.seasonNumber === requestedSeason)?.seasonNumber ??
    show.seasons[0]?.seasonNumber ??
    null;

  statusEl.hidden = true;
  contentEl.hidden = false;
  renderSeasonTabs();
  renderEpisodeList();

  const hasAnyEpisodes = show.seasons.some((s) => s.episodes.length > 0);
  if (!hasAnyEpisodes) {
    renderNoEpisodesState();
    return;
  }

  const requestedEpisode = Number(params.get("episode"));
  if (Number.isFinite(requestedEpisode) && currentSeason()?.episodes.some((e) => e.episodeNumber === requestedEpisode)) {
    selectEpisode(requestedEpisode);
  }
}

void init();
