import type {
  IssuanceOverride,
  SubscriptionOffering,
} from "../domain/types.js";
import { postFormText } from "./http.js";

const MOPS_BASE = "https://mopsov.twse.com.tw";
const MOPS_SOURCE_URL = `${MOPS_BASE}/mops/web/t146sb05`;
const MOPS_ESSENCE_AJAX_URL = `${MOPS_BASE}/mops/web/ajax_t146sb05`;
const MOPS_MATERIAL_AJAX_URL = `${MOPS_BASE}/mops/web/ajax_t05st01`;

interface AnnouncementReference {
  title: string;
  year: string;
  month: string;
  sequenceNumber: string;
  spokenAt: string;
  spokenDate: string;
}

export async function fetchMopsIssuance(
  offering: SubscriptionOffering,
): Promise<IssuanceOverride> {
  const summaryHtml = await postFormText(MOPS_ESSENCE_AJAX_URL, {
    step: "1",
    firstin: "1",
    off: "1",
    keyword4: "",
    code1: "",
    TYPEK2: "",
    checkbtn: "",
    queryName: "co_id",
    inpuType: "co_id",
    TYPEK: "all",
    co_id: offering.code,
  });
  const references = parseCapitalIncreaseReferences(summaryHtml);
  const errors: string[] = [];

  for (const reference of references) {
    try {
      const detailHtml = await postFormText(MOPS_MATERIAL_AJAX_URL, {
        firstin: "true",
        co_id: offering.code,
        year: reference.year,
        month: reference.month,
        b_date: "",
        e_date: "",
        seq_no: reference.sequenceNumber,
        spoke_time: reference.spokenAt,
        spoke_date: reference.spokenDate,
        step: "2",
        TYPEK: "all",
      });
      const totalNewShares = parseTotalNewShares(detailHtml);
      if (totalNewShares < offering.actualUnderwritingShares) {
        throw new Error(
          `完整新增股數 ${totalNewShares} 小於實際公開承銷股數 ${offering.actualUnderwritingShares}`,
        );
      }
      return { totalNewShares, sourceUrl: MOPS_SOURCE_URL };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(
    references.length === 0
      ? `MOPS 找不到 ${offering.code} 可用的現金增資發行新股公告`
      : `MOPS 現金增資公告無法解析完整新增股數：${errors.join("；")}`,
  );
}

/** 從重大訊息清單挑出可能包含完整現金增資股數的公告參數。 */
export function parseCapitalIncreaseReferences(
  html: string,
): AnnouncementReference[] {
  const results: AnnouncementReference[] = [];
  const pattern =
    /<button[^>]*onClick="([^"]*ajax_t05st01[^"]*)"[^>]*>([\s\S]*?)<\/button>/gi;
  for (const match of html.matchAll(pattern)) {
    const script = match[1] ?? "";
    const title = htmlToText(match[2] ?? "");
    if (!isCapitalIncreaseAnnouncement(title)) continue;
    const reference = {
      title,
      year: scriptValue(script, "year"),
      month: scriptValue(script, "month"),
      sequenceNumber: scriptValue(script, "seq_no"),
      spokenAt: scriptValue(script, "spoke_time"),
      spokenDate: scriptValue(script, "spoke_date"),
    };
    if (Object.values(reference).every(Boolean)) results.push(reference);
  }
  return results;
}

/** 判斷公告標題是否屬於可提供整次增資股數的候選類型。 */
function isCapitalIncreaseAnnouncement(title: string): boolean {
  if (!title.includes("現金增資")) return false;
  if (title.includes("認股基準日")) return true;
  if (!title.includes("發行新股")) return false;
  return title.includes("董事會決議") || title.includes("承銷價格");
}

export function parseTotalNewShares(html: string): number {
  const text = htmlToText(html);
  const introductoryTotal = text.match(
    /現金增資[^。；]{0,200}?普通股\s*([\d,.]+)\s*(億|萬|千|仟)?股/,
  );
  if (introductoryTotal?.[1]) {
    return parseShareCount(introductoryTotal[1], introductoryTotal[2] ?? "");
  }
  const issuanceSection =
    text.match(
      /(?:^|\s)5[.、．]\s*發行總金額及股數\s*[:：]?([\s\S]*?)(?=\s6[.、．]\s*|$)/,
    )?.[1] ?? text;
  const patterns = [
    /發行總股數\s*[:：]?\s*(?:普通股\s*)?([\d,.]+)\s*(億|萬|千|仟)?股/,
    /本次發行(?:總)?股數\s*[:：]?\s*(?:普通股\s*)?([\d,.]+)\s*(億|萬|千|仟)?股/,
    /發行股數\s*[（(][^（）()]{0,120}[）)]\s*[:：]?\s*(?:普通股\s*)?([\d,.]+)\s*(億|萬|千|仟)?股/,
    /發行股數\s*[:：]?\s*(?:普通股\s*)?([\d,.]+)\s*(億|萬|千|仟)?股/,
    /(?:發行|增資發行)(?:普通股|新股)\s*([\d,.]+)\s*(億|萬|千|仟)?股/,
  ];
  for (const pattern of patterns) {
    const match = issuanceSection.match(pattern);
    const value = match?.[1];
    if (!value) continue;
    return parseShareCount(value, match?.[2] ?? "");
  }
  throw new Error("公告內找不到有效的發行總股數");
}

/** 將公告中的股數及中文單位換算為安全整數。 */
function parseShareCount(value: string, unit: string): number {
  const multiplier =
    unit === "億"
      ? 100_000_000
      : unit === "萬"
        ? 10_000
        : unit === "千" || unit === "仟"
          ? 1_000
          : 1;
  const shares = Number(value.replaceAll(",", "")) * multiplier;
  if (Number.isSafeInteger(shares) && shares > 0) return shares;
  throw new Error("公告內的發行總股數不是有效整數");
}

function scriptValue(script: string, field: string): string {
  return script.match(new RegExp(`fm1\\.${field}\\.value='([^']*)'`))?.[1] ?? "";
}

function htmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}
