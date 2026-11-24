"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import { z } from "zod";
import { db } from "@/db";
import {
  accounts,
  cashEntries,
  fundFeeSchedules,
  instruments,
  savingsDeposits,
  transactions,
  userSettings,
  users,
} from "@/db/schema";
import { QTY_SCALE, divRound, parseViNumber } from "@/lib/calc/decimal";
import { tiersError } from "@/lib/calc/fund/schedule";
import type { FeeConfig } from "@/lib/calc/fees";
import { signOut } from "@/auth";
import { requireUser } from "@/server/session";
import { newTotpSecret, verifyTotp } from "@/server/totp";
import type { FormState } from "../transactions/actions";

/** Invalidate every session of this user (incl. the current one) and go to login. */
async function endAllSessions(userId: string): Promise<never> {
  await db
    .update(users)
    .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
    .where(eq(users.id, userId));
  await signOut({ redirectTo: "/login" });
  throw new Error("unreachable");
}

function done(message: string, path = "/admin/settings"): FormState {
  revalidatePath(path, path === "/admin" ? "layout" : "page");
  return { ok: true, message, nonce: Date.now() };
}

// ——— 2FA ———————————————————————————————————————————————

export async function startTotpSetup(): Promise<
  { qr: string; secret: string } | { error: string }
> {
  const user = await requireUser();
  const row = await db.query.users.findFirst({ where: eq(users.id, user.id) });
  if (row?.totpEnabled) return { error: "2FA đã được bật" };
  const { encrypted, uri, secret } = newTotpSecret(user.email);
  await db
    .update(users)
    .set({ totpSecret: encrypted, totpEnabled: false })
    .where(eq(users.id, user.id));
  return { qr: await QRCode.toDataURL(uri, { margin: 1, width: 200 }), secret };
}

export async function confirmTotp(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const row = await db.query.users.findFirst({ where: eq(users.id, user.id) });
  if (!row?.totpSecret) return { error: "Hãy bắt đầu thiết lập lại" };
  const step = verifyTotp(
    row.totpSecret,
    String(formData.get("code") ?? ""),
    row.email,
  );
  if (step === null) {
    return { error: "Mã không đúng, thử lại với mã mới trong ứng dụng" };
  }
  await db
    .update(users)
    .set({ totpEnabled: true, totpLastStep: step })
    .where(eq(users.id, user.id));
  // Sessions created without 2FA must not survive enabling it.
  return endAllSessions(user.id);
}

export async function disableTotp(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const row = await db.query.users.findFirst({ where: eq(users.id, user.id) });
  if (!row?.totpEnabled || !row.totpSecret) return { error: "2FA chưa bật" };
  const step = verifyTotp(
    row.totpSecret,
    String(formData.get("code") ?? ""),
    row.email,
  );
  if (
    step === null ||
    (row.totpLastStep !== null && step <= row.totpLastStep)
  ) {
    return { error: "Mã không đúng hoặc đã được dùng" };
  }
  await db
    .update(users)
    .set({ totpEnabled: false, totpSecret: null, totpLastStep: null })
    .where(eq(users.id, user.id));
  return endAllSessions(user.id);
}

const passwordSchema = z
  .object({
    current: z.string().min(1, "Nhập mật khẩu hiện tại"),
    next: z.string().min(10, "Mật khẩu mới cần ít nhất 10 ký tự"),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, "Mật khẩu xác nhận không khớp");

export async function changePassword(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = passwordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const row = await db.query.users.findFirst({ where: eq(users.id, user.id) });
  if (!row || !(await bcrypt.compare(parsed.data.current, row.passwordHash)))
    return { error: "Mật khẩu hiện tại không đúng" };
  await db
    .update(users)
    .set({ passwordHash: await bcrypt.hash(parsed.data.next, 12) })
    .where(eq(users.id, user.id));
  return endAllSessions(user.id);
}

// ——— Fees ——————————————————————————————————————————————

/** "0,15" (%) → 15 bps */
const pct = z
  .string()
  .trim()
  .transform((v, ctx) => {
    try {
      const bps = Number(divRound(parseViNumber(v || "0") * 100n, QTY_SCALE));
      if (bps < 0 || bps > 10_000) throw new Error();
      return bps;
    } catch {
      ctx.addIssue({ code: "custom", message: `Tỷ lệ không hợp lệ: "${v}"` });
      return z.NEVER;
    }
  });

const feeSchema = z.object({
  stockFeeBps: pct,
  cryptoFeeBps: pct,
  goldFeeBps: pct,
  sellTaxBps: pct,
  dividendTaxBps: pct,
  demandRateBps: pct,
  fundTaxBps: pct,
  fundTaxFreeMonths: z
    .string()
    .regex(/^\d{1,3}$/, "Số tháng không hợp lệ")
    .transform(Number),
}) satisfies z.ZodType<FeeConfig, Record<string, string>>;

export async function saveFees(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = feeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  await db
    .insert(userSettings)
    .values({ userId: user.id, fees: parsed.data })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { fees: parsed.data, updatedAt: new Date() },
    });
  return done("Đã lưu cấu hình phí & thuế", "/admin");
}

// ——— Fund fee schedules ————————————————————————————————————

const fundFeesSchema = z.object({
  instrumentId: z.uuid(),
  side: z.enum(["buy", "sell"]),
  effectiveFrom: z.iso.date("Ngày không hợp lệ"),
  tiers: z
    .array(
      z.object({
        fromMonths: z
          .string()
          .trim()
          .regex(/^\d{1,3}$/, "Số tháng không hợp lệ")
          .transform(Number),
        op: z.enum(["gte", "gt"]),
        fee: pct,
      }),
    )
    .max(20),
});

/** Replaces the schedule of one fund and side that starts on `effectiveFrom`. */
export async function saveFundFees(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireUser();
  let tiersJson: unknown;
  try {
    tiersJson = JSON.parse(String(formData.get("tiers") ?? "[]"));
  } catch {
    return { error: "Dữ liệu không hợp lệ" };
  }
  const parsed = fundFeesSchema.safeParse({
    ...Object.fromEntries(formData),
    tiers: tiersJson,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { instrumentId, side, effectiveFrom } = parsed.data;
  const tiers = parsed.data.tiers.map((t) => ({
    fromMonths: t.fromMonths,
    fromInclusive: t.op === "gte",
    feeBps: t.fee,
  }));
  const invalid = tiersError(tiers);
  if (invalid) return { error: invalid };
  const instrument = await db.query.instruments.findFirst({
    where: and(
      eq(instruments.id, instrumentId),
      eq(instruments.assetClass, "fund"),
    ),
  });
  if (!instrument) return { error: "Không tìm thấy quỹ" };
  await db.transaction(async (tx) => {
    await tx
      .delete(fundFeeSchedules)
      .where(
        and(
          eq(fundFeeSchedules.instrumentId, instrumentId),
          eq(fundFeeSchedules.side, side),
          eq(fundFeeSchedules.effectiveFrom, effectiveFrom),
        ),
      );
    await tx
      .insert(fundFeeSchedules)
      .values(tiers.map((t) => ({ ...t, instrumentId, side, effectiveFrom })));
  });
  return done(`Đã lưu biểu phí ${instrument.symbol}`, "/admin");
}

// ——— Accounts ——————————————————————————————————————————

const accountSchema = z.object({
  id: z
    .string()
    .uuid()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  name: z.string().trim().min(1, "Nhập tên").max(80),
  type: z.enum(["broker", "exchange", "wallet", "bank", "physical"]),
});

export async function saveAccount(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = accountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { id, name, type } = parsed.data;
  const clash = await db.query.accounts.findFirst({
    where: and(eq(accounts.userId, user.id), eq(accounts.name, name)),
  });
  if (clash && clash.id !== id) return { error: "Đã có tài khoản cùng tên" };
  if (id) {
    const current = await db.query.accounts.findFirst({
      where: and(eq(accounts.id, id), eq(accounts.userId, user.id)),
    });
    if (type === "bank" && current?.cashFrom)
      return {
        error: "Hãy tắt theo dõi tiền mặt trước khi đổi sang ngân hàng",
      };
    const [row] = await db
      .update(accounts)
      .set({ name, type })
      .where(and(eq(accounts.id, id), eq(accounts.userId, user.id)))
      .returning();
    if (!row) return { error: "Không tìm thấy tài khoản" };
    await db
      .update(savingsDeposits)
      .set({ bank: name })
      .where(eq(savingsDeposits.accountId, id));
  } else {
    await db.insert(accounts).values({ userId: user.id, name, type });
  }
  return done(id ? "Đã cập nhật tài khoản" : "Đã thêm tài khoản", "/admin");
}

export async function deleteAccount(id: string): Promise<FormState> {
  const user = await requireUser();
  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, id), eq(accounts.userId, user.id)),
  });
  if (!account) return { error: "Không tìm thấy tài khoản" };
  const [{ n }] = await db
    .select({
      n: sql<number>`(select count(*) from ${transactions} where ${transactions.accountId} = ${id}) + (select count(*) from ${savingsDeposits} where ${savingsDeposits.accountId} = ${id}) + (select count(*) from ${cashEntries} where ${cashEntries.toAccountId} = ${id})`.mapWith(
        Number,
      ),
    })
    .from(accounts)
    .where(eq(accounts.id, id));
  if (n > 0)
    return {
      error: `Tài khoản còn ${n} giao dịch/sổ/chuyển khoản — hãy xoá hoặc chuyển trước`,
    };
  await db.delete(accounts).where(eq(accounts.id, id));
  return done("Đã xoá tài khoản", "/admin");
}

// ——— Instruments ———————————————————————————————————————

const instrumentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, "Nhập tên").max(120),
  exchange: z.string().trim().max(20).optional().default(""),
  unit: z.string().trim().max(20),
  providerRef: z.string().trim().max(120).optional().default(""),
});

/** Instruments are shared market data; any signed-in user may annotate them (single-user for now). */
export async function saveInstrument(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireUser();
  const parsed = instrumentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { id, name, exchange, unit, providerRef } = parsed.data;
  const current = await db.query.instruments.findFirst({
    where: eq(instruments.id, id),
  });
  if (!current) return { error: "Không tìm thấy mã" };
  const allowedUnits: Record<string, string[]> = {
    gold: ["luong", "chi"],
    stock: ["share"],
    crypto: ["coin"],
    index: ["point"],
  };
  if (!allowedUnits[current.assetClass]?.includes(unit))
    return { error: "Đơn vị không hợp lệ" };
  await db
    .update(instruments)
    .set({
      name,
      exchange: exchange || null,
      unit,
      providerRef: providerRef || null,
    })
    .where(eq(instruments.id, id));
  return done("Đã cập nhật mã tài sản", "/admin");
}
