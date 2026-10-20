import { fetchJsonResult, type JsonSnapshotStore } from "./http.js";

interface FugleHistoricalCandle {
  date: string;
  volume?: number;
}

interface FugleHistoricalCandlesResponse {
  symbol: string;
  data?: FugleHistoricalCandle[];
}

const FUGLE_VOLUME_SNAPSHOT_MAX_AGE_MS = 36 * 60 * 60 * 1_000;

/** 取得截止日前 30 個日曆日內有日 K 資料之交易日日均成交股數。 */
export async function fetchAverageMonthlyVolume(
  code: string,
  subscriptionEndDate: string,
  apiKey: string,
  snapshotStore?: JsonSnapshotStore,
): Promise<number | undefined> {
  const to = shiftIsoDate(subscriptionEndDate, -1);
  const from = shiftIsoDate(subscriptionEndDate, -30);
  const url =
    `https://api.fugle.tw/marketdata/v1.0/stock/historical/candles/${encodeURIComponent(code)}` +
    `?from=${from}&to=${to}&timeframe=D&fields=volume`;
  const result = await fetchJsonResult<FugleHistoricalCandlesResponse>(
    url,
    20_000,
    snapshotStore
      ? {
          store: snapshotStore,
          key: `fugle-volume-${code}-${subscriptionEndDate}`,
          maxAgeMs: FUGLE_VOLUME_SNAPSHOT_MAX_AGE_MS,
        }
      : undefined,
    { "X-API-KEY": apiKey },
  );
  if (result.value.symbol !== code) return undefined;
  const volumes = (result.value.data ?? [])
    .map((item) => item.volume)
    .filter((volume): volume is number =>
      volume !== undefined && Number.isFinite(volume) && volume >= 0
    );
  if (volumes.length === 0) return undefined;
  return Math.round(volumes.reduce((sum, volume) => sum + volume, 0) / volumes.length);
}

/** 以 UTC 日曆運算位移 ISO 日期，避免執行環境時區改變查詢範圍。 */
function shiftIsoDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("申購截止日期格式無效");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
