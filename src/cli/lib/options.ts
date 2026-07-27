/** Commander custom-parser for integer options, e.g. `--season <n>`. */
export function parseIntOption(value: string): number {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) {
    throw new Error(`mealtv: expected an integer, got "${value}"`);
  }
  return n;
}
