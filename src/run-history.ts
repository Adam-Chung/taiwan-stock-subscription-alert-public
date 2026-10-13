import { mkdir, readFile, writeFile } from "node:fs/promises";

interface History {
  dates: Record<
    string,
    {
      recipients: Record<string, { alias: string; sentAt: string }>;
    }
  >;
}

const HISTORY_PATH = new URL("../data/run-history.json", import.meta.url);

export async function loadSentRecipientHashes(date: string): Promise<Set<string>> {
  const history = await readHistory();
  return new Set(Object.keys(history.dates[date]?.recipients ?? {}));
}

export async function recordSuccessfulDeliveries(
  date: string,
  recipients: Array<{ alias: string; hash: string }>,
): Promise<void> {
  if (recipients.length === 0) return;
  const history = await readHistory();
  const dateRecord = (history.dates[date] ??= { recipients: {} });
  const sentAt = new Date().toISOString();
  for (const recipient of recipients) {
    dateRecord.recipients[recipient.hash] = { alias: recipient.alias, sentAt };
  }
  await mkdir(new URL("../data/", import.meta.url), { recursive: true });
  await writeFile(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, "utf8");
}

async function readHistory(): Promise<History> {
  try {
    return JSON.parse(await readFile(HISTORY_PATH, "utf8")) as History;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { dates: {} };
    throw error;
  }
}
