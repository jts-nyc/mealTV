/**
 * Named tunables for Watch-along mode. Pure module — no DOM, no Node
 * built-ins — so it's importable directly by vitest and by every web entry
 * point without pulling in browser globals.
 */

/**
 * How many seconds before a warning starts we switch from "clear" to
 * "incoming" (the loud "look away in N seconds" state). Exposed as a
 * constant rather than a magic number because the UI lets the user override
 * it (persisted in localStorage, see `web/src/storage.ts`) — subtitle-derived
 * timings drift, and some people want more warning than others.
 */
export const DEFAULT_LEAD_TIME_SEC = 15;

/**
 * When a warning has a known start but no known end (e.g. a subtitle-scan
 * hit that only found the triggering line, not where the scene ends), we
 * still need *some* window to show a countdown/"safe now" moment for. This is
 * an explicit, honest estimate — the UI marks it as estimated rather than
 * pretending it's a real measured duration.
 */
export const DEFAULT_WARNING_DURATION_SEC = 20;

/**
 * How many seconds we subtract from the elapsed time when the user taps
 * "LOG THIS". People react to something on screen and *then* reach for their
 * phone — by the time the button is tapped, the actual moment was already a
 * beat earlier. This is a rough correction, not a measurement.
 */
export const REACTION_OFFSET_SEC = 3;

/** Step size for the manual −5s / +5s resync buttons, in seconds. */
export const RESYNC_STEP_SEC = 5;

/** How often (ms) the watch-along UI recomputes elapsed time and re-renders. */
export const TICK_INTERVAL_MS = 250;

/**
 * Some shows (single-cour C-dramas especially) have 300+ episodes in one
 * season. Rendering them all at once would be a scroll-forever mess on a
 * phone, so the episode list is paginated in chunks of this size.
 */
export const EPISODES_PER_PAGE = 50;

/** How many times the full-screen flash animation repeats per alert transition. */
export const FLASH_REPEAT_COUNT = 3;
