import { afterEach, expect, it, vi } from "vitest";
import { fetchJson, postFormText } from "../src/clients/http.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("官方來源暫時回傳 503 時重試一次後成功", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response("", { status: 503 }))
    .mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

  await expect(fetchJson<{ ok: boolean }>("https://retry.example/data")).resolves.toEqual({
    ok: true,
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(warning).toHaveBeenCalledWith(
    JSON.stringify({
      event: "official_source_retry",
      host: "retry.example",
      nextAttempt: 2,
      reason: "HTTP 503",
    }),
  );
});

it("官方來源暫時回傳 520 時重試一次後成功", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response("", { status: 520 }))
    .mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

  await expect(fetchJson<{ ok: boolean }>("https://retry.example/data")).resolves.toEqual({
    ok: true,
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(warning).toHaveBeenCalledWith(
    JSON.stringify({
      event: "official_source_retry",
      host: "retry.example",
      nextAttempt: 2,
      reason: "HTTP 520",
    }),
  );
});

it("MOPS 暫時錯誤時最多嘗試三次並可在第三次成功", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError("temporary network error"))
    .mockResolvedValueOnce(new Response("", { status: 520 }))
    .mockResolvedValueOnce(new Response("ok"));
  vi.stubGlobal("fetch", fetchMock);
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

  await expect(
    postFormText("https://mops.example/form", { code: "6667" }),
  ).resolves.toBe("ok");
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(warning).toHaveBeenCalledTimes(2);
});

it("MOPS 三次暫時錯誤後才放棄", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("", { status: 503 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);

  await expect(
    postFormText("https://mops.example/form", { code: "6667" }),
  ).rejects.toThrow("HTTP 503");
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it("來源回傳不可恢復的 403 時不重試", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("", { status: 403 }));
  vi.stubGlobal("fetch", fetchMock);

  await expect(fetchJson("https://blocked.example/data")).rejects.toThrow(
    "HTTP 403",
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("JSON 與 MOPS 請求都禁止自動跟隨 redirect", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ ok: true }))
    .mockResolvedValueOnce(new Response("ok"));
  vi.stubGlobal("fetch", fetchMock);

  await fetchJson("https://json.example/data");
  await postFormText("https://mops.example/form", { code: "6967" });

  expect(fetchMock.mock.calls[0]?.[1]).toEqual(
    expect.objectContaining({ redirect: "manual" }),
  );
  expect(fetchMock.mock.calls[1]?.[1]).toEqual(
    expect.objectContaining({ redirect: "manual" }),
  );
});

it("來源 302 時重試相同網址但不跟隨 redirect", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response("", {
      status: 302,
      headers: { location: "https://unexpected.example/target" },
    }))
    .mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);

  await expect(fetchJson("https://redirect.example/data")).resolves.toEqual({
    ok: true,
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
    "https://redirect.example/data",
    "https://redirect.example/data",
  ]);
});

it("已耗盡 subrequest 時不做無效重試", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new Error("Too many subrequests by single Worker invocation."));
  vi.stubGlobal("fetch", fetchMock);

  await expect(fetchJson("https://budget.example/data")).rejects.toThrow(
    "Too many subrequests",
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
