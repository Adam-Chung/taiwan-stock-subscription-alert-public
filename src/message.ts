import type { Evaluation, EvaluationFailure } from "./domain/types.js";
import { formatInteger, formatMoney, formatPercent, signed } from "./lib/format.js";

/** 建立當日申購評估結果，並保留無法完成評估案件的已知申購資料。 */
export function buildSuccessMessage(
  date: string,
  evaluated: Evaluation[],
  failures: EvaluationFailure[],
): string {
  const recommended = evaluated.filter((item) => item.recommended);
  const complete = recommended.filter(
    (item) => item.recommendationKind === "complete",
  );
  const priceOnly = recommended.filter(
    (item) => item.recommendationKind === "price-only",
  );
  const consider = recommended.filter(
    (item) => item.recommendationKind === "consider",
  );
  const header = [
    `【台股申購提醒｜${date}】`,
    "",
    `今日截止：${evaluated.length + failures.length} 檔`,
    `完整符合：${complete.length} 檔`,
    `可考慮：${consider.length} 檔`,
    `僅價差符合：${priceOnly.length} 檔`,
    `資料不足：${failures.length} 檔`,
  ];

  if (recommended.length === 0) {
    header.push("", "今日沒有符合篩選條件的股票。");
  } else {
    for (const item of recommended) {
      const hasCompleteIssuance = item.scaleKind === "dilution";
      const isEmerging = item.quote.market === "emerging";
      header.push(
        "",
        `${item.offering.code} ${item.offering.name}`,
        `產業類型：${item.industryType ?? "資料不足"}`,
        `判定：${
          item.recommendationKind === "complete"
            ? "✅ 完整符合"
            : item.recommendationKind === "consider"
              ? "🟠 可考慮"
              : "價差符合，但發行資料不足"
        }`,
        "申購截止：今天",
        `${isEmerging ? "興櫃最近成交價" : "目前股價"}：${formatMoney(item.quote.currentPrice)} 元${
          item.quote.usedPreviousClose
            ? isEmerging
              ? "（最近交易日無成交，使用前日均價）"
              : "（今日尚無成交，使用前收）"
            : ""
        }`,
        `${item.quote.previousPriceKind === "average" ? "前一交易日平均價" : "前一交易日收盤價"}：${
          item.quote.previousClose === undefined
            ? "資料不足"
            : `${formatMoney(item.quote.previousClose)} 元`
        }`,
        `${item.quote.previousPriceKind === "average" ? "較前日均價" : "今日漲跌"}：${
          item.dailyChangeAmount === undefined ||
          item.dailyChangePercent === undefined
            ? "無法計算"
            : `${signed(item.dailyChangeAmount)} 元（${formatPercent(
                item.dailyChangePercent,
              )}）`
        }`,
        "",
        `實際承銷價：${formatMoney(item.offering.actualUnderwritingPrice)} 元`,
        `市價折價率：${formatPercent(item.discountPercent)}`,
        "",
        `原已發行普通股數：${formatOptionalShares(item.issuedCommonShares)}`,
        `本次新增股數：${
          item.totalNewShares === undefined
            ? ""
            : `${formatInteger(item.totalNewShares)} 股`
        }`,
        `發行後總股數：${
          item.postIssueTotalShares === undefined
            ? ""
            : `${formatInteger(item.postIssueTotalShares)} 股`
        }`,
        `股數稀釋率：${
          hasCompleteIssuance && item.scalePercent !== undefined
            ? `${item.scalePercent.toFixed(2)}%`
            : ""
        }`,
        `安全邊際：${
          hasCompleteIssuance && item.safetyMarginPercent !== undefined
            ? `${item.safetyMarginPercent.toFixed(2)} 個百分點`
            : ""
        }`,
        ...(item.warning ? [`注意：${item.warning}`] : []),
        "",
        `公告資訊：https://goodinfo.tw/tw/StockAnnounceList.asp?STOCK_ID=${encodeURIComponent(
          item.offering.code,
        )}`,
      );
    }
  }

  if (failures.length > 0) {
    header.push(
      "",
      `資料不完整：${failures.length} 檔`,
      ...failures.flatMap((item) => [
        "",
        `${item.offering.code} ${item.offering.name}`,
        `產業類型：${item.capital?.industryType ?? "資料不足"}`,
        `案件類型：${item.offering.issueMarketLabel}`,
        `申購截止：${item.offering.subscriptionEndDate}`,
        `實際承銷價：${formatOptionalMoney(item.offering.actualUnderwritingPrice)}`,
        `原已發行普通股數：${formatOptionalShares(item.capital?.issuedCommonShares)}`,
        `整次新增發行股數：${formatOptionalShares(item.issuance?.totalNewShares)}`,
        `發行後總股數：${formatPostIssueShares(item)}`,
        `股數稀釋率：${formatFailureDilution(item)}`,
        `原因：${item.reason}`,
        `公告資訊：https://goodinfo.tw/tw/StockAnnounceList.asp?STOCK_ID=${encodeURIComponent(
          item.offering.code,
        )}`,
      ]),
    );
  }
  header.push("", "提醒：以上為規則篩選結果，不代表保證獲利。");
  return header.join("\n");
}

/** 格式化可能尚未確定的承銷價。 */
function formatOptionalMoney(value: number): string {
  return Number.isFinite(value) && value > 0
    ? `${formatMoney(value)} 元`
    : "資料不足";
}

/** 格式化可能缺失的公開承銷股數。 */
function formatOptionalShares(value: number | undefined): string {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? `${formatInteger(value)} 股`
    : "資料不足";
}

/** 在部分失敗案件同時具備原股本與新增股數時，顯示可驗證的發行後股數。 */
function formatPostIssueShares(item: EvaluationFailure): string {
  const issued = item.capital?.issuedCommonShares;
  const added = item.issuance?.totalNewShares;
  return issued !== undefined && added !== undefined
    ? `${formatInteger(issued + added)} 股`
    : "資料不足";
}

/** 在部分失敗案件具備完整股數時，仍提供稀釋率供使用者判讀。 */
function formatFailureDilution(item: EvaluationFailure): string {
  const issued = item.capital?.issuedCommonShares;
  const added = item.issuance?.totalNewShares;
  return issued !== undefined && added !== undefined
    ? `${((added / (issued + added)) * 100).toFixed(2)}%`
    : "資料不足";
}

/** 建立整體資料來源失敗時的 LINE 異常通知。 */
export function buildFailureMessage(date: string, reason: string): string {
  return [
    `【台股申購提醒｜${date}｜執行異常】`,
    "",
    "今日申購資料未完成評估。",
    `原因：${reason}`,
    "系統不會將本次結果判定為「沒有標的」。",
  ].join("\n");
}
