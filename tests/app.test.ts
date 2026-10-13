import { beforeEach, expect, it, vi } from "vitest";

vi.mock("../src/clients/subscriptions.js", () => ({
  fetchEndingOfferings: vi.fn().mockResolvedValue([
    {
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
  ]),
}));

vi.mock("../src/clients/quotes.js", () => ({
  fetchQuote: vi.fn().mockRejectedValue(new Error("測試行情缺失")),
}));

vi.mock("../src/clients/capital.js", () => ({
  fetchCapitalInfo: vi.fn().mockResolvedValue({
    code: "7855",
    issuedCommonShares: 192_527_928,
  }),
}));

vi.mock("../src/clients/mops-issuance.js", () => ({
  fetchMopsIssuance: vi.fn(),
}));

vi.mock("../src/config.js", () => ({
  isExternalFetchEnabled: vi.fn().mockReturnValue(true),
  isMopsFetchEnabled: vi.fn().mockReturnValue(false),
  loadIssuanceOverrides: vi.fn().mockResolvedValue({}),
  loadPolicy: vi.fn().mockReturnValue({
    minDiscountPercent: 20,
    minSafetyMarginPercent: 10,
  }),
}));

vi.mock("../src/clients/line.js", () => ({
  pushLineMessageToRecipients: vi.fn(),
}));

import { run } from "../src/app.js";

beforeEach(() => {
  vi.clearAllMocks();
});

it("行情失敗時仍保留已成功取得的原已發行普通股數", async () => {
  const message = await run("2026-08-03", true);

  expect(message).toContain("7855 和運租車");
  expect(message).toContain("原已發行普通股數：192,527,928 股");
  expect(message).toContain("整次新增發行股數：資料不足");
  expect(message).toContain("原因：測試行情缺失");
});
