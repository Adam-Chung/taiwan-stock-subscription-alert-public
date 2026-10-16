import type { CapitalInfo } from "../domain/types.js";
import { fetchJsonResult, type JsonSnapshotStore } from "./http.js";
import { postFormText } from "./http.js";

type CompanyRow = Record<string, string>;

interface CapitalEndpoint {
  label: string;
  url: string;
}

interface CompanyRowsResult {
  rows: CompanyRow[];
  snapshotAt?: string;
  cacheExpiresAtMs: number;
}

const ENDPOINTS = {
  listed: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L",
  otc: "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O",
  publicIssuer: "https://openapi.twse.com.tw/v1/opendata/t187ap03_P",
  emerging: "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_R",
} as const;

const MOPS_COMPANY_DETAIL_URL =
  "https://mopsov.twse.com.tw/mops/web/ajax_t05st03";

const INDUSTRY_NAMES: Readonly<Record<string, string>> = {
  "01": "水泥工業",
  "02": "食品工業",
  "03": "塑膠工業",
  "04": "紡織纖維",
  "05": "電機機械",
  "06": "電器電纜",
  "08": "玻璃陶瓷",
  "09": "造紙工業",
  "10": "鋼鐵工業",
  "11": "橡膠工業",
  "12": "汽車工業",
  "14": "建材營造",
  "15": "航運業",
  "16": "觀光餐旅",
  "17": "金融保險",
  "18": "貿易百貨",
  "19": "綜合",
  "20": "其他",
  "21": "化學工業",
  "22": "生技醫療",
  "23": "油電燃氣",
  "24": "半導體業",
  "25": "電腦及週邊設備業",
  "26": "光電業",
  "27": "通信網路業",
  "28": "電子零組件業",
  "29": "電子通路業",
  "30": "資訊服務業",
  "31": "其他電子業",
  "32": "文化創意業",
  "33": "農業科技業",
  "34": "電子商務",
  "35": "綠能環保",
  "36": "數位雲端",
  "37": "運動休閒",
  "38": "居家生活",
};

const companyRowsByEndpoint = new Map<string, CompanyRowsResult>();
const COMPANY_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const COMPANY_MEMORY_CACHE_MS = 60 * 60 * 1_000;

/** 從上市、上櫃、公開發行及興櫃公司開放資料取得已發行普通股數與產業類型。 */
export async function fetchCapitalInfo(
  code: string,
  issueMarketLabel?: string,
  snapshotStore?: JsonSnapshotStore,
): Promise<CapitalInfo> {
  const endpoints = capitalEndpoints(issueMarketLabel);
  const settled = await Promise.allSettled(
    endpoints.map((endpoint) => fetchCompanyRows(endpoint.url, snapshotStore)),
  );
  const companyRows = settled.flatMap((result) =>
    result.status === "fulfilled"
      ? result.value.rows.map((row) => ({
          row,
          snapshotAt: result.value.snapshotAt,
        }))
      : [],
  );

  const matched = companyRows.find(
    (item) =>
      (item.row["公司代號"] ?? item.row.SecuritiesCompanyCode)?.trim() === code,
  );
  const failedSources = settled.flatMap((result, index) =>
    result.status === "rejected"
      ? [`${endpoints[index]?.label ?? "公司資料"}：${safeFailureReason(result.reason)}`]
      : [],
  );
  if (matched) {
    try {
      return capitalInfoFromCompanyRow(code, matched.row, matched.snapshotAt);
    } catch (error) {
      failedSources.push(`公司資料：${safeFailureReason(error)}`);
    }
  }

  try {
    return await fetchMopsCapitalInfo(code);
  } catch (error) {
    failedSources.push(`MOPS 公司詳細資料：${safeFailureReason(error)}`);
  }

  throw new Error(
    `找不到 ${code} 的公司基本資料${
      failedSources.length > 0 ? `（${failedSources.join("；")}）` : ""
    }`,
  );
}

/** 將官方公司資料列轉為股本資訊，無效股數由上層改查 MOPS 詳細資料。 */
function capitalInfoFromCompanyRow(
  code: string,
  row: CompanyRow,
  snapshotAt: string | undefined,
): CapitalInfo {
  const issuedCommonShares = Number(
    (
      row["已發行普通股數或TDR原股發行股數"] ??
      row.IssueShares ??
      ""
    ).replaceAll(",", ""),
  );
  if (!Number.isFinite(issuedCommonShares) || issuedCommonShares <= 0) {
    throw new Error(`${code} 已發行普通股數無效`);
  }
  const industryType = formatIndustryType(
    row["產業別"] ?? row.SecuritiesIndustryCode,
  );
  return {
    code,
    issuedCommonShares,
    ...(industryType ? { industryType } : {}),
    ...(snapshotAt ? { officialSnapshotAt: snapshotAt } : {}),
  };
}

/** 從 MOPS 公司詳細資料取得已發行普通股數與產業，作為 TPEx 暫時失敗的官方備援。 */
async function fetchMopsCapitalInfo(code: string): Promise<CapitalInfo> {
  const html = await postFormText(MOPS_COMPANY_DETAIL_URL, {
    step: "1",
    firstin: "1",
    TYPEK: "all",
    co_id: code,
  });
  return parseMopsCapitalInfo(code, html);
}

/** 解析 MOPS 公司詳細資料，並拒絕股票代號不符或缺少有效股數的頁面。 */
export function parseMopsCapitalInfo(code: string, html: string): CapitalInfo {
  const text = mopsHtmlToText(html);
  const returnedCode = text.match(/股票代號\s*([0-9A-Za-z]+)/)?.[1];
  if (returnedCode !== code) throw new Error("MOPS 公司代號不符");

  const issuedCommonShares = Number(
    (
      text.match(
        /已發行普通股數或\s*TDR原股發行股數\s*([\d,]+)\s*股/,
      )?.[1] ?? ""
    ).replaceAll(",", ""),
  );
  if (!Number.isSafeInteger(issuedCommonShares) || issuedCommonShares <= 0) {
    throw new Error(`${code} MOPS 已發行普通股數無效`);
  }

  const industryName = text
    .match(/產業類別\s*(.*?)\s*外國企業註冊地國/)?.[1]
    ?.trim();
  const industryType = formatIndustryName(industryName);
  return {
    code,
    issuedCommonShares,
    ...(industryType ? { industryType } : {}),
  };
}

/** 依申購市場限制公司資料來源，降低無關請求與 Cloudflare subrequest 用量。 */
function capitalEndpoints(issueMarketLabel: string | undefined): CapitalEndpoint[] {
  const listed = { label: "上市公司資料", url: ENDPOINTS.listed };
  const otc = { label: "上櫃公司資料", url: ENDPOINTS.otc };
  const publicIssuer = { label: "公開發行公司資料", url: ENDPOINTS.publicIssuer };
  const emerging = { label: "興櫃公司資料", url: ENDPOINTS.emerging };
  if (
    issueMarketLabel === "上市增資" ||
    issueMarketLabel === "第一上市公司現金增資" ||
    issueMarketLabel === "創新板上市現增"
  ) {
    return [listed];
  }
  if (
    issueMarketLabel === "上櫃增資" ||
    issueMarketLabel === "第一上櫃公司現金增資"
  ) {
    return [otc];
  }
  if (
    issueMarketLabel === "初上市" ||
    issueMarketLabel === "初上櫃" ||
    issueMarketLabel === "創新板初上市" ||
    issueMarketLabel === "第一上市公司初上市" ||
    issueMarketLabel === "第一上櫃公司初上櫃"
  ) {
    return [emerging, publicIssuer];
  }
  if (issueMarketLabel === "創新板轉列上櫃") {
    return [listed, otc];
  }
  return [listed, otc, publicIssuer, emerging];
}

/** 保留來源回應狀態但移除網址與回應內容。 */
function safeFailureReason(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  const httpStatus = message.match(/HTTP\s+\d{3}/)?.[0];
  return httpStatus ?? (reason instanceof Error ? reason.name : "UnknownError");
}

/** 快取成功或有效快照的公司資料，並以期限避免 Worker isolate 長期沿用舊值。 */
async function fetchCompanyRows(
  endpoint: string,
  snapshotStore?: JsonSnapshotStore,
): Promise<CompanyRowsResult> {
  const cached = companyRowsByEndpoint.get(endpoint);
  if (cached && cached.cacheExpiresAtMs > Date.now()) return cached;
  if (cached) companyRowsByEndpoint.delete(endpoint);
  const result = await fetchJsonResult<CompanyRow[]>(
    endpoint,
    30_000,
    snapshotStore
      ? {
          store: snapshotStore,
          key: companySnapshotKey(endpoint),
          maxAgeMs: COMPANY_SNAPSHOT_MAX_AGE_MS,
        }
      : undefined,
  );
  const rows = {
    rows: result.value,
    ...(result.snapshotAt ? { snapshotAt: result.snapshotAt } : {}),
    cacheExpiresAtMs: result.snapshotAt
      ? Date.parse(result.snapshotAt) + COMPANY_SNAPSHOT_MAX_AGE_MS
      : Date.now() + COMPANY_MEMORY_CACHE_MS,
  };
  companyRowsByEndpoint.set(endpoint, rows);
  return rows;
}

/** 以固定名稱區分官方公司資料集，避免將完整 URL 或查詢參數寫入 KV。 */
function companySnapshotKey(endpoint: string): string {
  const entry = Object.entries(ENDPOINTS).find(([, url]) => url === endpoint);
  if (!entry) throw new Error("未知的公司資料快取來源");
  return `company-${entry[0]}`;
}

/** 將官方產業代碼轉為可讀名稱；未知代碼仍保留原始值，避免隱藏已取得的資料。 */
function formatIndustryType(value: string | undefined): string | undefined {
  const code = value?.trim().padStart(2, "0");
  if (!code) return undefined;
  const name = INDUSTRY_NAMES[code];
  return name ? `${name}（${code}）` : `產業代碼 ${code}`;
}

/** 將 MOPS 產業名稱補上既有產業代碼；未知名稱仍原樣保留。 */
function formatIndustryName(value: string | undefined): string | undefined {
  const name = value?.trim();
  if (!name) return undefined;
  const matched = Object.entries(INDUSTRY_NAMES).find(
    ([, industryName]) => industryName === name,
  );
  return matched ? `${name}（${matched[0]}）` : name;
}

/** 將 MOPS HTML 轉成只供欄位解析的單行文字。 */
function mopsHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}
