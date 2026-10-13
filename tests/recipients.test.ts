import { describe, expect, it } from "vitest";
import { hashRecipientId, loadRecipients } from "../src/recipients.js";

describe("loadRecipients", () => {
  it("載入所有前綴相符的非空變數並由後綴產生 alias", () => {
    expect(
      loadRecipients({
        LINE_TARGET_ID_ADAM: " U-adam ",
        LINE_TARGET_ID_TEAM_ALPHA: "U-team-alpha",
        LINE_TARGET_ID_EMPTY: " ",
        OTHER_SECRET: "ignored",
      }),
    ).toEqual([
      {
        alias: "Adam",
        targetId: "U-adam",
        hash: hashRecipientId("U-adam"),
      },
      {
        alias: "Team Alpha",
        targetId: "U-team-alpha",
        hash: hashRecipientId("U-team-alpha"),
      },
    ]);
  });

  it("不限制程式層收件者數量", () => {
    const environment = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [
        `LINE_TARGET_ID_USER_${index + 1}`,
        `U-${index + 1}`,
      ]),
    );
    expect(loadRecipients(environment)).toHaveLength(20);
  });

  it("不接受舊的單一變數名稱", () => {
    expect(() => loadRecipients({ LINE_TARGET_ID: "U-legacy" })).toThrow(
      "LINE_TARGET_ID_<ALIAS>",
    );
  });

  it("拒絕重複 userId", () => {
    expect(() =>
      loadRecipients({
        LINE_TARGET_ID_001: "U-same",
        LINE_TARGET_ID_002: "U-same",
      }),
    ).toThrow("重複 userId");
  });
});
