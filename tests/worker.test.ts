import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { executeScheduledAlert } from "../worker/index.js";

class FakeKv {
  readonly values = new Map<string, string>();
  getCount = 0;
  putCount = 0;

  /** 模擬 Cloudflare KV 讀取。 */
  async get(key: string): Promise<string | null> {
    this.getCount += 1;
    return this.values.get(key) ?? null;
  }

  /** 模擬 Cloudflare KV 寫入。 */
  async put(key: string, value: string): Promise<void> {
    this.putCount += 1;
    this.values.set(key, value);
  }
}

/** 建立只含 Worker 測試所需 bindings 的環境。 */
function environment(history: FakeKv) {
  return {
    ALERT_HISTORY: history,
    LINE_CHANNEL_ACCESS_TOKEN: "test-token",
    LINE_TARGET_ID_001: "U-test-user",
    LATEST_SEND_TIME: "13:15",
    MIN_DISCOUNT_PERCENT: "20",
    MIN_SAFETY_MARGIN_PERCENT: "10",
    ENABLE_EXTERNAL_FETCH: "true",
    ENABLE_MOPS_FETCH: "true",
  } as never;
}

/** 建立不呼叫外部網路的 Worker 相依項目。 */
function dependencies() {
  return {
    evaluate: vi.fn().mockResolvedValue({
      message: "【台股申購提醒｜2026-08-31】\n測試申購提醒",
      complete: true,
      incompleteCount: 0,
    }),
    deliver: vi.fn().mockImplementation(async (_message, recipients) =>
      recipients.map((recipient: unknown) => ({
        recipient,
        status: "sent" as const,
      })),
    ),
  };
}

describe("Cloudflare scheduled alert", () => {
  it("12:30 主排程成功後寫入 KV，13:00 備援不重複發送", async () => {
    const history = new FakeKv();
    const workerDependencies = dependencies();

    const primary = await executeScheduledAlert(
      new Date("2026-08-31T04:30:00Z"),
      environment(history),
      workerDependencies,
    );
    const backup = await executeScheduledAlert(
      new Date("2026-08-31T05:00:00Z"),
      environment(history),
      workerDependencies,
    );

    expect(primary).toEqual({
      status: "sent",
      date: "2026-08-31",
      sentCount: 1,
    });
    expect(backup).toEqual({
      status: "duplicate",
      date: "2026-08-31",
      sentCount: 0,
    });
    expect(workerDependencies.evaluate).toHaveBeenCalledTimes(1);
    expect(workerDependencies.deliver).toHaveBeenCalledTimes(1);
    expect(history.values.size).toBe(1);
    expect(history.getCount).toBe(2);
    expect(history.putCount).toBe(1);
  });

  it("13:16 已超過期限時拒絕取得資料及發送", async () => {
    const workerDependencies = dependencies();

    await expect(
      executeScheduledAlert(
        new Date("2026-08-31T05:16:00Z"),
        environment(new FakeKv()),
        workerDependencies,
      ),
    ).rejects.toThrow("已超過台灣時間 13:15 發送期限");
    expect(workerDependencies.evaluate).not.toHaveBeenCalled();
    expect(workerDependencies.deliver).not.toHaveBeenCalled();
  });

  it("部分收件者已送達時只補送尚未成功者", async () => {
    const history = new FakeKv();
    const firstHash = createHash("sha256").update("U-first").digest("hex");
    history.values.set("delivery:2026-08-31", JSON.stringify({
      recipients: [
        { alias: "001", hash: firstHash, sentAt: "2026-08-31T04:30:00Z" },
      ],
    }));
    const env = {
      ...environment(history),
      LINE_TARGET_ID_001: "U-first",
      LINE_TARGET_ID_002: "U-second",
    } as never;
    const workerDependencies = dependencies();

    const result = await executeScheduledAlert(
      new Date("2026-08-31T05:00:00Z"),
      env,
      workerDependencies,
    );

    expect(result.sentCount).toBe(1);
    const deliveredRecipients = workerDependencies.deliver.mock.calls[0]?.[1];
    expect(deliveredRecipients).toHaveLength(1);
    expect(deliveredRecipients?.[0]?.targetId).toBe("U-second");
    expect(history.getCount).toBe(1);
    expect(history.putCount).toBe(1);
  });

  it("multicast 整批失敗時不寫 KV，讓備援完整重試", async () => {
    const history = new FakeKv();
    const env = {
      ...environment(history),
      LINE_TARGET_ID_002: "U-second",
      LINE_TARGET_ID_003: "U-third",
    } as never;
    const workerDependencies = dependencies();
    workerDependencies.deliver.mockImplementation(async (_message, recipients) =>
      recipients.map((recipient: unknown) => ({
        recipient,
        status: "failed" as const,
        error: "HTTP 429",
      })),
    );

    await expect(
      executeScheduledAlert(new Date("2026-09-01T04:30:00Z"), env, workerDependencies),
    ).rejects.toThrow("LINE 發送失敗");
    expect(history.getCount).toBe(1);
    expect(history.putCount).toBe(0);
    expect(history.values.size).toBe(0);
  });

  it("12:30 資料不足時，13:00 資料改善會向全部收件者發送更新", async () => {
    const history = new FakeKv();
    const workerDependencies = dependencies();
    workerDependencies.evaluate
      .mockResolvedValueOnce({
        message: "【台股申購提醒｜2026-08-31】\n資料不足：2 檔",
        complete: false,
        incompleteCount: 2,
      })
      .mockResolvedValueOnce({
        message: "【台股申購提醒｜2026-08-31】\n資料不足：0 檔",
        complete: true,
        incompleteCount: 0,
      });

    const primary = await executeScheduledAlert(
      new Date("2026-08-31T04:30:00Z"),
      environment(history),
      workerDependencies,
    );
    const backup = await executeScheduledAlert(
      new Date("2026-08-31T05:00:00Z"),
      environment(history),
      workerDependencies,
    );

    expect(primary.status).toBe("sent");
    expect(backup.status).toBe("updated");
    expect(workerDependencies.deliver).toHaveBeenCalledTimes(2);
    expect(workerDependencies.deliver.mock.calls[1]?.[0]).toContain(
      "【台股申購提醒更新｜",
    );
    expect(JSON.parse(history.values.get("delivery:2026-08-31") ?? "{}")).toEqual(
      expect.objectContaining({ evaluationComplete: true, incompleteCount: 0 }),
    );
  });

  it("13:00 重查後資料未改善時不重複發送", async () => {
    const history = new FakeKv();
    const workerDependencies = dependencies();
    workerDependencies.evaluate.mockResolvedValue({
      message: "【台股申購提醒｜2026-08-31】\n資料不足：1 檔",
      complete: false,
      incompleteCount: 1,
    });

    await executeScheduledAlert(
      new Date("2026-08-31T04:30:00Z"),
      environment(history),
      workerDependencies,
    );
    const backup = await executeScheduledAlert(
      new Date("2026-08-31T05:00:00Z"),
      environment(history),
      workerDependencies,
    );

    expect(backup.status).toBe("unchanged");
    expect(workerDependencies.evaluate).toHaveBeenCalledTimes(2);
    expect(workerDependencies.deliver).toHaveBeenCalledTimes(1);
  });

  it("評估失敗時傳送異常訊息但不寫成功紀錄", async () => {
    const history = new FakeKv();
    const workerDependencies = dependencies();
    workerDependencies.evaluate.mockRejectedValue(new Error("來源失敗"));

    await expect(
      executeScheduledAlert(
        new Date("2026-08-31T04:30:00Z"),
        environment(history),
        workerDependencies,
      ),
    ).rejects.toThrow("執行異常");
    expect(workerDependencies.deliver).toHaveBeenCalledOnce();
    expect(workerDependencies.deliver.mock.calls[0]?.[0]).toContain("來源失敗");
    expect(history.values.size).toBe(0);
  });
});
