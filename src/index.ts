import { run } from "./app.js";
import { taipeiDate } from "./lib/date.js";

const dryRun = process.argv.includes("--dry-run") || process.env.DRY_RUN === "true";
const evaluationDate = process.env.EVALUATION_DATE?.trim() || taipeiDate();

if (!/^\d{4}-\d{2}-\d{2}$/.test(evaluationDate)) {
  throw new Error("EVALUATION_DATE 必須是 YYYY-MM-DD");
}

run(evaluationDate, dryRun)
  .then((message) => {
    console.log(message);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
