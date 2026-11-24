/** fetch with retries: 429 honours Retry-After, 5xx/network errors back off; DNSE daily limit (403 OA-401) stops. */

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface FetchResult {
  body: string;
  attempts: number;
  /** Human-readable notes about retries, for the job log. */
  notes: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithRetry(
  url: string,
  init: () => RequestInit,
  {
    retries = 3,
    timeoutMs = 15_000,
  }: { retries?: number; timeoutMs?: number } = {},
): Promise<FetchResult> {
  const notes: string[] = [];
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        ...init(),
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
    } catch (err) {
      if (attempt > retries)
        throw new ProviderError(`Lỗi mạng: ${(err as Error).message}`, true);
      notes.push(`lỗi mạng, thử lại lần ${attempt + 1}`);
      await sleep(500 * 2 ** attempt);
      continue;
    }
    const body = await res.text();
    if (res.ok) return { body, attempts: attempt, notes };

    if (res.status === 403 && body.includes("OA-401")) {
      throw new ProviderError(
        "403 OA-401: vượt giới hạn request trong ngày của DNSE",
      );
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt > retries) {
      throw new ProviderError(
        `HTTP ${res.status}: ${body.slice(0, 200)}`,
        retryable,
      );
    }
    const retryAfter = Number(res.headers.get("retry-after"));
    const wait =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter, 10) * 1000
        : 500 * 2 ** attempt;
    notes.push(
      `${res.status}${res.status === 429 ? " Too Many Requests" : ""} · chờ ${Math.round(wait / 1000)}s · thử lại lần ${attempt + 1}`,
    );
    await sleep(wait);
  }
}

export { sleep };
