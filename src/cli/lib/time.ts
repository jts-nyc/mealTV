/**
 * Parses a CLI-supplied time value in `mm:ss`, `hh:mm:ss`, or raw-seconds
 * form into seconds. Used by `curate add`'s `--start`/`--end` flags.
 */

const SECONDS_RE = /^\d+(?:\.\d+)?$/;
const MMSS_RE = /^(\d+):(\d{1,2}(?:\.\d+)?)$/;
const HHMMSS_RE = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/;

export function parseTimeToSeconds(input: string): number {
  const trimmed = input.trim();

  if (SECONDS_RE.test(trimmed)) {
    return Number(trimmed);
  }

  const hms = HHMMSS_RE.exec(trimmed);
  if (hms) {
    const [, h, m, s] = hms;
    return Number(h) * 3600 + Number(m) * 60 + Number(s);
  }

  const ms = MMSS_RE.exec(trimmed);
  if (ms) {
    const [, m, s] = ms;
    return Number(m) * 60 + Number(s);
  }

  throw new Error(
    `mealtv: invalid time "${input}" — expected mm:ss, hh:mm:ss, or a raw number of seconds`,
  );
}

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
