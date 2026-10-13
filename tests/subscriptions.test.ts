import { afterEach, expect, it, vi } from "vitest";
import { fetchEndingOfferings } from "../src/clients/subscriptions.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("納入最近一年出現的股票申購市場詞彙並排除公債", async () => {
  const marketLabels = [
    "第一上市公司現金增資",
    "第一上市公司初上市",
    "第一上櫃公司初上櫃",
    "第一上櫃公司現金增資",
    "創新板上市現增",
    "創新板轉列上櫃",
    "中央登錄公債",
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        stat: "OK",
        fields: [],
        data: marketLabels.map((market, index) => [
          String(index + 1),
          "115/09/14",
          `範例${index}`,
          String(5284 + index),
          market,
          "115/09/08",
          "115/09/10",
          "192,000",
          "192,000",
          "250",
          "250",
          "115/09/22",
          "凱基",
          "1,000",
          "48,000,000",
          "0",
          "0",
          "",
        ]),
      }),
    ),
  );

  const offerings = await fetchEndingOfferings("2026-09-10");

  expect(offerings.map((offering) => offering.issueMarketLabel)).toEqual(
    marketLabels.filter((market) => market !== "中央登錄公債"),
  );
});
