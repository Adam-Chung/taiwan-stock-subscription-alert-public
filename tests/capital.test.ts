import { afterEach, expect, it, vi } from "vitest";
import { fetchCapitalInfo } from "../src/clients/capital.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("依案件市場取得上櫃與興櫃公司基本資料", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      return new Response(
        JSON.stringify(
          url.includes("mopsfin_t187ap03_O")
            ? [
                {
                  SecuritiesCompanyCode: "8421",
                  IssueShares: "54817140",
                  SecuritiesIndustryCode: "10",
                },
              ]
            : url.includes("mopsfin_t187ap03_R")
            ? [
                {
                  SecuritiesCompanyCode: "7855",
                  IssueShares: "192527928",
                  SecuritiesIndustryCode: "31",
                },
              ]
            : [],
        ),
      );
    }),
  );

  await expect(fetchCapitalInfo("8421", "上櫃增資")).resolves.toEqual({
    code: "8421",
    issuedCommonShares: 54_817_140,
    industryType: "鋼鐵工業（10）",
  });
  await expect(fetchCapitalInfo("7855", "初上市")).resolves.toEqual({
    code: "7855",
    issuedCommonShares: 192_527_928,
    industryType: "其他電子業（31）",
  });
});

it("公司資料來源暫時失敗時不快取缺漏，下一檔可重新取得", async () => {
  vi.resetModules();
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const url = String(input);
    if (!url.includes("mopsfin_t187ap03_O")) return Response.json([]);
    if (fetchMock.mock.calls.length <= 2) {
      return new Response("", { status: 503 });
    }
    return Response.json([
      {
        SecuritiesCompanyCode: "7777",
        IssueShares: "186606250",
        SecuritiesIndustryCode: "20",
      },
    ]);
  });
  vi.stubGlobal("fetch", fetchMock);
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const { fetchCapitalInfo: fetchFreshCapitalInfo } = await import(
    "../src/clients/capital.js"
  );

  await expect(
    fetchFreshCapitalInfo("6186", "上櫃增資"),
  ).rejects.toThrow("上櫃公司資料：HTTP 503");
  await expect(
    fetchFreshCapitalInfo("7777", "上櫃增資"),
  ).resolves.toEqual({
    code: "7777",
    issuedCommonShares: 186_606_250,
    industryType: "其他（20）",
  });
  expect(fetchMock).toHaveBeenCalledTimes(3);
  warning.mockRestore();
});
