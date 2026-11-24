/**
 * Replace price history with real data from DNSE (stocks + VN-Index),
 * Fmarket (funds, always the full NAV history) and CoinGecko (crypto). Manual prices are kept.
 *   npm run prices:backfill            # 365 days, stock + fund + crypto
 *   npm run prices:backfill -- 90 stock
 */
import { config } from "dotenv";
import type { JobKey } from "../src/server/sources";

config({ path: ".env.local" });

async function main() {
  const { runJob } = await import("../src/server/prices/runner");
  const days = Number(process.argv[2]) || 365;
  const jobs = (
    process.argv.slice(3).length
      ? process.argv.slice(3)
      : ["fx", "stock", "fund", "crypto"]
  ) as JobKey[];
  for (const job of jobs) {
    console.log(`→ ${job} (${days} ngày)…`);
    const run = await runJob(job, {
      trigger: job === "fx" ? "manual" : "backfill",
      days,
    });
    console.log(`  ${run.status}: ${run.error ?? run.detail}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
