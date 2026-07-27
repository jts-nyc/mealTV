import { describe, expect, it } from "vitest";
import type { Warning } from "../src/schema/catalog.js";
import {
  computeAlertState,
  resolveWarningWindows,
  type ResolvedWarningWindow,
} from "../web/src/alert-state.js";
import { DEFAULT_LEAD_TIME_SEC, DEFAULT_WARNING_DURATION_SEC } from "../web/src/constants.js";

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function makeWarning(overrides: Partial<Warning> & Pick<Warning, "category">): Warning {
  return {
    id: nextId(overrides.category),
    severity: "medium",
    channel: "video",
    scope: "episode",
    suppressed: false,
    provenance: {
      type: "curated",
      confidence: 0.9,
      addedAt: "2026-01-01T00:00:00.000Z",
    },
    ...overrides,
  };
}

/** Build a resolved window directly, bypassing resolveWarningWindows, for tests
 * that only care about the state machine's timing logic. */
function makeWindow(
  startSec: number,
  endSec: number,
  overrides: Partial<Warning> & Pick<Warning, "category"> = { category: "vomiting" },
): ResolvedWarningWindow {
  return {
    warning: makeWarning(overrides),
    startSec,
    endSec,
    endIsEstimated: false,
  };
}

describe("computeAlertState", () => {
  it("is clear when there is nothing upcoming (no warnings at all)", () => {
    const result = computeAlertState(100, []);
    expect(result.state).toBe("clear");
    expect(result.warning).toBeNull();
    expect(result.secUntilStart).toBeNull();
    expect(result.secUntilEnd).toBeNull();
  });

  it("is clear when the next warning is further away than the lead time", () => {
    const windows = [makeWindow(200, 210)];
    const result = computeAlertState(100, windows, { leadTimeSec: 15 });
    expect(result.state).toBe("clear");
    // Still reports the upcoming warning + ETA so the UI can show "next warning in..."
    expect(result.warning).not.toBeNull();
    expect(result.secUntilStart).toBe(100);
  });

  it("switches to incoming exactly inside the lead-time window (12s before, 15s lead)", () => {
    const windows = [makeWindow(112, 120)];
    const result = computeAlertState(100, windows, { leadTimeSec: 15 });
    expect(result.state).toBe("incoming");
    expect(result.secUntilStart).toBe(12);
    expect(result.secUntilEnd).toBeNull();
  });

  it("uses DEFAULT_LEAD_TIME_SEC when no leadTimeSec option is given", () => {
    const windows = [makeWindow(110, 120)];
    const result = computeAlertState(100, windows);
    expect(DEFAULT_LEAD_TIME_SEC).toBeGreaterThanOrEqual(10);
    expect(result.state).toBe("incoming");
  });

  it("is active during the warning window, with a countdown to the end", () => {
    const windows = [makeWindow(90, 110)];
    const result = computeAlertState(100, windows, { leadTimeSec: 15 });
    expect(result.state).toBe("active");
    expect(result.secUntilStart).toBe(0);
    expect(result.secUntilEnd).toBe(10);
  });

  it("is active exactly at the boundary instants (start and end inclusive)", () => {
    const windows = [makeWindow(90, 110)];
    expect(computeAlertState(90, windows).state).toBe("active");
    expect(computeAlertState(110, windows).state).toBe("active");
  });

  it("returns to clear just after the window ends", () => {
    const windows = [makeWindow(90, 110)];
    const result = computeAlertState(111, windows, { leadTimeSec: 15 });
    expect(result.state).toBe("clear");
    expect(result.warning).toBeNull();
  });

  it("picks the more severe of two overlapping active warnings", () => {
    const low = makeWindow(90, 130, { category: "gore", severity: "low" });
    const high = makeWindow(100, 120, { category: "vomiting", severity: "high" });
    const result = computeAlertState(105, [low, high], { leadTimeSec: 15 });
    expect(result.state).toBe("active");
    expect(result.warning?.category).toBe("vomiting");
  });

  it("among equally severe overlapping active warnings, picks the one ending soonest", () => {
    const endsSoon = makeWindow(90, 100, { category: "gore", severity: "medium" });
    const endsLater = makeWindow(95, 200, { category: "blood", severity: "medium" });
    const result = computeAlertState(98, [endsSoon, endsLater], { leadTimeSec: 15 });
    expect(result.state).toBe("active");
    expect(result.warning?.category).toBe("gore");
    expect(result.secUntilEnd).toBe(2);
  });

  it("among multiple upcoming (non-active) warnings, picks the soonest one for incoming", () => {
    const soon = makeWindow(110, 115, { category: "gore" });
    const later = makeWindow(150, 160, { category: "vomiting" });
    const result = computeAlertState(100, [soon, later], { leadTimeSec: 15 });
    expect(result.state).toBe("incoming");
    expect(result.warning?.category).toBe("gore");
    expect(result.secUntilStart).toBe(10);
  });

  it("a positive resync offset shifts every window later", () => {
    // Without offset, elapsed 100 is 12s before a warning at 112 (incoming w/ 15s lead).
    // With a +10s offset the warning effectively moves to 122, so 100 is now clear (22s away).
    const windows = [makeWindow(112, 120)];
    const noOffset = computeAlertState(100, windows, { leadTimeSec: 15, resyncOffsetSec: 0 });
    const withOffset = computeAlertState(100, windows, { leadTimeSec: 15, resyncOffsetSec: 10 });
    expect(noOffset.state).toBe("incoming");
    expect(withOffset.state).toBe("clear");
    expect(withOffset.secUntilStart).toBe(22);
  });

  it("a negative resync offset shifts every window earlier, and shifts the active endSec too", () => {
    const windows = [makeWindow(90, 110)];
    // Elapsed 115 is past the un-shifted window (90-110) -> clear.
    expect(computeAlertState(115, windows).state).toBe("clear");
    // With a -10s offset the window becomes 80-100, still past -> still clear.
    expect(computeAlertState(115, windows, { resyncOffsetSec: -10 }).state).toBe("clear");
    // But shifting -20s makes the window 70-90, and elapsed 85 lands inside it, with 5s left.
    const result = computeAlertState(85, windows, { resyncOffsetSec: -20 });
    expect(result.state).toBe("active");
    expect(result.secUntilEnd).toBe(5);
  });
});

describe("resolveWarningWindows", () => {
  const runtimeSec = 2400;

  it("drops non-episode-scope and suppressed warnings", () => {
    const seriesWarning = makeWarning({ category: "gore", scope: "series", startFrac: 0.5 });
    const suppressed = makeWarning({ category: "vomiting", startFrac: 0.5, suppressed: true });
    const windows = resolveWarningWindows([seriesWarning, suppressed], runtimeSec);
    expect(windows).toHaveLength(0);
  });

  it("drops warnings with no resolvable start", () => {
    const noTiming = makeWarning({ category: "gore" });
    const windows = resolveWarningWindows([noTiming], runtimeSec);
    expect(windows).toHaveLength(0);
  });

  it("resolves startFrac/endFrac against runtimeSec", () => {
    const w = makeWarning({ category: "vomiting", startFrac: 0.5, endFrac: 0.51 });
    const [window] = resolveWarningWindows([w], runtimeSec);
    expect(window.startSec).toBe(1200);
    expect(window.endSec).toBeCloseTo(1224, 5);
    expect(window.endIsEstimated).toBe(false);
  });

  it("estimates an end using DEFAULT_WARNING_DURATION_SEC when none is known", () => {
    const w = makeWarning({ category: "vomiting", startFrac: 0.5 });
    const [window] = resolveWarningWindows([w], runtimeSec);
    expect(window.startSec).toBe(1200);
    expect(window.endSec).toBe(1200 + DEFAULT_WARNING_DURATION_SEC);
    expect(window.endIsEstimated).toBe(true);
  });
});
