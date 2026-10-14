const nextRequestAtByHost = new Map<string, number>();
const DEFAULT_MIN_INTERVAL_MS = 1_500;
const MIN_ALLOWED_INTERVAL_MS = 500;
const DEFAULT_MAX_ATTEMPTS = 3;
const MOPS_MAX_ATTEMPTS = 3;
const MAX_JSON_REDIRECTS = 2;
const DEFAULT_RETRY_DELAYS_MS = [2_000, 5_000] as const;

const OFFICIAL_JSON_PATHS: Readonly<Record<string, readonly string[]>> = {
  "www.tpex.org.tw": ["/openapi/"],
  "openapi.twse.com.tw": ["/v1/"],
  "mis.twse.com.tw": ["/stock/api/"],
};

export interface JsonSnapshot {
  storedAt: string;
  body: string;
}

export interface JsonSnapshotStore {
  load(key: string): Promise<JsonSnapshot | undefined>;
  save(key: string, snapshot: JsonSnapshot): Promise<void>;
}

export interface JsonSnapshotOptions {
  store: JsonSnapshotStore;
  key: string;
  maxAgeMs: number;
}

export interface FetchJsonResult<T> {
  value: T;
  snapshotAt?: string;
}

class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs: number | undefined,
  ) {
    super(`HTTP ${status}`);
  }
}

class UnexpectedContentTypeError extends Error {
  constructor(readonly contentType: string) {
    super("官方 JSON 來源回傳非 JSON 內容");
    this.name = "UnexpectedContentTypeError";
  }
}

/** 取得並解析官方 JSON；設定快取時可在來源暫時失敗後使用有限期快照。 */
export async function fetchJson<T>(
  url: string,
  timeoutMs = 20_000,
  snapshot?: JsonSnapshotOptions,
): Promise<T> {
  return (await fetchJsonResult<T>(url, timeoutMs, snapshot)).value;
}

/** 取得官方 JSON 與快照使用時間，供上層明示資料時效。 */
export async function fetchJsonResult<T>(
  url: string,
  timeoutMs = 20_000,
  snapshot?: JsonSnapshotOptions,
): Promise<FetchJsonResult<T>> {
  try {
    const loaded = await requestWithRetry(url, DEFAULT_MAX_ATTEMPTS, async () => {
      const response = await fetchJsonResponse(url, timeoutMs);
      assertSuccessful(response);
      assertJsonContentType(response);
      const body = await response.text();
      return { body, value: parseJson<T>(body) };
    });
    if (snapshot) await saveSnapshot(snapshot, loaded.body);
    return { value: loaded.value };
  } catch (error) {
    if (!snapshot) throw error;
    const cached = await loadSnapshot<T>(snapshot);
    if (!cached) throw error;
    console.warn(
      JSON.stringify({
        event: "official_source_cache_fallback",
        host: new URL(url).host,
        snapshotAt: cached.snapshotAt,
        reason: safeErrorReason(error),
      }),
    );
    return cached;
  }
}

/** 送出 MOPS 表單並在暫時錯誤時執行三次有限嘗試。 */
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

/** 只在官方 HTTPS 白名單內跟隨有限 JSON redirect，避免轉往未知來源。 */
async function fetchJsonResponse(url: string, timeoutMs: number): Promise<Response> {
  const original = new URL(url);
  let current = original;
  for (let redirectCount = 0; ; redirectCount += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: {
        accept: "application/json",
        "user-agent": "taiwan-stock-subscription-alert/0.1 personal-use",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!isRedirect(response.status)) return response;

    const location = response.headers.get("location");
    if (!location || redirectCount >= MAX_JSON_REDIRECTS) return response;
    const target = new URL(location, current);
    if (!isAllowedOfficialJsonRedirect(original, target)) return response;
    console.info(
      JSON.stringify({
        event: "official_source_redirect",
        sourceHost: original.host,
        targetHost: target.host,
        targetPath: target.pathname,
        status: response.status,
        redirectNumber: redirectCount + 1,
      }),
    );
    current = target;
  }
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
            ...(error instanceof UnexpectedContentTypeError
              ? { contentType: safeContentType(error.contentType) }
              : {}),
          }),
        );
        throw error;
      }
      const retryAfterMs =
        error instanceof HttpStatusError ? error.retryAfterMs : undefined;
      const waitMs = Math.max(retryAfterMs ?? 0, retryDelayMs(attempt));
      console.warn(
        JSON.stringify({
          event: "official_source_retry",
          host: new URL(url).host,
          nextAttempt: attempt + 1,
          reason: safeErrorReason(error),
          waitMs,
        }),
      );
      if (waitMs > 0) await delay(waitMs);
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

/** 拒絕明確的 HTML 回應，避免將防護頁或錯誤頁當作官方 JSON。 */
function assertJsonContentType(response: Response): void {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.toLowerCase().includes("text/html")) {
    throw new UnexpectedContentTypeError(contentType);
  }
}

/** 解析 JSON 並讓格式錯誤進入既有有限重試流程。 */
function parseJson<T>(body: string): T {
  return JSON.parse(body) as T;
}

/** 僅允許既有官方 API 主機與路徑範圍內的 HTTPS redirect。 */
function isAllowedOfficialJsonRedirect(original: URL, target: URL): boolean {
  if (original.protocol !== "https:" || target.protocol !== "https:") return false;
  if (target.hostname !== original.hostname) return false;
  const allowedPaths = OFFICIAL_JSON_PATHS[target.hostname];
  return Boolean(
    allowedPaths &&
      OFFICIAL_JSON_PATHS[original.hostname] &&
      allowedPaths.some((prefix) => target.pathname.startsWith(prefix)),
  );
}

/** 判斷是否為可由 GET 安全處理的標準 redirect 狀態。 */
function isRedirect(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

/** 僅重試可能自行恢復的傳輸、格式或伺服器錯誤。 */
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

/** 依嘗試次數取得退避時間；測試環境可用 HTTP_RETRY_BASE_MS 調低。 */
function retryDelayMs(attempt: number): number {
  const configured = process.env.HTTP_RETRY_BASE_MS;
  if (configured !== undefined) {
    const base = Number(configured);
    if (!Number.isFinite(base) || base < 0 || base > 60_000) {
      throw new Error("HTTP_RETRY_BASE_MS 必須介於 0 與 60000");
    }
    return base * 2 ** (attempt - 1);
  }
  return DEFAULT_RETRY_DELAYS_MS[attempt - 1] ?? 5_000;
}

/** 產生不含 URL、查詢參數或回應內容的有限錯誤摘要。 */
function safeErrorReason(error: unknown): string {
  if (error instanceof HttpStatusError) return `HTTP ${error.status}`;
  return error instanceof Error ? error.name : "UnknownError";
}

/** 限制 Content-Type 日誌長度並移除控制字元。 */
function safeContentType(value: string): string {
  return value.replace(/[\r\n\t]/g, " ").slice(0, 100);
}

/** 儲存成功的官方 JSON 快照；快取失敗不影響即時資料結果。 */
async function saveSnapshot(options: JsonSnapshotOptions, body: string): Promise<void> {
  try {
    await options.store.save(options.key, {
      storedAt: new Date().toISOString(),
      body,
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "official_source_cache_write_failed",
        reason: safeErrorReason(error),
      }),
    );
  }
}

/** 載入期限內且可解析的官方 JSON 快照。 */
async function loadSnapshot<T>(
  options: JsonSnapshotOptions,
): Promise<FetchJsonResult<T> | undefined> {
  try {
    const snapshot = await options.store.load(options.key);
    if (!snapshot) return undefined;
    const storedAtMs = Date.parse(snapshot.storedAt);
    if (
      !Number.isFinite(storedAtMs) ||
      Date.now() - storedAtMs < 0 ||
      Date.now() - storedAtMs > options.maxAgeMs
    ) {
      return undefined;
    }
    return { value: parseJson<T>(snapshot.body), snapshotAt: snapshot.storedAt };
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "official_source_cache_read_failed",
        reason: safeErrorReason(error),
      }),
    );
    return undefined;
  }
}

/** 非同步等待指定毫秒數。 */
function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** 對同一主機維持保守的最小請求間隔。 */
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
  if (delayMs > 0) await delay(delayMs);
}
