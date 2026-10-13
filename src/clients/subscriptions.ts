import { gregorianYearToRoc, rocDateToIso } from "../lib/date.js";
import type { SubscriptionOffering } from "../domain/types.js";
import { fetchJson } from "./http.js";

interface PublicFormResponse {
  stat: string;
  fields: string[];
  data: string[][];
}

const SUPPORTED_MARKETS = new Set([
  "上市增資",
  "上櫃增資",
  "初上市",
  "初上櫃",
  "創新板初上市",
  "第一上市公司現金增資",
  "第一上市公司初上市",
  "第一上櫃公司初上櫃",
  "第一上櫃公司現金增資",
  "創新板上市現增",
  "創新板轉列上櫃",
]);

/** 取得指定日期截止、未取消且屬支援市場的公開申購案件。 */
export async function fetchEndingOfferings(
  isoDate: string,
): Promise<SubscriptionOffering[]> {
  const year = Number(isoDate.slice(0, 4));
  const url = `https://www.twse.com.tw/announcement/publicForm?response=json&yy=${year}`;
  const response = await fetchJson<PublicFormResponse>(url);
  if (response.stat !== "OK") throw new Error(`公開申購資料狀態異常：${response.stat}`);

  return response.data
    .map(parseRow)
    .filter(
      (offering) =>
        offering.subscriptionEndDate === isoDate &&
        !offering.cancelled &&
        SUPPORTED_MARKETS.has(offering.issueMarketLabel),
    );
}

/** 將證交所公開申購資料列轉成領域模型，並保留撥券或掛牌日期。 */
function parseRow(row: string[]): SubscriptionOffering {
  const get = (index: number): string => row[index]?.trim() ?? "";
  const actualPrice = parseNumber(get(10));
  return {
    code: get(3),
    name: get(2),
    issueMarketLabel: get(4),
    subscriptionEndDate: rocDateToIso(get(6)),
    actualUnderwritingPrice: actualPrice,
    actualUnderwritingShares: parseNumber(get(8)),
    totalUnderwritingAmount: parseNumber(get(14)),
    allotmentDate: get(11) ? rocDateToIso(get(11)) : "",
    cancelled: get(17) !== "",
  };
}

/** 將含千分位的公開申購數值轉成 number，未定值則回傳 NaN。 */
function parseNumber(value: string): number {
  if (!value || value === "---" || value === "未訂出") return Number.NaN;
  return Number(value.replaceAll(",", ""));
}

export function currentRocYear(now = new Date()): number {
  return gregorianYearToRoc(now.getUTCFullYear());
}
