const TAIPEI_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function taipeiDate(now = new Date()): string {
  return TAIPEI_DATE.format(now);
}

export function rocDateToIso(value: string): string {
  const match = value.trim().match(/^(\d{2,3})\/(\d{2})\/(\d{2})$/);
  if (!match) throw new Error(`無法解析民國日期：${value}`);
  const [, rocYear, month, day] = match;
  return `${Number(rocYear) + 1911}-${month}-${day}`;
}

export function compactRocDateToIso(value: string): string {
  const match = value.trim().match(/^(\d{3})(\d{2})(\d{2})$/);
  if (!match) throw new Error(`無法解析民國日期：${value}`);
  const [, rocYear, month, day] = match;
  return `${Number(rocYear) + 1911}-${month}-${day}`;
}

export function gregorianYearToRoc(year: number): number {
  return year - 1911;
}
