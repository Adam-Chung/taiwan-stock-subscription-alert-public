import type { CapitalInfo } from "../domain/types.js";
import { fetchJson } from "./http.js";

type CompanyRow = Record<string, string>;

interface CapitalEndpoint {
  label: string;
  url: string;
}

const ENDPOINTS = {
  listed: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L",
  otc: "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O",
  publicIssuer: "https://openapi.twse.com.tw/v1/opendata/t187ap03_P",
  emerging: "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_R",
} as const;

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

const companyRowsByEndpoint = new Map<string, CompanyRow[]>();

/** 從上市、上櫃、公開發行及興櫃公司開放資料取得已發行普通股數與產業類型。 */
export async function fetchCapitalInfo(
  code: string,
  issueMarketLabel?: string,
): Promise<CapitalInfo> {
  const endpoints = capitalEndpoints(issueMarketLabel);
  const settled = await Promise.allSettled(
    endpoints.map((endpoint) => fetchCompanyRows(endpoint.url)),
  );
  const companyRows = settled.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );

  const row = companyRows.find(
    (item) =>
      (item["公司代號"] ?? item.SecuritiesCompanyCode)?.trim() === code,
  );
  if (!row) {
    const failedSources = settled.flatMap((result, index) =>
      result.status === "rejected"
        ? [`${endpoints[index]?.label ?? "公司資料"}：${safeFailureReason(result.reason)}`]
        : [],
    );
    throw new Error(
      `找不到 ${code} 的公司基本資料${
        failedSources.length > 0
          ? `（${failedSources.join("；")}）`
          : ""
      }`,
    );
  }
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

/** 只快取成功取得的公司資料；暫時失敗不留存，讓後續股票可重新嘗試。 */
async function fetchCompanyRows(endpoint: string): Promise<CompanyRow[]> {
  const cached = companyRowsByEndpoint.get(endpoint);
  if (cached) return cached;
  const rows = await fetchJson<CompanyRow[]>(endpoint, 30_000);
  companyRowsByEndpoint.set(endpoint, rows);
  return rows;
}

/** 將官方產業代碼轉為可讀名稱；未知代碼仍保留原始值，避免隱藏已取得的資料。 */
function formatIndustryType(value: string | undefined): string | undefined {
  const code = value?.trim().padStart(2, "0");
  if (!code) return undefined;
  const name = INDUSTRY_NAMES[code];
  return name ? `${name}（${code}）` : `產業代碼 ${code}`;
}
