import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchQuote } from "../src/clients/quotes.js";
import type { SubscriptionOffering } from "../src/domain/types.js";
import type { JsonSnapshotStore } from "../src/clients/http.js";

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
  vi.restoreAllMocks();
  delete process.env.HTTP_RETRY_BASE_MS;
});

describe("fetchQuote", () => {
  it("初上市案件直接使用具開放授權的興櫃 OpenAPI", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
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

  it("初上櫃案件不查尚未掛牌的 MIS", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json([
        {
          Date: "1151014",
          Time: "163004",
          SecuritiesCompanyCode: "6898",
          CompanyName: "程曦資訊",
          PreviousAveragePrice: "79.59",
          Average: "75.5",
          LatestPrice: "75.5",
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchQuote({
        ...offering,
        code: "6898",
        name: "程曦資訊",
        issueMarketLabel: "初上櫃",
      }),
    ).resolves.toMatchObject({ market: "emerging", currentPrice: 75.5 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("mis.twse.com.tw");
  });

  it("所有官方行情來源皆無資料時回傳可理解的缺漏原因", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify([]))),
    );

    await expect(fetchQuote(offering)).rejects.toThrow(
      "上市即時行情、官方興櫃行情與已授權備援皆未取得",
    );
  });

  it("上市 MIS 三次失敗後使用 Fugle TSE 行情與昨日收盤價", async () => {
    process.env.HTTP_RETRY_BASE_MS = "0";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(
        Response.json({
          date: "2026-10-20",
          market: "TSE",
          symbol: "5284",
          name: "jpp-KY",
          previousClose: 294,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      fetchQuote(
        { ...offering, code: "5284", issueMarketLabel: "上市增資" },
        undefined,
        "fugle-test-key",
      ),
    ).resolves.toMatchObject({
      market: "tse",
      currentPrice: 294,
      previousClose: 294,
      usedPreviousClose: true,
    });
    expect(String(fetchMock.mock.calls[4]?.[0])).toContain(
      "/stock/intraday/quote/5284",
    );
  });

  it("上櫃 MIS 三次失敗後只接受 Fugle OTC 市場行情", async () => {
    process.env.HTTP_RETRY_BASE_MS = "0";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(
        Response.json({
          date: "2026-10-20",
          market: "OTC",
          symbol: "6967",
          name: "汎瑋材料",
          previousClose: 72,
          lastPrice: 73.5,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      fetchQuote(
        { ...offering, code: "6967", issueMarketLabel: "上櫃增資" },
        undefined,
        "fugle-test-key",
      ),
    ).resolves.toMatchObject({
      market: "otc",
      currentPrice: 73.5,
      previousClose: 72,
      usedPreviousClose: false,
    });
  });

  it("TPEx 與官方快照皆失敗時使用已授權的 Fugle 興櫃行情", async () => {
    process.env.HTTP_RETRY_BASE_MS = "0";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({
          date: "2026-10-16",
          market: "ESB",
          symbol: "7855",
          name: "和運租車",
          previousClose: 83.82,
          closePrice: 78.7,
          closeTime: Date.parse("2026-10-16T04:20:00Z"),
          avgPrice: 79.1,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(fetchQuote(offering, undefined, "fugle-test-key")).resolves.toMatchObject({
      market: "emerging",
      currentPrice: 78.7,
      previousClose: 83.82,
      quotedAt: "2026-10-16 12:20:00",
      usedPreviousClose: false,
    });
    expect(fetchMock.mock.calls[3]?.[1]?.headers).toMatchObject({
      "X-API-KEY": "fugle-test-key",
    });
  });

  it("TPEx 暫時失敗時使用期限內官方快照並保留快照時間", async () => {
    process.env.HTTP_RETRY_BASE_MS = "0";
    const storedAt = new Date().toISOString();
    const snapshotStore: JsonSnapshotStore = {
      load: vi.fn().mockResolvedValue({
        storedAt,
        body: JSON.stringify([
          {
            Date: "1151013",
            Time: "163006",
            SecuritiesCompanyCode: "7855",
            CompanyName: "和運租車",
            PreviousAveragePrice: "83.82",
            Average: "78.7",
            LatestPrice: "78.7",
          },
        ]),
      }),
      save: vi.fn(),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 503 })),
    );
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(fetchQuote(offering, snapshotStore)).resolves.toMatchObject({
      market: "emerging",
      currentPrice: 78.7,
      previousClose: 83.82,
      officialSnapshotAt: storedAt,
    });
    expect(snapshotStore.load).toHaveBeenCalledWith("tpex-emerging-quotes");
  });

  it("已上櫃案件將 MIS 行情保存為兩小時內可用的官方快照", async () => {
    const snapshotStore: JsonSnapshotStore = {
      load: vi.fn(),
      save: vi.fn(),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          msgArray: [
            {
              c: "6967",
              n: "汎瑋材料",
              z: "73.5",
              y: "72",
              d: "20261015",
              t: "120000",
            },
          ],
        }),
      ),
    );

    await expect(
      fetchQuote(
        {
          ...offering,
          code: "6967",
          name: "汎瑋材料",
          issueMarketLabel: "上櫃增資",
        },
        snapshotStore,
      ),
    ).resolves.toMatchObject({ market: "otc", currentPrice: 73.5 });
    expect(snapshotStore.save).toHaveBeenCalledWith(
      "mis-otc-6967",
      expect.objectContaining({ storedAt: expect.any(String) }),
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
