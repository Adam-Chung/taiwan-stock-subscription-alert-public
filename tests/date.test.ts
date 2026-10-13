import { describe, expect, it } from "vitest";
import { rocDateToIso, taipeiDate } from "../src/lib/date.js";

describe("date", () => {
  it("轉換民國日期", () => {
    expect(rocDateToIso("115/07/23")).toBe("2026-07-23");
  });

  it("使用台北時區決定執行日期", () => {
    expect(taipeiDate(new Date("2026-07-22T16:30:00Z"))).toBe("2026-07-23");
  });
});
