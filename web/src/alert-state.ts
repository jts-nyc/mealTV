/**
 * Watch-along alert-state machine.
 *
 * Pure decision logic: given how many seconds have elapsed since the user
 * tapped START, and the episode's timed (scope: "episode") warnings, decide
 * whether we're currently "clear", "incoming" (a warning is about to start),
 * or "active" (a warning's window is happening right now).
 *
 * Deliberately has ZERO DOM / browser globals (no `document`, no
 * `setInterval`, no `localStorage`) so it's directly importable by vitest.
 * All DOM wiring (the wall-clock timer, vibration, flash, audio) lives in
 * `web/src/watch.ts` instead.
 *
 * Reuses `effectiveStartSec`/`effectiveEndSec` from the shared verdict module
 * rather than re-deriving warning timing — see src/verdict/compute-verdict.ts.
 */

import type { Warning } from "../../src/schema/catalog.js";
import { effectiveEndSec, effectiveStartSec } from "../../src/verdict/compute-verdict.js";
import { SEVERITY_RANK } from "../../src/verdict/policy.js";
import { DEFAULT_LEAD_TIME_SEC, DEFAULT_WARNING_DURATION_SEC } from "./constants.js";

export type AlertState = "clear" | "incoming" | "active";

/** A warning resolved to concrete seconds for THIS episode's runtime. */
export interface ResolvedWarningWindow {
  warning: Warning;
  startSec: number;
  endSec: number;
  /** True when `endSec` was invented via DEFAULT_WARNING_DURATION_SEC because
   * the underlying warning has no known end. */
  endIsEstimated: boolean;
}

export interface AlertStateResult {
  state: AlertState;
  /**
   * The warning driving the current state: the active one, the imminent one
   * during "incoming", or the next upcoming one during a "clear" state that
   * still has something ahead. `null` when there's genuinely nothing left.
   */
  warning: Warning | null;
  /** Seconds until `warning` starts. 0 while active. `null` if `warning` is null. */
  secUntilStart: number | null;
  /** Seconds until `warning`'s window ends. Only set while active. */
  secUntilEnd: number | null;
  /** Whether the active/incoming warning's end time is an estimate. */
  endIsEstimated: boolean;
}

export interface AlertStateOptions {
  /** Defaults to DEFAULT_LEAD_TIME_SEC. */
  leadTimeSec?: number;
  /**
   * Manual resync offset in seconds, e.g. from the −5s/+5s buttons. Positive
   * means "warnings are actually happening later than logged" (shifts every
   * window later); negative means earlier.
   */
  resyncOffsetSec?: number;
}

/**
 * Resolve an episode's non-suppressed episode-scope warnings into concrete
 * [startSec, endSec] windows for the given runtime. Warnings with no
 * resolvable start (no fraction and no source-seconds, or missing runtime)
 * are dropped — we never invent a start time, only ever an end time.
 */
export function resolveWarningWindows(
  warnings: Warning[],
  runtimeSec?: number,
): ResolvedWarningWindow[] {
  const windows: ResolvedWarningWindow[] = [];
  for (const w of warnings) {
    if (w.suppressed || w.scope !== "episode") continue;
    const startSec = effectiveStartSec(w, runtimeSec);
    if (startSec === undefined) continue;
    const rawEnd = effectiveEndSec(w, runtimeSec);
    const endIsEstimated = rawEnd === undefined || rawEnd <= startSec;
    const endSec = endIsEstimated ? startSec + DEFAULT_WARNING_DURATION_SEC : rawEnd;
    windows.push({ warning: w, startSec, endSec, endIsEstimated });
  }
  return windows;
}

/** Among warnings simultaneously active, prefer the most severe, then the one ending soonest. */
function pickActive(candidates: ResolvedWarningWindow[]): ResolvedWarningWindow {
  return candidates.slice().sort((a, b) => {
    const rankDiff = SEVERITY_RANK[b.warning.severity] - SEVERITY_RANK[a.warning.severity];
    if (rankDiff !== 0) return rankDiff;
    return a.endSec - b.endSec;
  })[0];
}

/**
 * Core Watch-along decision function.
 *
 * @param elapsedSec Seconds elapsed since START was tapped (wall-clock delta,
 *   NOT accumulated timer ticks — see watch.ts for why).
 * @param windows Resolved warning windows, see `resolveWarningWindows`.
 * @param opts Lead time + resync offset.
 */
export function computeAlertState(
  elapsedSec: number,
  windows: ResolvedWarningWindow[],
  opts: AlertStateOptions = {},
): AlertStateResult {
  const leadTimeSec = opts.leadTimeSec ?? DEFAULT_LEAD_TIME_SEC;
  const offset = opts.resyncOffsetSec ?? 0;

  const adjusted = windows.map((w) => ({
    ...w,
    startSec: w.startSec + offset,
    endSec: w.endSec + offset,
  }));

  const active = adjusted.filter((w) => elapsedSec >= w.startSec && elapsedSec <= w.endSec);
  if (active.length > 0) {
    const chosen = pickActive(active);
    return {
      state: "active",
      warning: chosen.warning,
      secUntilStart: 0,
      secUntilEnd: chosen.endSec - elapsedSec,
      endIsEstimated: chosen.endIsEstimated,
    };
  }

  const upcoming = adjusted
    .filter((w) => w.startSec > elapsedSec)
    .sort((a, b) => a.startSec - b.startSec);

  if (upcoming.length === 0) {
    return { state: "clear", warning: null, secUntilStart: null, secUntilEnd: null, endIsEstimated: false };
  }

  const next = upcoming[0];
  const secUntilStart = next.startSec - elapsedSec;

  if (secUntilStart <= leadTimeSec) {
    return {
      state: "incoming",
      warning: next.warning,
      secUntilStart,
      secUntilEnd: null,
      endIsEstimated: next.endIsEstimated,
    };
  }

  return {
    state: "clear",
    warning: next.warning,
    secUntilStart,
    secUntilEnd: null,
    endIsEstimated: false,
  };
}
