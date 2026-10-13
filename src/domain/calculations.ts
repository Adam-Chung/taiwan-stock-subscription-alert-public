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
): Evaluation {
  assertPositive("實際承銷價", offering.actualUnderwritingPrice);
  assertPositive("目前股價", quote.currentPrice);

  const discountPercent =
    ((quote.currentPrice - offering.actualUnderwritingPrice) / quote.currentPrice) * 100;
  const hasPreviousClose =
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
    warning = "缺少已發行普通股數，無法計算股數稀釋率與安全邊際";
  } else if (issuance) {
    assertPositive("已發行普通股數", capital.issuedCommonShares);
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
    recommendationKind,
    recommended: recommendationKind !== "none",
    ...(warning ? { warning } : {}),
  };
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
