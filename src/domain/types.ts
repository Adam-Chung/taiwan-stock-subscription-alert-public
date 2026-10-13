export type Market = "tse" | "otc" | "emerging";

export interface SubscriptionOffering {
  code: string;
  name: string;
  issueMarketLabel: string;
  subscriptionEndDate: string;
  actualUnderwritingPrice: number;
  actualUnderwritingShares: number;
  totalUnderwritingAmount: number;
  allotmentDate: string;
  cancelled: boolean;
}

export interface Quote {
  code: string;
  name: string;
  market: Market;
  currentPrice: number;
  previousClose?: number;
  previousPriceKind?: "close" | "average";
  quotedAt: string;
  usedPreviousClose: boolean;
}

export interface CapitalInfo {
  code: string;
  issuedCommonShares: number;
  industryType?: string;
}

export interface IssuanceOverride {
  totalNewShares: number;
  sourceUrl: string;
}

export interface Evaluation {
  offering: SubscriptionOffering;
  quote: Quote;
  discountPercent: number;
  dailyChangeAmount?: number;
  dailyChangePercent?: number;
  issuedCommonShares?: number;
  industryType?: string;
  totalNewShares?: number;
  postIssueTotalShares?: number;
  scalePercent?: number;
  scaleKind?: "dilution";
  safetyMarginPercent?: number;
  recommendationKind: "complete" | "consider" | "price-only" | "none";
  recommended: boolean;
  warning?: string;
}

export interface EvaluationFailure {
  offering: SubscriptionOffering;
  reason: string;
  capital?: CapitalInfo;
  issuance?: IssuanceOverride;
}
