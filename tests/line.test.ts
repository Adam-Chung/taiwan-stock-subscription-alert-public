import { afterEach, describe, expect, it, vi } from "vitest";
import { pushLineMessageToRecipients } from "../src/clients/line.js";
import { hashRecipientId } from "../src/recipients.js";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
});

describe("pushLineMessageToRecipients", () => {
  it("以單次 multicast 發送所有收件者", async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-token";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const recipients = [
      { alias: "One", targetId: "U-1", hash: hashRecipientId("U-1") },
      { alias: "Two", targetId: "U-2", hash: hashRecipientId("U-2") },
    ];
    const outcomes = await pushLineMessageToRecipients("hello", recipients);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.line.me/v2/bot/message/multicast",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          to: ["U-1", "U-2"],
          messages: [{ type: "text", text: "hello" }],
        }),
      }),
    );
    expect(outcomes.map(({ status }) => status)).toEqual(["sent", "sent"]);
  });

  it("multicast 失敗時記錄清理後的 response body 並保留整批給備援", async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-token";
    const lineUserId = `U${"a".repeat(32)}`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            message: "Authentication failed",
            userId: lineUserId,
            authorization: "Bearer secret-value",
          }),
          {
            status: 403,
            headers: { "x-line-request-id": "request-123" },
          },
        ),
      ),
    );
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const recipients = [
      { alias: "One", targetId: "U-1", hash: hashRecipientId("U-1") },
      { alias: "Two", targetId: "U-2", hash: hashRecipientId("U-2") },
    ];

    const outcomes = await pushLineMessageToRecipients("hello", recipients);

    expect(outcomes.map(({ status }) => status)).toEqual(["failed", "failed"]);
    expect(outcomes[0]?.error).toContain("HTTP 403");
    expect(outcomes[0]?.error).toContain("request-123");
    expect(errorLog).toHaveBeenCalledWith(
      JSON.stringify({
        event: "line_delivery_failed",
        attempts: 1,
        reason: "HTTP 403",
        status: 403,
        requestId: "request-123",
        responseBody:
          '{"message":"Authentication failed","userId":"[redacted]","authorization":"[redacted]"}',
      }),
    );
    expect(errorLog.mock.calls.flat().join(" ")).not.toContain(lineUserId);
    expect(errorLog.mock.calls.flat().join(" ")).not.toContain("secret-value");
  });

  it("LINE 429 時在同次執行有限重試後成功", async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-token";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const recipients = [
      { alias: "One", targetId: "U-1", hash: hashRecipientId("U-1") },
    ];

    const outcomes = await pushLineMessageToRecipients("hello", recipients);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(outcomes[0]?.status).toBe("sent");
  });
});
