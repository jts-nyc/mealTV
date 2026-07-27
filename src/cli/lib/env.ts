/**
 * Shared "fail loudly and specifically" helper for CLI commands that need an
 * API key. Checked up front, before any network call is attempted, so the
 * error names exactly which env var is missing and makes clear the failure
 * is scoped to the one command that needed it (not the whole CLI).
 */
export function requireEnv(name: string, commandName: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `mealtv ${commandName}: missing required environment variable ${name}. ` +
        `Set it in your .env file (copy .env.example if you haven't yet) and retry. ` +
        `This failure only affects the "${commandName}" command — other mealtv commands are unaffected.`,
    );
  }
  return value;
}
