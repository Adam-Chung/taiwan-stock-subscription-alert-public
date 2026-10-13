import { describe, expect, it } from "vitest";
import { buildSuccessMessage } from "../src/message.js";
import type { Evaluation } from "../src/domain/types.js";

it("通知包含目前股價、前收、今日漲跌幅與股票公告連結", () => {
  const item = {
    offering: {
      code: "1234",
      name: "範例",
      issueMarketLabel: "上市增資",
      subscriptionEndDate: "2026-07-23",
      actualUnderwritingPrice: 60,
      actualUnderwritingShares: 10_000,
      totalUnderwritingAmount: 600_000,
      allotmentDate: "2026-07-30",
      cancelled: false,
    },
    quote: {
      code: "1234",
      name: "範例",
      market: "tse",
      currentPrice: 100,
      previousClose: 95,
      quotedAt: "20260723 10:30:00",
      usedPreviousClose: false,
    },
    discountPercent: 40,
    dailyChangeAmount: 5,
    dailyChangePercent: 5.263,
    issuedCommonShares: 90_000,
    industryType: "電子零組件業（28）",
    totalNewShares: 10_000,
    postIssueTotalShares: 100_000,
    scalePercent: 10,
    scaleKind: "dilution",
    safetyMarginPercent: 30,
    recommendationKind: "complete",
    recommended: true,
  } satisfies Evaluation;
  const message = buildSuccessMessage("2026-07-23", [item], []);
  expect(message).not.toContain("執行成功");
  expect(message).toContain("今日截止：1 檔");
  expect(message).toContain("完整符合：1 檔");
  expect(message).toContain("可考慮：0 檔");
  expect(message).toContain("僅價差符合：0 檔");
  expect(message).toContain("資料不足：0 檔");
  expect(message).not.toContain("已處理案件");
  expect(message).not.toContain("可完成價格評估");
  expect(message).not.toContain("缺少必要資料");
  expect(message).toContain("目前股價：100 元");
  expect(message).not.toContain("價格時間：");
  expect(message).not.toContain("撥券日期");
  expect(message).not.toContain("公開承銷股數");
  expect(message).toContain("前一交易日收盤價：95 元");
  expect(message).toContain("今日漲跌：+5.00 元（+5.26%）");
  expect(message).toContain("產業類型：電子零組件業（28）");
  expect(message).toContain("判定：✅ 完整符合");
  expect(message).not.toContain("承銷價帳面報酬率");
  expect(message).toContain("本次新增股數：10,000 股");
  expect(message).toContain("原已發行普通股數：90,000 股");
  expect(message).toContain("發行後總股數：100,000 股");
  expect(message).toContain("股數稀釋率：10.00%");
  expect(message).toContain("安全邊際：30.00 個百分點");
  expect(message).toContain(
    "公告資訊：https://goodinfo.tw/tw/StockAnnounceList.asp?STOCK_ID=1234",
  );
});

it("沒有入選股票時使用簡短易懂的說明", () => {
  const message = buildSuccessMessage("2026-08-26", [], []);
  expect(message).toContain("今日沒有符合篩選條件的股票。");
  expect(message).not.toContain("今日沒有完整評估後符合條件的股票。");
});

it("價差符合但發行資料不足時保留發行欄位空白", () => {
  const completeItem = {
    offering: {
      code: "5678",
      name: "資料不足範例",
      issueMarketLabel: "上市增資",
      subscriptionEndDate: "2026-07-23",
      actualUnderwritingPrice: 60,
      actualUnderwritingShares: 10_000,
      totalUnderwritingAmount: 600_000,
      allotmentDate: "2026-07-30",
      cancelled: false,
    },
    quote: {
      code: "5678",
      name: "資料不足範例",
      market: "tse",
      currentPrice: 100,
      quotedAt: "20260723 10:30:00",
      usedPreviousClose: false,
    },
    discountPercent: 40,
    issuedCommonShares: 90_000,
    industryType: "電子零組件業（28）",
    recommendationKind: "price-only",
    recommended: true,
    warning: "缺少已發行普通股數，無法計算股數稀釋率與安全邊際",
  } satisfies Evaluation;
  const message = buildSuccessMessage("2026-07-23", [completeItem], []);
  expect(message).toContain("判定：價差符合，但發行資料不足");
  expect(message).toContain("產業類型：電子零組件業（28）");
  expect(message).toContain("前一交易日收盤價：資料不足");
  expect(message).toContain("今日漲跌：無法計算");
  expect(message).toContain("本次新增股數：\n");
  expect(message).toContain("原已發行普通股數：90,000 股");
  expect(message).toContain("發行後總股數：\n");
  expect(message).toContain("股數稀釋率：\n");
  expect(message).toContain("安全邊際：\n");
});

it("資料不完整區塊包含股票代號、名稱與公告連結", () => {
  const failedOffering = {
    code: "8112",
    name: "至上",
    issueMarketLabel: "上市增資",
    subscriptionEndDate: "2026-07-22",
    actualUnderwritingPrice: 66,
    actualUnderwritingShares: 3_480_000,
    totalUnderwritingAmount: 229_680_000,
    allotmentDate: "2026-07-30",
    cancelled: false,
  };
  const message = buildSuccessMessage("2026-07-22", [], [
    {
      offering: failedOffering,
      reason: "測試資料缺少",
      capital: {
        code: "8112",
        issuedCommonShares: 500_000_000,
        industryType: "電子通路業（29）",
      },
    },
  ]);
  expect(message).toContain("8112 至上");
  expect(message).toContain("產業類型：電子通路業（29）");
  expect(message).toContain("實際承銷價：66 元");
  expect(message).not.toContain("公開承銷股數");
  expect(message).not.toContain("撥券日期");
  expect(message).toContain("原已發行普通股數：500,000,000 股");
  expect(message).toContain("整次新增發行股數：資料不足");
  expect(message).toContain("發行後總股數：資料不足");
  expect(message).toContain("原因：測試資料缺少");
  expect(message).toContain(
    "公告資訊：https://goodinfo.tw/tw/StockAnnounceList.asp?STOCK_ID=8112",
  );
});

it("可考慮股票使用橘色判定並納入摘要", () => {
  const item = {
    offering: {
      code: "5284",
      name: "jpp-KY",
      issueMarketLabel: "第一上市公司現金增資",
      subscriptionEndDate: "2026-09-10",
      actualUnderwritingPrice: 250,
      actualUnderwritingShares: 192_000,
      totalUnderwritingAmount: 48_000_000,
      allotmentDate: "2026-09-22",
      cancelled: false,
    },
    quote: {
      code: "5284",
      name: "jpp-KY",
      market: "tse",
      currentPrice: 294.12,
      previousClose: 294.12,
      quotedAt: "20260910 12:30:00",
      usedPreviousClose: true,
    },
    discountPercent: 15,
    issuedCommonShares: 98_000_000,
    industryType: "其他（20）",
    totalNewShares: 2_000_000,
    postIssueTotalShares: 100_000_000,
    scalePercent: 2,
    scaleKind: "dilution",
    safetyMarginPercent: 13,
    recommendationKind: "consider",
    recommended: true,
  } satisfies Evaluation;

  const message = buildSuccessMessage("2026-09-10", [item], []);

  expect(message).toContain("可考慮：1 檔");
  expect(message).toContain("判定：🟠 可考慮");
});

it("資料不完整且公司資料缺失時明示產業類型資料不足", () => {
  const offering = {
    code: "2938",
    name: "床的世界",
    issueMarketLabel: "初上櫃",
    subscriptionEndDate: "2026-09-08",
    actualUnderwritingPrice: 18,
    actualUnderwritingShares: 759_000,
    totalUnderwritingAmount: 13_662_000,
    allotmentDate: "2026-09-16",
    cancelled: false,
  };

  const message = buildSuccessMessage("2026-09-08", [], [
    { offering, reason: "行情資料不足" },
  ]);

  expect(message).toContain("2938 床的世界\n產業類型：資料不足");
});

it("行情失敗但完整股數存在時仍顯示發行後股數與稀釋率", () => {
  const offering = {
    code: "1234",
    name: "部分資料範例",
    issueMarketLabel: "上市增資",
    subscriptionEndDate: "2026-08-03",
    actualUnderwritingPrice: 50,
    actualUnderwritingShares: 1_000_000,
    totalUnderwritingAmount: 50_000_000,
    allotmentDate: "2026-08-11",
    cancelled: false,
  };

  const message = buildSuccessMessage("2026-08-03", [], [
    {
      offering,
      reason: "行情資料不足",
      capital: { code: "1234", issuedCommonShares: 90_000_000 },
      issuance: {
        totalNewShares: 10_000_000,
        sourceUrl: "https://official.example.test",
      },
    },
  ]);

  expect(message).toContain("原已發行普通股數：90,000,000 股");
  expect(message).toContain("整次新增發行股數：10,000,000 股");
  expect(message).toContain("發行後總股數：100,000,000 股");
  expect(message).toContain("股數稀釋率：10.00%");
});

it("興櫃行情明確標示最近成交價與前一交易日平均價", () => {
  const item = {
    offering: {
      code: "7855",
      name: "和運租車",
      issueMarketLabel: "初上市",
      subscriptionEndDate: "2026-08-03",
      actualUnderwritingPrice: 42,
      actualUnderwritingShares: 14_412_000,
      totalUnderwritingAmount: 605_304_000,
      allotmentDate: "2026-08-11",
      cancelled: false,
    },
    quote: {
      code: "7855",
      name: "和運租車",
      market: "emerging",
      currentPrice: 95.7,
      previousClose: 100.4,
      previousPriceKind: "average",
      quotedAt: "2026-07-31 16:30:04",
      usedPreviousClose: false,
    },
    discountPercent: 56.11,
    dailyChangeAmount: -4.7,
    dailyChangePercent: -4.68,
    recommendationKind: "price-only",
    recommended: true,
    warning: "缺少整次新增發行股數，無法計算股數稀釋率與安全邊際",
  } satisfies Evaluation;

  const message = buildSuccessMessage("2026-08-03", [item], []);
  expect(message).toContain("興櫃最近成交價：95.7 元");
  expect(message).toContain("前一交易日平均價：100.4 元");
  expect(message).toContain("較前日均價：-4.70 元（-4.68%）");
});
