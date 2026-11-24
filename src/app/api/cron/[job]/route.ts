import { timingSafeEqual } from "node:crypto";
import { runJob } from "@/server/prices/runner";
import { JOB_KEYS, type JobKey } from "@/server/sources";

export const maxDuration = 60;

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(req: Request, ctx: RouteContext<"/api/cron/[job]">) {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });
  const { job } = await ctx.params;
  if (!JOB_KEYS.includes(job as JobKey))
    return new Response("Unknown job", { status: 404 });

  const run = await runJob(job as JobKey, { trigger: "cron" });
  return Response.json(
    { job, status: run.status, detail: run.detail, error: run.error },
    { status: run.status === "error" ? 500 : 200 },
  );
}
