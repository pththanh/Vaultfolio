"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { instruments, prices } from "@/db/schema";
import { parseViMoney, parseViNumber } from "@/lib/calc/decimal";
import { scaledNavToPrice } from "@/lib/calc/fund/units";
import { perLuongToPerChi } from "@/lib/calc/gold";
import { todayVN } from "@/lib/format";
import { requireUser } from "@/server/session";
import { runJob } from "@/server/prices/runner";
import { JOB_KEYS, type JobKey } from "@/server/sources";
import type { FormState } from "../transactions/actions";

function done(message: string): FormState {
  revalidatePath("/admin", "layout");
  return { ok: true, message, nonce: Date.now() };
}

/** Approve a held-back price so it is used in valuations. */
export async function approvePrice(
  instrumentId: string,
  date: string,
): Promise<FormState> {
  await requireUser();
  const [row] = await db
    .update(prices)
    .set({ needsReview: false, reviewReason: null })
    .where(
      and(
        eq(prices.instrumentId, instrumentId),
        eq(prices.date, date),
        eq(prices.needsReview, true),
      ),
    )
    .returning();
  if (!row) return { error: "Không tìm thấy giá cần duyệt" };
  if (row.price <= 0n) {
    await db
      .update(prices)
      .set({ needsReview: true, reviewReason: "Giá 0 không thể áp dụng" })
      .where(and(eq(prices.instrumentId, instrumentId), eq(prices.date, date)));
    return { error: "Giá bằng 0 — hãy nhập tay" };
  }
  return done("Đã áp dụng giá");
}

const overrideSchema = z.object({
  instrumentId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ"),
  price: z.string().trim().min(1, "Nhập giá"),
  unit: z.enum(["unit", "luong"]).default("unit"),
});

/** Manual price ("Nhập tay" / "Ghi đè giá"): upsert and apply immediately. */
export async function overridePrice(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireUser();
  const parsed = overrideSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { instrumentId, date, unit } = parsed.data;
  if (date > todayVN()) return { error: "Ngày không được ở tương lai" };

  const instrument = await db.query.instruments.findFirst({
    where: eq(instruments.id, instrumentId),
  });
  if (!instrument) return { error: "Không tìm thấy tài sản" };
  let price: bigint;
  try {
    price =
      instrument.assetClass === "fund"
        ? scaledNavToPrice(parseViNumber(parsed.data.price))
        : parseViMoney(parsed.data.price);
  } catch {
    return { error: "Giá không hợp lệ" };
  }
  if (instrument.assetClass === "gold" && unit === "luong")
    price = perLuongToPerChi(price);
  if (price <= 0n) return { error: "Giá phải lớn hơn 0" };

  const values = {
    price,
    source: "manual",
    stale: false,
    needsReview: false,
    reviewReason: null,
    fetchedAt: new Date(),
  };
  await db
    .insert(prices)
    .values({ instrumentId, date, ...values })
    .onConflictDoUpdate({
      target: [prices.instrumentId, prices.date],
      set: values,
    });
  return done("Đã lưu giá nhập tay");
}

/** "Chạy lại ngay": run the job now and report its outcome. */
export async function rerunJob(job: string): Promise<FormState> {
  await requireUser();
  if (!JOB_KEYS.includes(job as JobKey)) return { error: "Job không hợp lệ" };
  const run = await runJob(job as JobKey, { trigger: "manual" });
  revalidatePath("/admin", "layout");
  if (run.status === "error")
    return { error: `Job lỗi: ${run.error ?? run.detail}` };
  return { ok: true, message: run.detail ?? "Đã chạy xong", nonce: Date.now() };
}
