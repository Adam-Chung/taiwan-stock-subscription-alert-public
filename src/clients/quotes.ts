import type { Market, Quote, SubscriptionOffering } from "../domain/types.js";
import { compactRocDateToIso } from "../lib/date.js";
import {
  fetchJsonResult,
  type JsonSnapshotStore,
} from "./http.js";

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

interface FugleIntradayQuote {
  date: string;
  market: string;
  symbol: string;
  name: string;
  previousClose?: number;
  closePrice?: number;
  closeTime?: number;
  avgPrice?: number;
  lastPrice?: number;
  lastTrade?: {
    price?: number;
    time?: number;
  };
}

const TPEX_EMERGING_QUOTES_URL =
  "https://www.tpex.org.tw/openapi/v1/tpex_esb_latest_statistics";
const TPEX_QUOTE_SNAPSHOT_MAX_AGE_MS = 36 * 60 * 60 * 1_000;
const MIS_QUOTE_SNAPSHOT_MAX_AGE_MS = 2 * 60 * 60 * 1_000;
const FUGLE_QUOTE_SNAPSHOT_MAX_AGE_MS = 2 * 60 * 60 * 1_000;

/** 依案件市場依序查詢即時行情或政府開放資料中的興櫃最近行情。 */
export async function fetchQuote(
  offering: SubscriptionOffering,
  snapshotStore?: JsonSnapshotStore,
  fugleApiKey?: string,
): Promise<Quote> {
  const markets = marketCandidates(offering.issueMarketLabel);
  const errors: string[] = [];
  for (const market of markets) {
    try {
      const quote =
        market === "emerging"
          ? await fetchEmergingQuote(offering.code, snapshotStore)
          : await fetchMisQuote(offering.code, market, snapshotStore);
      if (quote) return quote;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (fugleApiKey?.trim()) {
    try {
      const quote = await fetchFugleQuote(
        offering.code,
        markets,
        fugleApiKey.trim(),
        snapshotStore,
      );
      if (quote) return quote;
    } catch (error) {
      errors.push(`Fugle：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(
    `上市即時行情、官方興櫃行情與已授權備援皆未取得，無法計算 ${offering.code} 的市價折價率${
      errors.length ? `：${errors.join("；")}` : ""
    }`,
  );
}

/** 查詢上市或上櫃 MIS 行情；無有效代號或價格時回傳 undefined。 */
async function fetchMisQuote(
  code: string,
  market: Exclude<Market, "emerging">,
  snapshotStore?: JsonSnapshotStore,
): Promise<Quote | undefined> {
  const exchange = market;
  const url =
    `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?` +
    `ex_ch=${exchange}_${encodeURIComponent(code)}.tw&json=1&delay=0`;
  const result = await fetchJsonResult<MisResponse>(
    url,
    20_000,
    snapshotStore
      ? {
          store: snapshotStore,
          key: `mis-${market}-${code}`,
          maxAgeMs: MIS_QUOTE_SNAPSHOT_MAX_AGE_MS,
        }
      : undefined,
  );
  const item = result.value.msgArray?.[0];
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
    ...(result.snapshotAt ? { officialSnapshotAt: result.snapshotAt } : {}),
  };
}

/** 從具政府開放資料授權的櫃買中心 OpenAPI 取得興櫃最近交易行情。 */
async function fetchEmergingQuote(
  code: string,
  snapshotStore?: JsonSnapshotStore,
): Promise<Quote | undefined> {
  const result = await fetchJsonResult<TpexEmergingQuoteRow[]>(
    TPEX_EMERGING_QUOTES_URL,
    20_000,
    snapshotStore
      ? {
          store: snapshotStore,
          key: "tpex-emerging-quotes",
          maxAgeMs: TPEX_QUOTE_SNAPSHOT_MAX_AGE_MS,
        }
      : undefined,
  );
  const item = result.value.find(
    (row) => row.SecuritiesCompanyCode.trim() === code,
  );
  return item ? tpexQuote(code, item, result.snapshotAt) : undefined;
}

/** 將 TPEx 興櫃資料列轉為統一行情格式。 */
function tpexQuote(
  code: string,
  item: TpexEmergingQuoteRow,
  snapshotAt: string | undefined,
): Quote | undefined {

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
    ...(snapshotAt ? { officialSnapshotAt: snapshotAt } : {}),
  };
}

/** 從已授權 Fugle 日內行情 API 取得單一股票，作 MIS 或 TPEx 失敗後的跨網路備援。 */
async function fetchFugleQuote(
  code: string,
  expectedMarkets: readonly Market[],
  apiKey: string,
  snapshotStore?: JsonSnapshotStore,
): Promise<Quote | undefined> {
  const result = await fetchJsonResult<FugleIntradayQuote>(
    `https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/${encodeURIComponent(code)}`,
    20_000,
    snapshotStore
      ? {
          store: snapshotStore,
          key: `fugle-quote-${code}`,
          maxAgeMs: FUGLE_QUOTE_SNAPSHOT_MAX_AGE_MS,
        }
      : undefined,
    { "X-API-KEY": apiKey },
  );
  const item = result.value;
  const market = fugleMarket(item.market);
  if (item.symbol !== code || !market || !expectedMarkets.includes(market)) {
    return undefined;
  }

  const tradedPrice = finiteNumber(
    item.lastTrade?.price,
    item.lastPrice,
    item.closePrice,
  );
  const averagePrice = market === "emerging" ? finiteNumber(item.avgPrice) : Number.NaN;
  const previousPrice = finiteNumber(item.previousClose);
  const currentPrice = Number.isFinite(tradedPrice)
    ? tradedPrice
    : Number.isFinite(averagePrice)
      ? averagePrice
      : previousPrice;
  if (!Number.isFinite(currentPrice)) return undefined;

  return {
    code,
    name: item.name?.trim() || code,
    market,
    currentPrice,
    ...(Number.isFinite(previousPrice)
      ? { previousClose: previousPrice }
      : {}),
    previousPriceKind: market === "emerging" ? "average" : "close",
    quotedAt: formatFugleQuoteTime(item),
    usedPreviousClose:
      !Number.isFinite(tradedPrice) && !Number.isFinite(averagePrice),
    ...(result.snapshotAt ? { officialSnapshotAt: result.snapshotAt } : {}),
  };
}

/** 將 Fugle 市場代碼映射為內部市場；創新板行情沿用上市市場路徑。 */
function fugleMarket(value: string): Market | undefined {
  if (value === "TSE" || value === "TIB") return "tse";
  if (value === "OTC") return "otc";
  if (value === "ESB") return "emerging";
  return undefined;
}

/** 依序挑出第一個有限數值，所有候選都無效時回傳 NaN。 */
function finiteNumber(...values: Array<number | undefined>): number {
  return values.find((value) => Number.isFinite(value)) ?? Number.NaN;
}

/** 將 Fugle 微秒或毫秒時間戳轉成台灣時間；缺少時間時只保留資料日期。 */
function formatFugleQuoteTime(item: FugleIntradayQuote): string {
  const timestamp = finiteNumber(item.lastTrade?.time, item.closeTime);
  if (!Number.isFinite(timestamp)) return item.date;
  const milliseconds = timestamp > 100_000_000_000_000
    ? timestamp / 1_000
    : timestamp;
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(milliseconds));
}

/** 依申購案件類型決定可接受的行情市場順序。 */
function marketCandidates(label: string): Market[] {
  if (
    label === "初上市" ||
    label === "初上櫃" ||
    label === "創新板初上市" ||
    label === "第一上市公司初上市" ||
    label === "第一上櫃公司初上櫃"
  ) {
    return ["emerging"];
  }
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
