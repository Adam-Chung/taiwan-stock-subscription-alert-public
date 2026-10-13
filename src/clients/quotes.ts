import type { Market, Quote, SubscriptionOffering } from "../domain/types.js";
import { compactRocDateToIso } from "../lib/date.js";
import { fetchJson } from "./http.js";

interface MisResponse {
  msgArray?: Array<Record<string, string>>;
}

interface TpexEmergingQuoteRow {
  Date: string;
  Time: string;
  SecuritiesCompanyCode: string;
  CompanyName: string;
  PreviousAveragePrice: string;
  Average: string;
  LatestPrice: string;
}

const TPEX_EMERGING_QUOTES_URL =
  "https://www.tpex.org.tw/openapi/v1/tpex_esb_latest_statistics";

/** 依案件市場依序查詢即時行情或政府開放資料中的興櫃最近行情。 */
export async function fetchQuote(offering: SubscriptionOffering): Promise<Quote> {
  const markets = marketCandidates(offering.issueMarketLabel);
  const errors: string[] = [];
  for (const market of markets) {
    try {
      const quote =
        market === "emerging"
          ? await fetchEmergingQuote(offering.code)
          : await fetchMisQuote(offering.code, market);
      if (quote) return quote;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(
    `上市即時行情與官方興櫃行情皆未取得，無法計算 ${offering.code} 的市價折價率${
      errors.length ? `：${errors.join("；")}` : ""
    }`,
  );
}

/** 查詢上市或上櫃 MIS 行情；無有效代號或價格時回傳 undefined。 */
async function fetchMisQuote(
  code: string,
  market: Exclude<Market, "emerging">,
): Promise<Quote | undefined> {
  const exchange = market;
  const url =
    `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?` +
    `ex_ch=${exchange}_${encodeURIComponent(code)}.tw&json=1&delay=0`;
  const response = await fetchJson<MisResponse>(url);
  const item = response.msgArray?.[0];
  if (!item?.c) return undefined;

  const previousClose = parsePrice(item.y);
  const tradedPrice = parsePrice(item.z);
  const currentPrice = Number.isFinite(tradedPrice) ? tradedPrice : previousClose;
  if (!Number.isFinite(currentPrice)) return undefined;

  return {
    code: item.c,
    name: item.n || code,
    market,
    currentPrice,
    ...(Number.isFinite(previousClose) ? { previousClose } : {}),
    previousPriceKind: "close",
    quotedAt: `${item.d ?? ""} ${item.t ?? ""}`.trim(),
    usedPreviousClose: !Number.isFinite(tradedPrice),
  };
}

/** 從具政府開放資料授權的櫃買中心 OpenAPI 取得興櫃最近交易行情。 */
async function fetchEmergingQuote(code: string): Promise<Quote | undefined> {
  const rows = await fetchJson<TpexEmergingQuoteRow[]>(TPEX_EMERGING_QUOTES_URL);
  const item = rows.find((row) => row.SecuritiesCompanyCode.trim() === code);
  if (!item) return undefined;

  const previousAverage = parsePrice(item.PreviousAveragePrice);
  const latestPrice = parsePrice(item.LatestPrice);
  const dailyAverage = parsePrice(item.Average);
  const currentPrice = Number.isFinite(latestPrice)
    ? latestPrice
    : Number.isFinite(dailyAverage)
      ? dailyAverage
      : previousAverage;
  if (!Number.isFinite(currentPrice)) return undefined;

  return {
    code,
    name: item.CompanyName.trim() || code,
    market: "emerging",
    currentPrice,
    ...(Number.isFinite(previousAverage)
      ? { previousClose: previousAverage }
      : {}),
    previousPriceKind: "average",
    quotedAt: `${compactRocDateToIso(item.Date)} ${formatCompactTime(item.Time)}`,
    usedPreviousClose:
      !Number.isFinite(latestPrice) && !Number.isFinite(dailyAverage),
  };
}

/** 依申購案件類型決定可接受的行情市場順序。 */
function marketCandidates(label: string): Market[] {
  if (label === "創新板轉列上櫃") return ["tse", "otc", "emerging"];
  if (label.includes("上櫃")) return ["otc", "emerging"];
  if (label.includes("上市") || label.includes("創新板")) return ["tse", "emerging"];
  return ["tse", "otc", "emerging"];
}

/** 將外部行情字串轉成有限數值，空白與破折號視為缺值。 */
function parsePrice(value: string | undefined): number {
  if (!value || value === "-") return Number.NaN;
  return Number(value);
}

/** 將 HHmmss 格式轉成 HH:mm:ss，無法解析時保留原值。 */
function formatCompactTime(value: string): string {
  const match = value.trim().match(/^(\d{2})(\d{2})(\d{2})$/);
  return match ? `${match[1]}:${match[2]}:${match[3]}` : value.trim();
}
