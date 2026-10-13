import { createHash } from "node:crypto";

export interface LineRecipient {
  alias: string;
  targetId: string;
  hash: string;
}

const PREFIX = "LINE_TARGET_ID_";

export function loadRecipients(
  environment: Record<string, string | undefined> = process.env,
): LineRecipient[] {
  const recipients = Object.entries(environment)
    .filter(
      ([name, value]) =>
        name.startsWith(PREFIX) &&
        name.length > PREFIX.length &&
        Boolean(value?.trim()),
    )
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => ({
      alias: aliasFromEnvironmentName(name),
      targetId: value!.trim(),
      hash: hashRecipientId(value!.trim()),
    }));

  if (recipients.length === 0) {
    throw new Error("至少需要一個 LINE_TARGET_ID_<ALIAS> 收件者 Secret");
  }

  if (new Set(recipients.map((recipient) => recipient.targetId)).size !== recipients.length) {
    throw new Error("LINE 收件者 Secrets 不可包含重複 userId");
  }
  return recipients;
}

export function hashRecipientId(targetId: string): string {
  return createHash("sha256").update(targetId).digest("hex");
}

function aliasFromEnvironmentName(name: string): string {
  return name
    .slice(PREFIX.length)
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}
