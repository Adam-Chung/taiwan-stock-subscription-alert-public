import { describe, expect, it } from "vitest";
import { evaluateOffering } from "../src/domain/calculations.js";
import type { CapitalInfo, Quote, SubscriptionOffering } from "../src/domain/types.js";

const offering: SubscriptionOffering = {
  code: "1234",
  name: "範例",
  issueMarketLabel: "上市增資",
  subscriptionEndDate: "2026-07-23",
  actualUnderwritingPrice: 60,
  actualUnderwritingShares: 10_000,
  totalUnderwritingAmount: 600_000,
  allotmentDate: "2026-07-30",
  cancelled: false,
};
const quote: Quote = {
  code: "1234",
  name: "範例",
  market: "tse",
  currentPrice: 100,
  previousClose: 95,
  quotedAt: "20260723 10:30:00",
  usedPreviousClose: false,
};
const capital: CapitalInfo = { code: "1234", issuedCommonShares: 90_000 };

describe("evaluateOffering", () => {
  it("依使用者定義計算折價率、漲跌幅與完整稀釋率", () => {
    const result = evaluateOffering(
      offering,
      quote,
      capital,
      { totalNewShares: 10_000, sourceUrl: "https://example.test" },
      {
        minDiscountPercent: 20,
        minSafetyMarginPercent: 10,
      },
    );
    expect(result.discountPercent).toBeCloseTo(40);
    expect(result.dailyChangePercent).toBeCloseTo(5.2632);
    expect(result.issuedCommonShares).toBe(90_000);
    expect(result.scalePercent).toBeCloseTo(10);
    expect(result.safetyMarginPercent).toBeCloseTo(30);
    expect(result.recommendationKind).toBe("complete");
    expect(result.recommended).toBe(true);
  });

  it("strict 模式缺少完整新增股數時仍回報價差符合", () => {
    const result = evaluateOffering(offering, quote, capital, undefined, {
      minDiscountPercent: 20,
      minSafetyMarginPercent: 10,
    });
    expect(result.recommendationKind).toBe("price-only");
    expect(result.recommended).toBe(true);
    expect(result.scalePercent).toBeUndefined();
    expect(result.issuedCommonShares).toBe(90_000);
    expect(result.safetyMarginPercent).toBeUndefined();
    expect(result.warning).toContain("缺少整次新增發行股數");
  });

  it("缺少已發行普通股數時仍回報價差符合", () => {
    const result = evaluateOffering(
      offering,
      quote,
      undefined,
      { totalNewShares: 10_000, sourceUrl: "https://example.test" },
      {
        minDiscountPercent: 20,
        minSafetyMarginPercent: 10,
      },
    );
    expect(result.recommendationKind).toBe("price-only");
    expect(result.warning).toContain("缺少已發行普通股數");
  });

  it("缺少前收仍可依目前股價評估，但不計算漲跌幅", () => {
    const result = evaluateOffering(
      offering,
      { ...quote, previousClose: undefined },
      capital,
      { totalNewShares: 10_000, sourceUrl: "https://example.test" },
      {
        minDiscountPercent: 20,
        minSafetyMarginPercent: 10,
      },
    );
    expect(result.recommendationKind).toBe("complete");
    expect(result.dailyChangePercent).toBeUndefined();
  });

  it("門檻採嚴格大於而非大於等於", () => {
    const exactTwentyQuote = { ...quote, currentPrice: 75, previousClose: 75 };
    const result = evaluateOffering(
      offering,
      exactTwentyQuote,
      capital,
      { totalNewShares: 10_000, sourceUrl: "https://example.test" },
      {
        minDiscountPercent: 20,
        minSafetyMarginPercent: 0,
      },
    );
    expect(result.discountPercent).toBeCloseTo(20);
    expect(result.recommended).toBe(false);
  });

  it("折價率介於 10% 與 20%、稀釋率低於 5% 且安全邊際大於 10% 時可考慮", () => {
    const result = evaluateOffering(
      { ...offering, actualUnderwritingPrice: 85 },
      quote,
      { code: "1234", issuedCommonShares: 98_000 },
      { totalNewShares: 2_000, sourceUrl: "https://example.test" },
      {
        minDiscountPercent: 20,
        minSafetyMarginPercent: 10,
      },
    );

    expect(result.discountPercent).toBeCloseTo(15);
    expect(result.scalePercent).toBeCloseTo(2);
    expect(result.safetyMarginPercent).toBeCloseTo(13);
    expect(result.recommendationKind).toBe("consider");
    expect(result.recommended).toBe(true);
  });

  it.each([
    ["折價率等於 10%", 90, 98_000, 2_000],
    ["稀釋率等於 5%", 84, 95_000, 5_000],
    ["安全邊際等於 10%", 86, 96_000, 4_000],
  ])("%s 不列為可考慮", (_label, underwritingPrice, issued, added) => {
    const result = evaluateOffering(
      { ...offering, actualUnderwritingPrice: underwritingPrice },
      quote,
      { code: "1234", issuedCommonShares: issued },
      { totalNewShares: added, sourceUrl: "https://example.test" },
      {
        minDiscountPercent: 20,
        minSafetyMarginPercent: 10,
      },
    );

    expect(result.recommendationKind).toBe("none");
  });
});
