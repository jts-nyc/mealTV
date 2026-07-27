/**
 * Tiny fetch wrapper shared by every `src/sources/**` client.
 *
 * Node-only (imports nothing Node-specific itself, but exists purely to
 * support the CLI pipeline's outbound HTTP calls — never imported by the web
 * app). Kept deliberately small: JSON parsing, a couple of typed error
 * classes, and an optional retry/backoff for 429/5xx. Every source client
 * takes an injectable `fetchImpl` so tests can stub the network entirely —
 * see `test/sources.test.ts`.
 */

/** Matches the subset of the global `fetch` signature every client here needs. */
export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

/** A request completed but the server returned a non-2xx status. */
export class HttpError extends Error {
  readonly status: number;
  readonly bodySnippet: string;

  constructor(message: string, status: number, bodySnippet: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.bodySnippet = bodySnippet;
  }
}

/** A request completed with a 2xx status but the body wasn't valid JSON. */
export class HttpParseError extends Error {
  readonly status: number;
  readonly bodySnippet: string;

  constructor(url: string, status: number, bodySnippet: string, cause?: unknown) {
    super(
      `mealtv: response from ${url} was not valid JSON (status ${status}): ${bodySnippet}`,
    );
    this.name = "HttpParseError";
    this.status = status;
    this.bodySnippet = bodySnippet;
    if (cause !== undefined) this.cause = cause;
  }
}

/** The request itself never completed (DNS, TLS, connection refused, timeout, ...). */
export class NetworkError extends Error {
  constructor(url: string, cause: unknown) {
    super(
      `mealtv: network request to ${url} failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = "NetworkError";
    this.cause = cause;
  }
}

export interface FetchJsonOptions {
  /** Injectable fetch implementation. Defaults to the global `fetch`. */
  fetchImpl?: FetchLike;
  headers?: Record<string, string>;
  method?: string;
  body?: string;
  /** Number of retry attempts for 429/5xx responses. Default 2. */
  retries?: number;
  /** Base retry delay in ms, doubled each attempt. Default 250. */
  retryDelayMs?: number;
}

function snippet(text: string, max = 300): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Fetches `url` and parses the body as JSON, with a small retry/backoff for
 * 429/5xx. Throws {@link NetworkError} if the request never completes,
 * {@link HttpError} for a non-2xx final response, or {@link HttpParseError}
 * if a 2xx response body isn't valid JSON.
 */
export async function fetchJson<T = unknown>(
  url: string | URL,
  opts: FetchJsonOptions = {},
): Promise<T> {
  const {
    fetchImpl = fetch,
    headers,
    method,
    body,
    retries = 2,
    retryDelayMs = 250,
  } = opts;
  const urlStr = url.toString();

  let attempt = 0;
  for (;;) {
    let res: Response;
    try {
      res = await fetchImpl(url, { method, headers, body });
    } catch (err) {
      throw new NetworkError(urlStr, err);
    }

    if (res.ok) {
      const text = await safeText(res);
      try {
        return JSON.parse(text) as T;
      } catch (err) {
        throw new HttpParseError(urlStr, res.status, snippet(text), err);
      }
    }

    if (isRetryableStatus(res.status) && attempt < retries) {
      attempt += 1;
      await sleep(retryDelayMs * 2 ** (attempt - 1));
      continue;
    }

    const text = await safeText(res);
    throw new HttpError(
      `mealtv: request to ${urlStr} failed with status ${res.status}: ${snippet(text)}`,
      res.status,
      snippet(text),
    );
  }
}
