import { readFile } from "node:fs/promises";
import type { IssuanceOverride } from "./domain/types.js";
import type { EvaluationPolicy } from "./domain/calculations.js";

export function loadPolicy(): EvaluationPolicy {
  return {
    minDiscountPercent: numericEnv("MIN_DISCOUNT_PERCENT", 20),
    minSafetyMarginPercent: numericEnv("MIN_SAFETY_MARGIN_PERCENT", 10),
  };
}

export async function loadIssuanceOverrides(): Promise<
  Record<string, IssuanceOverride>
> {
  const url = new URL("../config/issuance-overrides.json", import.meta.url);
  return JSON.parse(await readFile(url, "utf8")) as Record<string, IssuanceOverride>;
}

/** 判斷使用者是否已明確允許連線外部資料來源。 */
export function isExternalFetchEnabled(): boolean {
  return process.env.ENABLE_EXTERNAL_FETCH === "true";
}

/** 判斷使用者是否已明確允許額外查詢 MOPS。 */
export function isMopsFetchEnabled(): boolean {
  return process.env.ENABLE_MOPS_FETCH === "true";
}

/** 判斷是否允許在官方興櫃行情失敗時使用 Fugle 備援。 */
export function isFugleFetchEnabled(): boolean {
  return process.env.ENABLE_FUGLE_FETCH === "true";
}

function numericEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} 必須是數字`);
  return value;
}
