import { afterEach, expect, it, vi } from "vitest";
import {
  fetchJson,
  fetchJsonResult,
  postFormText,
  type JsonSnapshotStore,
} from "../src/clients/http.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.HTTP_RETRY_BASE_MS;
});

it("官方來源暫時回傳 503 時重試一次後成功", async () => {
  process.env.HTTP_RETRY_BASE_MS = "0";
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
      waitMs: 0,
    }),
  );
});

it("官方來源暫時回傳 520 時重試一次後成功", async () => {
  process.env.HTTP_RETRY_BASE_MS = "0";
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
      waitMs: 0,
    }),
  );
});

it("MOPS 暫時錯誤時最多嘗試三次並可在第三次成功", async () => {
  process.env.HTTP_RETRY_BASE_MS = "0";
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
  process.env.HTTP_RETRY_BASE_MS = "0";
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

it("JSON 與 MOPS 請求都禁止 fetch 自動跟隨 redirect", async () => {
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
  process.env.HTTP_RETRY_BASE_MS = "0";
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

it("TPEx 官方 OpenAPI 302 只在 HTTPS 白名單內手動跟隨", async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response("", {
        status: 302,
        headers: {
          location: "https://www.tpex.org.tw/openapi/v1/redirected-data",
        },
      }),
    )
    .mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

  await expect(
    fetchJson("https://www.tpex.org.tw/openapi/v1/original-data"),
  ).resolves.toEqual({ ok: true });

  expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
    "https://www.tpex.org.tw/openapi/v1/original-data",
    "https://www.tpex.org.tw/openapi/v1/redirected-data",
  ]);
  expect(info).toHaveBeenCalledWith(
    JSON.stringify({
      event: "official_source_redirect",
      sourceHost: "www.tpex.org.tw",
      targetHost: "www.tpex.org.tw",
      targetPath: "/openapi/v1/redirected-data",
      status: 302,
      redirectNumber: 1,
    }),
  );
});

it("一般 JSON 來源三次暫時錯誤後才使用期限內官方快照", async () => {
  process.env.HTTP_RETRY_BASE_MS = "0";
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("", { status: 503 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const snapshotStore: JsonSnapshotStore = {
    load: vi.fn().mockResolvedValue({
      storedAt: new Date().toISOString(),
      body: JSON.stringify({ ok: "cached" }),
    }),
    save: vi.fn(),
  };

  await expect(
    fetchJsonResult("https://www.tpex.org.tw/openapi/v1/data", 20_000, {
      store: snapshotStore,
      key: "test-data",
      maxAgeMs: 60_000,
    }),
  ).resolves.toEqual({
    value: { ok: "cached" },
    snapshotAt: expect.any(String),
  });
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(snapshotStore.load).toHaveBeenCalledWith("test-data");
});

it("官方 JSON 成功但 KV 寫入失敗時仍回傳即時資料", async () => {
  const snapshotStore: JsonSnapshotStore = {
    load: vi.fn(),
    save: vi.fn().mockRejectedValue(new Error("KV unavailable")),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: "live" })),
  );
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

  await expect(
    fetchJsonResult("https://www.tpex.org.tw/openapi/v1/data", 20_000, {
      store: snapshotStore,
      key: "test-data",
      maxAgeMs: 60_000,
    }),
  ).resolves.toEqual({ value: { ok: "live" } });
  expect(snapshotStore.load).not.toHaveBeenCalled();
  expect(warning).toHaveBeenCalledWith(
    JSON.stringify({
      event: "official_source_cache_write_failed",
      reason: "Error",
    }),
  );
});

it("官方 JSON 回傳 HTML 時重試後拒絕解析內容", async () => {
  process.env.HTTP_RETRY_BASE_MS = "0";
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response("<html>challenge</html>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  await expect(
    fetchJson("https://www.tpex.org.tw/openapi/v1/data"),
  ).rejects.toThrow("非 JSON 內容");
  expect(fetchMock).toHaveBeenCalledTimes(3);
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
