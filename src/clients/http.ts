const nextRequestAtByHost = new Map<string, number>();
const DEFAULT_MIN_INTERVAL_MS = 1_500;
const MIN_ALLOWED_INTERVAL_MS = 500;
const DEFAULT_MAX_ATTEMPTS = 2;
const MOPS_MAX_ATTEMPTS = 3;

class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs: number | undefined,
  ) {
    super(`HTTP ${status}`);
  }
}

export async function fetchJson<T>(url: string, timeoutMs = 20_000): Promise<T> {
  return requestWithRetry(url, DEFAULT_MAX_ATTEMPTS, async () => {
    const response = await fetch(url, {
      redirect: "manual",
      headers: {
        accept: "application/json",
        "user-agent": "taiwan-stock-subscription-alert/0.1 personal-use",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    assertSuccessful(response);
    return (await response.json()) as T;
  });
}

export async function postFormText(
  url: string,
  form: Record<string, string>,
  timeoutMs = 20_000,
): Promise<string> {
  return requestWithRetry(url, MOPS_MAX_ATTEMPTS, async () => {
    const response = await fetch(url, {
      method: "POST",
      redirect: "manual",
      headers: {
        accept: "text/html",
        "content-type": "application/x-www-form-urlencoded",
        referer: "https://mopsov.twse.com.tw/mops/web/t146sb05",
        "user-agent": "taiwan-stock-subscription-alert/0.1 personal-use",
      },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(timeoutMs),
    });
    assertSuccessful(response);
    return response.text();
  });
}

/** 對可恢復錯誤執行指定次數的有限嘗試，並保留來源速率限制。 */
async function requestWithRetry<T>(
  url: string,
  maxAttempts: number,
  request: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await waitForRateLimit(url);
    try {
      return await request();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !isRetryable(error)) {
        console.error(
          JSON.stringify({
            event: "official_source_exhausted",
            host: new URL(url).host,
            attempts: attempt,
            reason: safeErrorReason(error),
          }),
        );
        throw error;
      }
      const retryAfterMs =
        error instanceof HttpStatusError ? error.retryAfterMs : undefined;
      console.warn(
        JSON.stringify({
          event: "official_source_retry",
          host: new URL(url).host,
          nextAttempt: attempt + 1,
          reason: safeErrorReason(error),
        }),
      );
      if (retryAfterMs && retryAfterMs > 0) await delay(retryAfterMs);
    }
  }
  throw lastError;
}

/** 將非成功回應轉成不含網址或回應內容的狀態錯誤。 */
function assertSuccessful(response: Response): void {
  if (response.ok) return;
  throw new HttpStatusError(
    response.status,
    parseRetryAfter(response.headers.get("retry-after")),
  );
}

/** 僅重試可能自行恢復的傳輸或伺服器錯誤。 */
function isRetryable(error: unknown): boolean {
  if (!(error instanceof HttpStatusError)) {
    return (
      error instanceof Error &&
      !error.message.includes("Too many subrequests")
    );
  }
  return (
    error.status === 302 ||
    error.status === 408 ||
    error.status === 425 ||
    error.status === 429 ||
    (error.status >= 500 && error.status <= 599)
  );
}

/** 解析 Retry-After 秒數或 HTTP-date，並限制單次等待最多 60 秒。 */
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds)
    ? seconds * 1_000
    : Date.parse(value) - Date.now();
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return undefined;
  return Math.min(milliseconds, 60_000);
}

/** 產生不含 URL、查詢參數或回應內容的有限錯誤摘要。 */
function safeErrorReason(error: unknown): string {
  if (error instanceof HttpStatusError) return `HTTP ${error.status}`;
  return error instanceof Error ? error.name : "UnknownError";
}

/** 非同步等待指定毫秒數。 */
function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForRateLimit(url: string): Promise<void> {
  const configured = Number(
    process.env.HTTP_MIN_INTERVAL_MS ?? DEFAULT_MIN_INTERVAL_MS,
  );
  if (
    !Number.isFinite(configured) ||
    configured < MIN_ALLOWED_INTERVAL_MS ||
    configured > 60_000
  ) {
    throw new Error(
      `HTTP_MIN_INTERVAL_MS 必須介於 ${MIN_ALLOWED_INTERVAL_MS} 與 60000`,
    );
  }

  const host = new URL(url).host;
  const now = Date.now();
  const requestAt = Math.max(now, nextRequestAtByHost.get(host) ?? now);
  nextRequestAtByHost.set(host, requestAt + configured);
  const delayMs = requestAt - now;
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
