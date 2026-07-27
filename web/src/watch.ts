/**
 * DOM wiring for Watch-along mode (web/watch.html) — the centerpiece of the
 * app. All timing/decision logic is delegated to the pure `alert-state.ts`
 * module; this file is purely: read the wall clock, call that module, paint
 * the result, and fire whatever alerts (vibration/flash/beep) the state
 * transition calls for.
 *
 * Not imported by tests (uses `document`, `localStorage`, `navigator`,
 * `Date.now()` directly) — see alert-state.test coverage in test/web-watch.test.ts
 * for the logic this drives.
 */

import type { Category } from "../../src/schema/catalog.js";
import { computeAlertState, resolveWarningWindows, type AlertStateResult } from "./alert-state.js";
import { loadShowBySlug } from "./catalog-client.js";
import { createLoggedEntry, type LoggedEntry } from "./export-log.js";
import {
  addLogEntry,
  getLeadTimeSec,
  getResyncOffset,
  getSoundEnabled,
  setLeadTimeSec,
  setResyncOffset,
  setSoundEnabled,
} from "./storage.js";
import { FLASH_REPEAT_COUNT, RESYNC_STEP_SEC, TICK_INTERVAL_MS } from "./constants.js";

const params = new URLSearchParams(location.search);
const slug = params.get("slug") ?? "";
const seasonNumber = Number(params.get("season"));
const episodeNumber = Number(params.get("episode"));

const statusEl = document.getElementById("status") as HTMLElement;
const contentEl = document.getElementById("content") as HTMLElement;
const episodeTitleEl = document.getElementById("episode-title") as HTMLElement;
const episodeSummaryEl = document.getElementById("episode-summary") as HTMLElement;
const backLinkEl = document.getElementById("back-link") as HTMLAnchorElement;
const startScreenEl = document.getElementById("start-screen") as HTMLElement;
const startButtonEl = document.getElementById("start-button") as HTMLButtonElement;
const runningScreenEl = document.getElementById("running-screen") as HTMLElement;
const noTimerBannerEl = document.getElementById("no-timer-banner") as HTMLElement;
const alertStageEl = document.getElementById("alert-stage") as HTMLElement;
const stateLineEl = document.getElementById("state-line") as HTMLElement;
const subLineEl = document.getElementById("sub-line") as HTMLElement;
const elapsedReadoutEl = document.getElementById("elapsed-readout") as HTMLElement;
const flashOverlayEl = document.getElementById("flash-overlay") as HTMLElement;
const resyncMinusBtn = document.getElementById("resync-minus") as HTMLButtonElement;
const resyncPlusBtn = document.getElementById("resync-plus") as HTMLButtonElement;
const offsetReadoutEl = document.getElementById("offset-readout") as HTMLElement;
const soundToggleEl = document.getElementById("sound-toggle") as HTMLInputElement;
const leadTimeMinusBtn = document.getElementById("lead-time-minus") as HTMLButtonElement;
const leadTimePlusBtn = document.getElementById("lead-time-plus") as HTMLButtonElement;
const leadTimeReadoutEl = document.getElementById("lead-time-readout") as HTMLElement;
const logThisBtn = document.getElementById("log-this-button") as HTMLButtonElement;
const logCategoryPickerEl = document.getElementById("log-category-picker") as HTMLElement;
const logConfirmationEl = document.getElementById("log-confirmation") as HTMLElement;

let resyncOffsetSec = 0;
let leadTimeSec = getLeadTimeSec();
let startMs: number | null = null;
// Typed as `number` (not `ReturnType<typeof setInterval>`) deliberately: with
// both @types/node and DOM lib in scope, `setInterval`'s inferred return type
// is ambiguous between the two — this always runs in a browser, where
// window.setInterval concretely returns a number.
let tickHandle: number | null = null;
let previousState: AlertStateResult["state"] | null = null;
let safeNowUntilMs = 0;
let pendingLogElapsedSec: number | null = null;
let audioCtx: AudioContext | null = null;

function formatClock(sec: number): string {
  const clamped = Math.max(0, Math.round(sec));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function ensureAudioContext(): AudioContext | null {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

function playBeep(freq: number, durationMs: number): void {
  if (!getSoundEnabled()) return;
  const ctx = ensureAudioContext();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = freq;
  osc.type = "square";
  gain.gain.value = 0.15;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + durationMs / 1000);
}

function vibrate(pattern: number | number[]): void {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    // iOS Safari doesn't implement this — the flash + beep below are the
    // primary alert there, not a fallback afterthought.
    navigator.vibrate(pattern);
  }
}

function flash(): void {
  flashOverlayEl.classList.remove("flashing");
  // Force reflow so re-adding the class restarts the animation.
  void flashOverlayEl.offsetWidth;
  flashOverlayEl.classList.add("flashing");
  window.setTimeout(() => flashOverlayEl.classList.remove("flashing"), 600 * FLASH_REPEAT_COUNT);
}

function fireAlert(intensity: "incoming" | "active"): void {
  flash();
  if (intensity === "incoming") {
    vibrate([120, 80, 120]);
    playBeep(880, 180);
  } else {
    vibrate([200, 100, 200, 100, 200]);
    playBeep(660, 260);
  }
}

interface EpisodeContext {
  title: string;
  runtimeSec: number | undefined;
  windows: ReturnType<typeof resolveWarningWindows>;
  hasTimed: boolean;
}

let ctx: EpisodeContext | null = null;

function renderOffset(): void {
  const sign = resyncOffsetSec > 0 ? "+" : "";
  offsetReadoutEl.textContent = `offset: ${sign}${resyncOffsetSec}s`;
}

function renderAlertStage(result: AlertStateResult, elapsedSec: number): void {
  elapsedReadoutEl.textContent = `Elapsed: ${formatClock(elapsedSec)}`;

  const now = Date.now();
  if (now < safeNowUntilMs) {
    alertStageEl.className = "alert-stage safe-now";
    stateLineEl.textContent = "Safe now";
    subLineEl.textContent = "That scene has passed.";
    return;
  }

  if (result.state === "active" && result.warning) {
    alertStageEl.className = "alert-stage active";
    stateLineEl.textContent = `LOOK AWAY — ${result.warning.category.replace(/_/g, " ")} now`;
    const endsIn = result.secUntilEnd ?? 0;
    subLineEl.textContent = `${result.endIsEstimated ? "~" : ""}Safe again in ${formatClock(endsIn)}`;
    return;
  }

  if (result.state === "incoming" && result.warning) {
    alertStageEl.className = "alert-stage incoming";
    const inSec = Math.ceil(result.secUntilStart ?? 0);
    stateLineEl.textContent = `LOOK AWAY — ${result.warning.category.replace(/_/g, " ")} in ${inSec}s`;
    subLineEl.textContent = "Get ready to look away from the screen.";
    return;
  }

  alertStageEl.className = "alert-stage clear";
  stateLineEl.textContent = "All clear";
  subLineEl.textContent =
    result.warning && result.secUntilStart !== null
      ? `Next: ${result.warning.category.replace(/_/g, " ")} in about ${formatClock(result.secUntilStart)}`
      : "Nothing known coming up.";
}

function tick(): void {
  if (!ctx || startMs === null) return;
  const elapsedSec = (Date.now() - startMs) / 1000;

  if (!ctx.hasTimed) {
    elapsedReadoutEl.textContent = `Elapsed: ${formatClock(elapsedSec)}`;
    return;
  }

  const result = computeAlertState(elapsedSec, ctx.windows, { leadTimeSec, resyncOffsetSec });

  if (previousState !== "incoming" && result.state === "incoming") {
    fireAlert("incoming");
  } else if (previousState !== "active" && result.state === "active") {
    fireAlert("active");
  } else if (previousState === "active" && result.state === "clear") {
    safeNowUntilMs = Date.now() + 3000;
  }
  previousState = result.state;

  renderAlertStage(result, elapsedSec);
}

function start(): void {
  startMs = Date.now();
  startScreenEl.hidden = true;
  runningScreenEl.hidden = false;
  // First user gesture on this page — safe to initialize WebAudio now.
  ensureAudioContext();
  if (tickHandle) window.clearInterval(tickHandle);
  tickHandle = window.setInterval(tick, TICK_INTERVAL_MS);
  tick();
}

function adjustResync(deltaSec: number): void {
  resyncOffsetSec += deltaSec;
  setResyncOffset(slug, seasonNumber, episodeNumber, resyncOffsetSec);
  renderOffset();
}

function renderLeadTime(): void {
  leadTimeReadoutEl.textContent = `lead time: ${leadTimeSec}s`;
}

function adjustLeadTime(deltaSec: number): void {
  leadTimeSec = Math.max(5, leadTimeSec + deltaSec);
  setLeadTimeSec(leadTimeSec);
  renderLeadTime();
}

function showLogConfirmation(entry: LoggedEntry): void {
  logConfirmationEl.hidden = false;
  logConfirmationEl.textContent = `Logged ${entry.category.replace(/_/g, " ")} at ${formatClock(entry.atSec)}.`;
  window.setTimeout(() => {
    logConfirmationEl.hidden = true;
  }, 4000);
}

function wireLogging(): void {
  logThisBtn.addEventListener("click", () => {
    if (startMs === null) return;
    pendingLogElapsedSec = (Date.now() - startMs) / 1000;
    logCategoryPickerEl.hidden = false;
    logConfirmationEl.hidden = true;
    vibrate(40);
  });

  for (const btn of Array.from(logCategoryPickerEl.querySelectorAll<HTMLButtonElement>("button[data-category]"))) {
    btn.addEventListener("click", () => {
      if (pendingLogElapsedSec === null) return;
      const category = btn.dataset.category as Category;
      const entry = createLoggedEntry({
        id: crypto.randomUUID ? crypto.randomUUID() : `log-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        slug,
        season: seasonNumber,
        episode: episodeNumber,
        elapsedSec: pendingLogElapsedSec,
        category,
      });
      addLogEntry(entry);
      showLogConfirmation(entry);
      logCategoryPickerEl.hidden = true;
      pendingLogElapsedSec = null;
    });
  }
}

async function init(): Promise<void> {
  if (!slug || !Number.isFinite(seasonNumber) || !Number.isFinite(episodeNumber)) {
    statusEl.textContent = "Missing show/season/episode in the link.";
    statusEl.className = "error-state";
    return;
  }

  let show;
  try {
    show = await loadShowBySlug(slug);
  } catch (err) {
    statusEl.textContent = `Couldn't load this show: ${(err as Error).message}`;
    statusEl.className = "error-state";
    return;
  }

  const season = show.seasons.find((s) => s.seasonNumber === seasonNumber);
  const episode = season?.episodes.find((e) => e.episodeNumber === episodeNumber);
  if (!season || !episode) {
    statusEl.textContent = "That episode couldn't be found.";
    statusEl.className = "error-state";
    return;
  }

  const windows = resolveWarningWindows(episode.warnings, episode.runtimeSec);
  ctx = {
    title: episode.title ?? `S${seasonNumber}E${episodeNumber}`,
    runtimeSec: episode.runtimeSec,
    windows,
    hasTimed: windows.length > 0,
  };

  episodeTitleEl.textContent = `${show.title} — S${seasonNumber}E${episodeNumber}`;
  document.title = `mealTV — ${ctx.title}`;
  backLinkEl.href = `show.html?slug=${encodeURIComponent(slug)}&season=${seasonNumber}`;
  episodeSummaryEl.textContent = ctx.title;

  const hasAnyWarningReports =
    episode.warnings.some((w) => !w.suppressed) || show.seriesWarnings.some((w) => !w.suppressed);
  noTimerBannerEl.hidden = ctx.hasTimed || !hasAnyWarningReports;
  alertStageEl.hidden = !ctx.hasTimed;

  resyncOffsetSec = getResyncOffset(slug, seasonNumber, episodeNumber);
  renderOffset();
  renderLeadTime();
  soundToggleEl.checked = getSoundEnabled();

  statusEl.hidden = true;
  contentEl.hidden = false;

  startButtonEl.addEventListener("click", start);
  resyncMinusBtn.addEventListener("click", () => adjustResync(-RESYNC_STEP_SEC));
  resyncPlusBtn.addEventListener("click", () => adjustResync(RESYNC_STEP_SEC));
  leadTimeMinusBtn.addEventListener("click", () => adjustLeadTime(-RESYNC_STEP_SEC));
  leadTimePlusBtn.addEventListener("click", () => adjustLeadTime(RESYNC_STEP_SEC));
  soundToggleEl.addEventListener("change", () => {
    setSoundEnabled(soundToggleEl.checked);
    if (soundToggleEl.checked) ensureAudioContext();
  });
  wireLogging();
}

void init();
