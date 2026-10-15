import { pushLineMessageToRecipientsWithToken } from "../src/clients/line.js";
import type {
  EvaluationOptions,
  EvaluationResult,
  SourceWarmupResult,
} from "../src/evaluation.js";
import {
  evaluateSubscriptionDateResult,
  warmSubscriptionDateSources,
} from "../src/evaluation.js";
import { buildFailureMessage } from "../src/message.js";
import { loadRecipients, type LineRecipient } from "../src/recipients.js";
import type {
  JsonSnapshot,
  JsonSnapshotStore,
} from "../src/clients/http.js";

interface WorkerEnvironment {
  ALERT_HISTORY: KVNamespace;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  LINE_TARGET_ID_001?: string;
  LINE_TARGET_ID_002?: string;
  LINE_TARGET_ID_003?: string;
  LINE_TARGET_ID_004?: string;
  LINE_TARGET_ID_005?: string;
  LATEST_SEND_TIME?: string;
  MIN_DISCOUNT_PERCENT?: string;
  MIN_SAFETY_MARGIN_PERCENT?: string;
  ENABLE_EXTERNAL_FETCH?: string;
  ENABLE_MOPS_FETCH?: string;
  ISSUANCE_OVERRIDES_JSON?: string;
}

interface WorkerDependencies {
  evaluate: (
    date: string,
    options: EvaluationOptions,
  ) => Promise<EvaluationResult>;
  deliver: (
    message: string,
    recipients: LineRecipient[],
    token: string,
  ) => ReturnType<typeof pushLineMessageToRecipientsWithToken>;
  warm: (
    date: string,
    options: Pick<EvaluationOptions, "externalFetchEnabled" | "sourceSnapshots">,
  ) => Promise<SourceWarmupResult>;
}

export interface WorkerRunResult {
  status: "sent" | "updated" | "duplicate" | "unchanged";
  date: string;
  sentCount: number;
}

export interface WorkerWarmupResult extends SourceWarmupResult {
  status: "warmed";
  date: string;
}

interface DailyDeliveryState {
  recipients: Array<{
    alias: string;
    hash: string;
    sentAt: string;
  }>;
  evaluationComplete?: boolean;
  incompleteCount?: number;
}

const DEFAULT_LATEST_SEND_TIME = "13:15";
const SNAPSHOT_WARMUP_CRON = "0 4 * * MON-FRI";
const HISTORY_TTL_SECONDS = 120 * 24 * 60 * 60;
const SOURCE_SNAPSHOT_TTL_SECONDS = 10 * 24 * 60 * 60;

const dependencies: WorkerDependencies = {
  evaluate: evaluateSubscriptionDateResult,
  deliver: pushLineMessageToRecipientsWithToken,
  warm: warmSubscriptionDateSources,
};

export default {
  /** 由 Cloudflare Cron 先預熱快照，再於正式時段評估與發送 LINE。 */
  async scheduled(
    controller: ScheduledController,
    env: WorkerEnvironment,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const result = await executeWorkerSchedule(controller.cron, new Date(), env);
    console.log(JSON.stringify(result));
  },

  /** 提供不含敏感資料的健康檢查，不開放網路手動觸發發送。 */
  async fetch(): Promise<Response> {
    return Response.json({ service: "taiwan-stock-subscription-alert", ok: true });
  },
} satisfies ExportedHandler<WorkerEnvironment>;

/** 依 Cron 類型區分只讀預熱與正式通知，避免預熱時載入收件者或發送 LINE。 */
export async function executeWorkerSchedule(
  cron: string,
  now: Date,
  env: WorkerEnvironment,
  workerDependencies: WorkerDependencies = dependencies,
): Promise<WorkerRunResult | WorkerWarmupResult> {
  return cron === SNAPSHOT_WARMUP_CRON
    ? executeSnapshotWarmup(now, env, workerDependencies)
    : executeScheduledAlert(now, env, workerDependencies);
}

/** 預先建立今日行情與公司資料快照，不產生任何通知或發送紀錄。 */
export async function executeSnapshotWarmup(
  now: Date,
  env: WorkerEnvironment,
  workerDependencies: WorkerDependencies = dependencies,
): Promise<WorkerWarmupResult> {
  const taipei = taipeiDateTime(now);
  const result = await workerDependencies.warm(taipei.date, {
    externalFetchEnabled: env.ENABLE_EXTERNAL_FETCH === "true",
    sourceSnapshots: sourceSnapshotStore(env.ALERT_HISTORY),
  });
  return { status: "warmed", date: taipei.date, ...result };
}

/** 執行一次具期限與重複防護的 Cloudflare 排程提醒。 */
export async function executeScheduledAlert(
  now: Date,
  env: WorkerEnvironment,
  workerDependencies: WorkerDependencies = dependencies,
): Promise<WorkerRunResult> {
  const taipei = taipeiDateTime(now);
  const latestSendTime = parseTime(
    env.LATEST_SEND_TIME?.trim() || DEFAULT_LATEST_SEND_TIME,
  );
  if (taipei.minutesSinceMidnight > latestSendTime) {
    throw new Error(
      `已超過台灣時間 ${formatMinutes(latestSendTime)} 發送期限，本次不傳送過期申購資訊`,
    );
  }

  const recipients = loadRecipients(recipientEnvironment(env));
  const deliveryState = await loadDeliveryState(
    taipei.date,
    env.ALERT_HISTORY,
  );
  const deliveredHashes = new Set(
    deliveryState.recipients.map((recipient) => recipient.hash),
  );
  const pendingRecipients = recipients.filter(
    (recipient) => !deliveredHashes.has(recipient.hash),
  );
  const previousEvaluationWasPartial = deliveryState.evaluationComplete === false;
  if (pendingRecipients.length === 0 && !previousEvaluationWasPartial) {
    return { status: "duplicate", date: taipei.date, sentCount: 0 };
  }

  let evaluation: EvaluationResult;
  try {
    evaluation = await workerDependencies.evaluate(
      taipei.date,
      evaluationOptions(env),
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const failureMessage = buildFailureMessage(taipei.date, reason);
    await workerDependencies.deliver(
      failureMessage,
      pendingRecipients,
      requiredValue(env.LINE_CHANNEL_ACCESS_TOKEN, "LINE_CHANNEL_ACCESS_TOKEN"),
    );
    throw new Error(failureMessage, { cause: error });
  }

  const improved = previousEvaluationWasPartial && (
    evaluation.complete ||
    evaluation.incompleteCount < (deliveryState.incompleteCount ?? Number.POSITIVE_INFINITY)
  );
  if (pendingRecipients.length === 0 && !improved) {
    return { status: "unchanged", date: taipei.date, sentCount: 0 };
  }
  const recipientsToDeliver = improved ? recipients : pendingRecipients;
  const message = improved
    ? evaluation.message.replace("【台股申購提醒｜", "【台股申購提醒更新｜")
    : evaluation.message;
  const outcomes = await workerDependencies.deliver(
    message,
    recipientsToDeliver,
    requiredValue(env.LINE_CHANNEL_ACCESS_TOKEN, "LINE_CHANNEL_ACCESS_TOKEN"),
  );
  const successes = outcomes
    .filter((outcome) => outcome.status === "sent")
    .map((outcome) => outcome.recipient);
  await recordSuccessfulDeliveries(
    taipei.date,
    deliveryState,
    successes,
    env.ALERT_HISTORY,
    now,
    evaluation,
  );

  const failures = outcomes.filter((outcome) => outcome.status === "failed");
  if (failures.length > 0) {
    throw new Error(
      `LINE 發送失敗：${failures
        .map((outcome) => `${outcome.recipient.alias} (${outcome.error})`)
        .join("；")}`,
    );
  }

  return {
    status: improved ? "updated" : "sent",
    date: taipei.date,
    sentCount: successes.length,
  };
}

/** 建立 Worker 專用評估設定並驗證所有數值。 */
function evaluationOptions(env: WorkerEnvironment): EvaluationOptions {
  return {
    policy: {
      minDiscountPercent: numericValue(env.MIN_DISCOUNT_PERCENT, 20),
      minSafetyMarginPercent: numericValue(env.MIN_SAFETY_MARGIN_PERCENT, 10),
    },
    issuanceOverrides: parseIssuanceOverrides(env.ISSUANCE_OVERRIDES_JSON),
    externalFetchEnabled: env.ENABLE_EXTERNAL_FETCH === "true",
    mopsFetchEnabled: env.ENABLE_MOPS_FETCH === "true",
    sourceSnapshots: sourceSnapshotStore(env.ALERT_HISTORY),
  };
}

/** 以既有 KV 儲存有限期官方 JSON 快照，鍵值不含 URL 或查詢參數。 */
function sourceSnapshotStore(history: KVNamespace): JsonSnapshotStore {
  return {
    async load(key: string): Promise<JsonSnapshot | undefined> {
      const raw = await history.get(sourceSnapshotKey(key));
      if (raw === null) return undefined;
      const parsed: unknown = JSON.parse(raw);
      if (!isJsonSnapshot(parsed)) throw new Error("官方來源快取格式無效");
      return parsed;
    },
    async save(key: string, snapshot: JsonSnapshot): Promise<void> {
      await history.put(sourceSnapshotKey(key), JSON.stringify(snapshot), {
        expirationTtl: SOURCE_SNAPSHOT_TTL_SECONDS,
      });
    },
  };
}

/** 驗證官方來源快取只含時間與 JSON 內容。 */
function isJsonSnapshot(value: unknown): value is JsonSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Record<string, unknown>;
  return typeof snapshot.storedAt === "string" && typeof snapshot.body === "string";
}

/** 建立與傳送紀錄分離的官方資料快取鍵。 */
function sourceSnapshotKey(key: string): string {
  return `source-snapshot:${key}`;
}

/** 解析可選的完整增資股數備援 JSON。 */
function parseIssuanceOverrides(
  raw: string | undefined,
): EvaluationOptions["issuanceOverrides"] {
  if (!raw?.trim()) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("ISSUANCE_OVERRIDES_JSON 必須是 JSON object");
  }
  return parsed as EvaluationOptions["issuanceOverrides"];
}

/** 從 Worker bindings 建立既有收件者載入器需要的環境資料。 */
function recipientEnvironment(
  env: WorkerEnvironment,
): Record<string, string | undefined> {
  return {
    LINE_TARGET_ID_001: env.LINE_TARGET_ID_001,
    LINE_TARGET_ID_002: env.LINE_TARGET_ID_002,
    LINE_TARGET_ID_003: env.LINE_TARGET_ID_003,
    LINE_TARGET_ID_004: env.LINE_TARGET_ID_004,
    LINE_TARGET_ID_005: env.LINE_TARGET_ID_005,
  };
}

/** 以單次 KV get 載入當日所有收件者狀態，無紀錄時建立空狀態。 */
async function loadDeliveryState(
  date: string,
  history: KVNamespace,
): Promise<DailyDeliveryState> {
  const raw = await history.get(historyKey(date));
  if (raw === null) return { recipients: [] };
  const parsed: unknown = JSON.parse(raw);
  if (!isDailyDeliveryState(parsed)) {
    throw new Error(`Cloudflare KV ${date} 傳送紀錄格式無效`);
  }
  return parsed;
}

/** 以單次 KV put 合併成功收件者，資料只含 alias、雜湊與時間。 */
async function recordSuccessfulDeliveries(
  date: string,
  state: DailyDeliveryState,
  recipients: LineRecipient[],
  history: KVNamespace,
  now: Date,
  evaluation: EvaluationResult,
): Promise<void> {
  if (recipients.length === 0) return;
  const merged = new Map(
    state.recipients.map((recipient) => [recipient.hash, recipient]),
  );
  for (const recipient of recipients) {
    merged.set(recipient.hash, {
      alias: recipient.alias,
      hash: recipient.hash,
      sentAt: now.toISOString(),
    });
  }
  await history.put(
    historyKey(date),
    JSON.stringify({
      recipients: [...merged.values()],
      evaluationComplete: evaluation.complete,
      incompleteCount: evaluation.incompleteCount,
    } satisfies DailyDeliveryState),
    { expirationTtl: HISTORY_TTL_SECONDS },
  );
}

/** 驗證 KV 內容只包含可接受的隱私安全傳送欄位。 */
function isDailyDeliveryState(value: unknown): value is DailyDeliveryState {
  if (!value || typeof value !== "object" || !("recipients" in value)) return false;
  const recipients = (value as { recipients?: unknown }).recipients;
  const state = value as Record<string, unknown>;
  return (
    Array.isArray(recipients) &&
    recipients.every(
      (recipient) =>
        recipient !== null &&
        typeof recipient === "object" &&
        typeof (recipient as Record<string, unknown>).alias === "string" &&
        typeof (recipient as Record<string, unknown>).hash === "string" &&
        typeof (recipient as Record<string, unknown>).sentAt === "string",
    ) &&
    (state.evaluationComplete === undefined ||
      typeof state.evaluationComplete === "boolean") &&
    (state.incompleteCount === undefined ||
      (typeof state.incompleteCount === "number" &&
        Number.isInteger(state.incompleteCount) &&
        state.incompleteCount >= 0))
  );
}

/** 建立每日單一且不含原始 LINE userId 的持久化鍵。 */
function historyKey(date: string): string {
  return `delivery:${date}`;
}

/** 取得指定時間在 Asia/Taipei 的日期與分鐘數。 */
function taipeiDateTime(value: Date): {
  date: string;
  minutesSinceMidnight: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? "";
  const hour = Number(part("hour"));
  const minute = Number(part("minute"));
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    minutesSinceMidnight: hour * 60 + minute,
  };
}

/** 將 HH:mm 設定轉成當日分鐘數。 */
function parseTime(value: string): number {
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) throw new Error("LATEST_SEND_TIME 必須是 HH:mm");
  return Number(match[1]) * 60 + Number(match[2]);
}

/** 將分鐘數格式化回 HH:mm。 */
function formatMinutes(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

/** 解析有限數值設定。 */
function numericValue(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error("Worker 數值設定必須是有限數字");
  return value;
}

/** 驗證必要 Worker Secret 並回傳去除前後空白的值。 */
function requiredValue(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`缺少 Worker Secret ${name}`);
  return normalized;
}
