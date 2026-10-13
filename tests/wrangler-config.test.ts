import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/** 移除 JSONC 註解並解析 Public Wrangler 設定。 */
async function loadWranglerConfig(): Promise<Record<string, unknown>> {
  const raw = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  return JSON.parse(raw.replace(/\/\/.*$/gm, "")) as Record<string, unknown>;
}

describe("Public Cloudflare configuration", () => {
  it("不含正式 Cron 或 KV，且外部來源預設停用", async () => {
    const config = await loadWranglerConfig();
    expect(config).not.toHaveProperty("triggers");
    expect(config).not.toHaveProperty("kv_namespaces");
    expect(config.vars).toEqual(
      expect.objectContaining({
        ENABLE_EXTERNAL_FETCH: "false",
        ENABLE_MOPS_FETCH: "false",
      }),
    );
  });
});
