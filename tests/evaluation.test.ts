import { afterEach, expect, it, vi } from "vitest";

vi.mock("../src/clients/subscriptions.js", () => ({
  fetchEndingOfferings: vi.fn().mockResolvedValue([
    {
      code: "6967",
      name: "汎瑋材料",
      issueMarketLabel: "上櫃增資",
      subscriptionEndDate: "2026-08-31",
      actualUnderwritingPrice: 55,
      actualUnderwritingShares: 468_000,
      totalUnderwritingAmount: 25_740_000,
      allotmentDate: "2026-09-10",
      cancelled: false,
    },
  ]),
}));

vi.mock("../src/clients/quotes.js", () => ({
  fetchQuote: vi.fn().mockResolvedValue({
    code: "6967",
    name: "汎瑋材料",
    market: "otc",
    currentPrice: 73.5,
    previousClose: 73.5,
    previousPriceKind: "close",
    quotedAt: "20260831 12:27:00",
    usedPreviousClose: true,
  }),
}));

vi.mock("../src/clients/capital.js", () => ({
  fetchCapitalInfo: vi.fn().mockResolvedValue({
    code: "6967",
    issuedCommonShares: 24_904_477,
  }),
}));

vi.mock("../src/clients/mops-issuance.js", () => ({
  fetchMopsIssuance: vi
    .fn()
    .mockRejectedValue(new Error("HTTP 503：https://example.test/path?token=private")),
}));

import {
  evaluateSubscriptionDateResult,
  warmSubscriptionDateSources,
} from "../src/evaluation.js";
import { fetchCapitalInfo } from "../src/clients/capital.js";
import { fetchMopsIssuance } from "../src/clients/mops-issuance.js";
import { fetchQuote } from "../src/clients/quotes.js";
import { fetchEndingOfferings } from "../src/clients/subscriptions.js";

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

it("未明確允許外部來源時在任何網路請求前停止", async () => {
  await expect(
    evaluateSubscriptionDateResult("2026-08-31", {
      policy: { minDiscountPercent: 20, minSafetyMarginPercent: 10 },
      issuanceOverrides: {},
      externalFetchEnabled: false,
      mopsFetchEnabled: false,
    }),
  ).rejects.toThrow("外部資料來源預設停用");
  expect(fetchEndingOfferings).not.toHaveBeenCalled();
});

it("新增股數失敗時保留原股數並記錄安全化來源錯誤", async () => {
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

  const result = await evaluateSubscriptionDateResult("2026-08-31", {
    policy: { minDiscountPercent: 20, minSafetyMarginPercent: 10 },
    issuanceOverrides: {},
    externalFetchEnabled: true,
    mopsFetchEnabled: true,
  });

  expect(result.message).toContain("原已發行普通股數：24,904,477 股");
  expect(result.message).toContain("本次新增股數：\n");
  expect(result.complete).toBe(false);
  expect(result.incompleteCount).toBe(1);
  expect(errorLog).toHaveBeenCalledWith(
    JSON.stringify({
      event: "official_source_failed",
      date: "2026-08-31",
      code: "6967",
      source: "issuance",
      reason: "HTTP 503：[url]",
    }),
  );
  expect(errorLog.mock.calls.flat().join(" ")).not.toContain("private");
});

it("預熱只取得行情與公司資料，不查 MOPS 或產生訊息", async () => {
  const sourceSnapshots = {
    load: vi.fn(),
    save: vi.fn(),
  };

  await expect(
    warmSubscriptionDateSources("2026-08-31", {
      externalFetchEnabled: true,
      sourceSnapshots,
    }),
  ).resolves.toEqual({
    offeringCount: 1,
    completeOfferingCount: 1,
    sourceFailureCount: 0,
  });
  expect(fetchQuote).toHaveBeenCalledWith(
    expect.any(Object),
    sourceSnapshots,
    undefined,
  );
  expect(fetchCapitalInfo).toHaveBeenCalledWith(
    "6967",
    "上櫃增資",
    sourceSnapshots,
  );
  expect(fetchMopsIssuance).not.toHaveBeenCalled();
});
