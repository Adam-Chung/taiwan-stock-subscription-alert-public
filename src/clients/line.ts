import type { LineRecipient } from "../recipients.js";

const LINE_MAX_ATTEMPTS = 2;
const LINE_ERROR_BODY_MAX_LENGTH = 1_000;

class LineStatusError extends Error {
  constructor(
    readonly status: number,
    readonly requestId: string | null,
    readonly responseBody: string,
  ) {
    super(
      `LINE Multicast 失敗：HTTP ${status}${
        requestId ? ` (requestId ${requestId})` : ""
      }`,
    );
  }
}

export interface DeliveryOutcome {
  recipient: LineRecipient;
  status: "sent" | "failed";
  error?: string;
}

/** 使用 LINE multicast API 以單一 subrequest 發送相同訊息給所有收件者。 */
export async function pushLineMulticastMessage(
  message: string,
  token: string,
  targets: string[],
): Promise<void> {
  if (targets.length === 0 || targets.length > 500) {
    throw new Error("LINE multicast 收件者數量必須介於 1 與 500");
  }
  let lastError: unknown;
  for (let attempt = 1; attempt <= LINE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch("https://api.line.me/v2/bot/message/multicast", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          to: targets,
          messages: [{ type: "text", text: message }],
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        throw new LineStatusError(
          response.status,
          response.headers.get("x-line-request-id"),
          await safeLineResponseBody(response),
        );
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt === LINE_MAX_ATTEMPTS || !isRetryableLineError(error)) {
        logFinalLineFailure(error, attempt);
        throw error;
      }
      console.warn(
        JSON.stringify({
          event: "line_delivery_retry",
          nextAttempt: attempt + 1,
          reason: lineErrorReason(error),
        }),
      );
    }
  }
  throw lastError;
}

/** 讀取並清理 LINE 錯誤本文，保留診斷訊息但不記錄憑證或收件者 ID。 */
async function safeLineResponseBody(response: Response): Promise<string> {
  let body: string;
  try {
    body = await response.text();
  } catch {
    return "[unreadable]";
  }
  if (!body) return "[empty]";
  return body
    .replace(
      /("?(?:token|secret|authorization|userId|user_id)"?\s*[:=]\s*")([^"]+)(")/gi,
      "$1[redacted]$3",
    )
    .replace(/\bU[a-fA-F0-9]{32}\b/g, "[redacted-line-user-id]")
    .slice(0, LINE_ERROR_BODY_MAX_LENGTH);
}

/** 將最終 LINE 失敗寫入不含 token 與原始收件者 ID 的結構化日誌。 */
function logFinalLineFailure(error: unknown, attempts: number): void {
  console.error(
    JSON.stringify({
      event: "line_delivery_failed",
      attempts,
      reason: lineErrorReason(error),
      ...(error instanceof LineStatusError
        ? {
            status: error.status,
            ...(error.requestId ? { requestId: error.requestId } : {}),
            responseBody: error.responseBody,
          }
        : {}),
    }),
  );
}

/** 只重試可能自行恢復的 LINE 傳輸及伺服器錯誤；403 等權限錯誤交由備援排程。 */
function isRetryableLineError(error: unknown): boolean {
  if (!(error instanceof LineStatusError)) {
    return error instanceof Error && !error.message.includes("Too many subrequests");
  }
  return (
    error.status === 408 ||
    error.status === 425 ||
    error.status === 429 ||
    (error.status >= 500 && error.status <= 599)
  );
}

/** 建立不含 token、收件者及回應內容的 LINE 錯誤摘要。 */
function lineErrorReason(error: unknown): string {
  if (error instanceof LineStatusError) return `HTTP ${error.status}`;
  return error instanceof Error ? error.name : "UnknownError";
}

export async function pushLineMessageToRecipients(
  message: string,
  recipients: LineRecipient[],
): Promise<DeliveryOutcome[]> {
  return pushLineMessageToRecipientsWithToken(
    message,
    recipients,
    requiredEnv("LINE_CHANNEL_ACCESS_TOKEN"),
  );
}

/** 使用明確 token 以單次 multicast 發送，並將整批結果映射回既有 outcome。 */
export async function pushLineMessageToRecipientsWithToken(
  message: string,
  recipients: LineRecipient[],
  token: string,
): Promise<DeliveryOutcome[]> {
  try {
    await pushLineMulticastMessage(
      message,
      token,
      recipients.map((recipient) => recipient.targetId),
    );
    return recipients.map((recipient) => ({ recipient, status: "sent" }));
  } catch (error) {
    const reason = errorMessage(error);
    return recipients.map((recipient) => ({
      recipient,
      status: "failed",
      error: reason,
    }));
  }
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error
    ? reason.message.slice(0, 300)
    : String(reason).slice(0, 300);
}

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少環境變數 ${name}`);
  return value;
}
