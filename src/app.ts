import { pushLineMessageToRecipients } from "./clients/line.js";
import {
  isExternalFetchEnabled,
  isMopsFetchEnabled,
  loadIssuanceOverrides,
  loadPolicy,
} from "./config.js";
import { evaluateSubscriptionDate } from "./evaluation.js";
import { buildFailureMessage } from "./message.js";
import { loadRecipients } from "./recipients.js";
import {
  loadSentRecipientHashes,
  recordSuccessfulDeliveries,
} from "./run-history.js";

/** 評估指定日期案件並在非 dry run 時推送 LINE 與記錄成功收件者。 */
export async function run(date: string, dryRun: boolean): Promise<string> {
  const forceResend = process.env.FORCE_RESEND === "true";
  const recipients = dryRun ? [] : loadRecipients();
  const sentHashes =
    dryRun || forceResend
      ? new Set<string>()
      : await loadSentRecipientHashes(date);
  const pendingRecipients = recipients.filter(
    (recipient) => !sentHashes.has(recipient.hash),
  );
  if (!dryRun && pendingRecipients.length === 0) {
    return `今日 ${date} 已成功發送給所有設定收件者，略過重複通知。`;
  }

  let message: string;
  try {
    message = await evaluateSubscriptionDate(date, {
      policy: loadPolicy(),
      issuanceOverrides: await loadIssuanceOverrides(),
      externalFetchEnabled: isExternalFetchEnabled(),
      mopsFetchEnabled: isMopsFetchEnabled(),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const failureMessage = buildFailureMessage(date, reason);
    if (dryRun) return failureMessage;
    const alertOutcomes = await pushLineMessageToRecipients(
      failureMessage,
      pendingRecipients,
    );
    const alertFailures = alertOutcomes.filter((outcome) => outcome.status === "failed");
    if (alertFailures.length > 0) {
      throw new Error(
        `${failureMessage}\n異常通知另有 ${alertFailures.length} 位收件者發送失敗`,
        { cause: error },
      );
    }
    throw new Error(failureMessage, { cause: error });
  }

  if (dryRun) return message;
  const outcomes = await pushLineMessageToRecipients(message, pendingRecipients);
  const successes = outcomes
    .filter((outcome) => outcome.status === "sent")
    .map((outcome) => outcome.recipient);
  await recordSuccessfulDeliveries(date, successes);
  const failed = outcomes.filter((outcome) => outcome.status === "failed");
  if (failed.length > 0) {
    throw new Error(
      `LINE 發送失敗：${failed
        .map((outcome) => `${outcome.recipient.alias} (${outcome.error})`)
        .join("；")}`,
    );
  }
  return message;
}
