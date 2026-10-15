import { fetchCapitalInfo } from "./clients/capital.js";
import { fetchMopsIssuance } from "./clients/mops-issuance.js";
import { fetchQuote } from "./clients/quotes.js";
import { fetchEndingOfferings } from "./clients/subscriptions.js";
import { evaluateOffering, type EvaluationPolicy } from "./domain/calculations.js";
import type {
  Evaluation,
  EvaluationFailure,
  IssuanceOverride,
} from "./domain/types.js";
import { buildSuccessMessage } from "./message.js";
import type { JsonSnapshotStore } from "./clients/http.js";

export interface EvaluationOptions {
  policy: EvaluationPolicy;
  issuanceOverrides: Record<string, IssuanceOverride>;
  externalFetchEnabled: boolean;
  mopsFetchEnabled: boolean;
  sourceSnapshots?: JsonSnapshotStore;
}

export interface EvaluationResult {
  message: string;
  complete: boolean;
  incompleteCount: number;
}

export interface SourceWarmupResult {
  offeringCount: number;
  completeOfferingCount: number;
  sourceFailureCount: number;
}

/** 使用共用官方資料來源評估指定日期的所有申購案件。 */
export async function evaluateSubscriptionDate(
  date: string,
  options: EvaluationOptions,
): Promise<string> {
  return (await evaluateSubscriptionDateResult(date, options)).message;
}

/** 評估指定日期並回傳訊息與資料完整度，供備援排程判斷是否需要更新。 */
export async function evaluateSubscriptionDateResult(
  date: string,
  options: EvaluationOptions,
): Promise<EvaluationResult> {
  if (!options.externalFetchEnabled) {
    throw new Error(
      "外部資料來源預設停用；請先確認各來源條款與授權，再設定 ENABLE_EXTERNAL_FETCH=true",
    );
  }
  const offerings = await fetchEndingOfferings(date);
  const evaluated: Evaluation[] = [];
  const failures: EvaluationFailure[] = [];

  for (const offering of offerings) {
    const override = options.issuanceOverrides[offering.code];
    const [quoteResult, capitalResult, issuanceResult] =
      await Promise.allSettled([
        fetchQuote(offering, options.sourceSnapshots),
        fetchCapitalInfo(
          offering.code,
          offering.issueMarketLabel,
          options.sourceSnapshots,
        ),
        override
          ? Promise.resolve(override)
          : options.mopsFetchEnabled
            ? fetchMopsIssuance(offering)
            : Promise.resolve(undefined),
      ]);
    const capital =
      capitalResult.status === "fulfilled" ? capitalResult.value : undefined;
    const issuance =
      issuanceResult.status === "fulfilled" ? issuanceResult.value : undefined;

    logRejectedSource(date, offering.code, "quote", quoteResult);
    logRejectedSource(date, offering.code, "capital", capitalResult);
    logRejectedSource(date, offering.code, "issuance", issuanceResult);

    if (!Number.isFinite(offering.actualUnderwritingPrice)) {
      failures.push({
        offering,
        reason: "實際承銷價尚未確定",
        ...(capital ? { capital } : {}),
        ...(issuance ? { issuance } : {}),
      });
      continue;
    }
    if (quoteResult.status === "rejected") {
      failures.push({
        offering,
        reason:
          quoteResult.reason instanceof Error
            ? quoteResult.reason.message
            : String(quoteResult.reason),
        ...(capital ? { capital } : {}),
        ...(issuance ? { issuance } : {}),
      });
      continue;
    }

    evaluated.push(
      evaluateOffering(
        offering,
        quoteResult.value,
        capital,
        issuance,
        options.policy,
      ),
    );
  }

  const incompleteCount =
    failures.length + evaluated.filter((item) => Boolean(item.warning)).length;
  return {
    message: buildSuccessMessage(date, evaluated, failures),
    complete: incompleteCount === 0,
    incompleteCount,
  };
}

/** 預先載入今日行情與公司資料快照；不查 MOPS、不發 LINE，也不寫發送紀錄。 */
export async function warmSubscriptionDateSources(
  date: string,
  options: Pick<EvaluationOptions, "externalFetchEnabled" | "sourceSnapshots">,
): Promise<SourceWarmupResult> {
  if (!options.externalFetchEnabled) {
    throw new Error(
      "外部資料來源預設停用；請先確認各來源條款與授權，再設定 ENABLE_EXTERNAL_FETCH=true",
    );
  }
  const offerings = await fetchEndingOfferings(date);
  let completeOfferingCount = 0;
  let sourceFailureCount = 0;

  for (const offering of offerings) {
    const [quoteResult, capitalResult] = await Promise.allSettled([
      fetchQuote(offering, options.sourceSnapshots),
      fetchCapitalInfo(
        offering.code,
        offering.issueMarketLabel,
        options.sourceSnapshots,
      ),
    ]);
    logRejectedSource(date, offering.code, "quote", quoteResult);
    logRejectedSource(date, offering.code, "capital", capitalResult);

    const failures = [quoteResult, capitalResult].filter(
      (result) => result.status === "rejected",
    ).length;
    sourceFailureCount += failures;
    if (failures === 0) completeOfferingCount += 1;
  }

  return {
    offeringCount: offerings.length,
    completeOfferingCount,
    sourceFailureCount,
  };
}

/** 記錄不含憑證、收件者資料、URL 查詢參數與回應內容的來源失敗摘要。 */
function logRejectedSource(
  date: string,
  code: string,
  source: "quote" | "capital" | "issuance",
  result: PromiseSettledResult<unknown>,
): void {
  if (result.status !== "rejected") return;
  console.error(
    JSON.stringify({
      event: "official_source_failed",
      date,
      code,
      source,
      reason: safeSourceError(result.reason),
    }),
  );
}

/** 將外部來源錯誤安全化並限制長度，避免日誌意外帶入網址或敏感參數。 */
function safeSourceError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/(token|secret|authorization|userId)\s*[=:]\s*\S+/gi, "$1=[redacted]")
    .slice(0, 300);
}
