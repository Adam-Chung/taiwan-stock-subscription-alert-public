import type {
  CapitalInfo,
  Evaluation,
  IssuanceOverride,
  Quote,
  SubscriptionOffering,
} from "./types.js";

export interface EvaluationPolicy {
  minDiscountPercent: number;
  minSafetyMarginPercent: number;
}

const CONSIDER_MIN_DISCOUNT_PERCENT = 10;
const CONSIDER_MAX_DILUTION_PERCENT = 5;
const PERCENT_COMPARISON_EPSILON = 1e-9;

export function evaluateOffering(
  offering: SubscriptionOffering,
  quote: Quote,
  capital: CapitalInfo | undefined,
  issuance: IssuanceOverride | undefined,
  policy: EvaluationPolicy,
  averageMonthlyVolume?: number,
): Evaluation {
  assertPositive("實際承銷價", offering.actualUnderwritingPrice);
  assertPositive("目前股價", quote.currentPrice);

  const discountPercent =
    ((quote.currentPrice - offering.actualUnderwritingPrice) / quote.currentPrice) * 100;
  const hasPreviousClose =
    !quote.usedPreviousClose &&
    quote.previousClose !== undefined &&
    Number.isFinite(quote.previousClose) &&
    quote.previousClose > 0;
  const dailyChangeAmount = hasPreviousClose
    ? quote.currentPrice - quote.previousClose!
    : undefined;
  const dailyChangePercent = hasPreviousClose
    ? (dailyChangeAmount! / quote.previousClose!) * 100
    : undefined;

  let scalePercent: number | undefined;
  let scaleKind: Evaluation["scaleKind"];
  let totalNewShares: number | undefined;
  let postIssueTotalShares: number | undefined;
  let warning: string | undefined;

  if (!capital) {
    warning = "缺少原已發行股數，無法計算股數稀釋率與安全邊際";
  } else if (issuance) {
    assertPositive("原已發行股數", capital.issuedCommonShares);
    assertPositive("整次新增發行股數", issuance.totalNewShares);
    totalNewShares = issuance.totalNewShares;
    postIssueTotalShares = capital.issuedCommonShares + issuance.totalNewShares;
    scalePercent =
      (totalNewShares / postIssueTotalShares) * 100;
    scaleKind = "dilution";
  } else {
    warning = "缺少整次新增發行股數，無法計算股數稀釋率與安全邊際";
  }

  const safetyMarginPercent =
    scalePercent === undefined ? undefined : discountPercent - scalePercent;
  const sourceWarnings = isQuoteFromEarlierDate(
    quote.quotedAt,
    offering.subscriptionEndDate,
  ) && !quote.usedPreviousClose
    ? [`行情資料日期為 ${formatQuoteDate(quote.quotedAt)}`]
    : [];
  const passesDiscount = strictlyGreater(
    discountPercent,
    policy.minDiscountPercent,
  );
  const passesConsider =
    strictlyGreater(discountPercent, CONSIDER_MIN_DISCOUNT_PERCENT) &&
    strictlyLess(discountPercent, policy.minDiscountPercent) &&
    scaleKind === "dilution" &&
    strictlyLess(scalePercent!, CONSIDER_MAX_DILUTION_PERCENT) &&
    strictlyGreater(safetyMarginPercent!, policy.minSafetyMarginPercent);
  const recommendationKind: Evaluation["recommendationKind"] =
    !passesDiscount
      ? passesConsider
        ? "consider"
        : "none"
      : scaleKind === "dilution"
          ? strictlyGreater(safetyMarginPercent!, policy.minSafetyMarginPercent)
          ? "complete"
          : "none"
        : safetyMarginPercent === undefined
        ? "price-only"
        : "none";
  return {
    offering,
    quote,
    discountPercent,
    ...(dailyChangeAmount !== undefined ? { dailyChangeAmount } : {}),
    ...(dailyChangePercent !== undefined ? { dailyChangePercent } : {}),
    ...(capital?.issuedCommonShares !== undefined
      ? { issuedCommonShares: capital.issuedCommonShares }
      : {}),
    ...(capital?.industryType ? { industryType: capital.industryType } : {}),
    ...(totalNewShares !== undefined ? { totalNewShares } : {}),
    ...(postIssueTotalShares !== undefined ? { postIssueTotalShares } : {}),
    ...(scalePercent !== undefined ? { scalePercent } : {}),
    ...(scaleKind !== undefined ? { scaleKind } : {}),
    ...(safetyMarginPercent !== undefined ? { safetyMarginPercent } : {}),
    ...(averageMonthlyVolume !== undefined ? { averageMonthlyVolume } : {}),
    recommendationKind,
    recommended: recommendationKind !== "none",
    ...(warning ? { warning } : {}),
    ...(sourceWarnings.length > 0 ? { sourceWarnings } : {}),
  };
}

/** 判斷行情本身是否早於申購截止日，避免只因讀取快取就顯示無影響的時效警告。 */
function isQuoteFromEarlierDate(quotedAt: string, subscriptionEndDate: string): boolean {
  const quoteDate = extractIsoDate(quotedAt);
  return quoteDate !== undefined && quoteDate < subscriptionEndDate;
}

/** 從行情時間抽出 ISO 日期，支援 MIS 的 YYYYMMDD 與一般 YYYY-MM-DD 格式。 */
function extractIsoDate(value: string): string | undefined {
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  return value.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
}

/** 將行情日期轉成適合 LINE 顯示的固定格式。 */
function formatQuoteDate(value: string): string {
  return extractIsoDate(value)?.replaceAll("-", "/") ?? value;
}

/** 以百分點容差執行嚴格大於，避免浮點誤差讓等於門檻的值入選。 */
function strictlyGreater(value: number, threshold: number): boolean {
  return value - threshold > PERCENT_COMPARISON_EPSILON;
}

/** 以百分點容差執行嚴格小於，避免浮點誤差讓等於門檻的值入選。 */
function strictlyLess(value: number, threshold: number): boolean {
  return threshold - value > PERCENT_COMPARISON_EPSILON;
}

function assertPositive(label: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label}必須是正數`);
  }
}
