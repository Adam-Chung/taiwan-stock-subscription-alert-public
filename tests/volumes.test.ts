import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAverageMonthlyVolume } from "../src/clients/volumes.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchAverageMonthlyVolume", () => {
  it("以截止日前 30 個日曆日的有效日 K 成交股數計算交易日日均量", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        symbol: "5284",
        data: [
          { date: "2026-10-17", volume: 100_000 },
          { date: "2026-10-16", volume: 200_001 },
          { date: "2026-10-15" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchAverageMonthlyVolume("5284", "2026-10-20", "fugle-test-key"),
    ).resolves.toBe(150_001);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/historical/candles/5284?from=2026-09-20&to=2026-10-19&timeframe=D&fields=volume",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "X-API-KEY": "fugle-test-key",
    });
  });

  it("沒有有效成交量時回傳 undefined 而不影響主要評估", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValueOnce(
        Response.json({ symbol: "5284", data: [] }),
      ),
    );

    await expect(
      fetchAverageMonthlyVolume("5284", "2026-10-20", "fugle-test-key"),
    ).resolves.toBeUndefined();
  });
});
