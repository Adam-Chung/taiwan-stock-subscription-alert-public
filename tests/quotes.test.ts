import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchQuote } from "../src/clients/quotes.js";
import type { SubscriptionOffering } from "../src/domain/types.js";

const offering: SubscriptionOffering = {
  code: "7855",
  name: "和運租車",
  issueMarketLabel: "初上市",
  subscriptionEndDate: "2026-08-03",
  actualUnderwritingPrice: 42,
  actualUnderwritingShares: 14_412_000,
  totalUnderwritingAmount: 605_304_000,
  allotmentDate: "2026-08-11",
  cancelled: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchQuote", () => {
  it("初上市案件在 MIS 無資料時改用具開放授權的興櫃 OpenAPI", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ msgArray: [{ c: "", z: "-" }] })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              Date: "1150731",
              Time: "163004",
              SecuritiesCompanyCode: "7855",
              CompanyName: "和運租車",
              PreviousAveragePrice: "100.4",
              Average: "96.27",
              LatestPrice: "95.7",
            },
          ]),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const quote = await fetchQuote(offering);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://www.tpex.org.tw/openapi/v1/tpex_esb_latest_statistics",
    );
    expect(quote).toMatchObject({
      market: "emerging",
      currentPrice: 95.7,
      previousClose: 100.4,
      previousPriceKind: "average",
      quotedAt: "2026-07-31 16:30:04",
      usedPreviousClose: false,
    });
  });

  it("所有官方行情來源皆無資料時回傳可理解的缺漏原因", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ msgArray: [{ c: "", z: "-" }] })),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify([]))),
    );

    await expect(fetchQuote(offering)).rejects.toThrow(
      "上市即時行情與官方興櫃行情皆未取得",
    );
  });

  it("創新板轉列上櫃先查轉列前仍可能存在的上市行情", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        msgArray: [
          {
            c: "6423",
            n: "億而得",
            z: "80",
            y: "78",
            d: "20260114",
            t: "123000",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const quote = await fetchQuote({
      ...offering,
      code: "6423",
      name: "億而得",
      issueMarketLabel: "創新板轉列上櫃",
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("ex_ch=tse_6423.tw");
    expect(quote.market).toBe("tse");
  });
});
