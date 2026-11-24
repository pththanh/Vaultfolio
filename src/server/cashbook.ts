import "server-only";
import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  isNull,
  min,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  accounts,
  budgets,
  cashEntries,
  categories,
  debts,
  events,
  recurringRules,
  userSettings,
  wallets,
  type Account,
  type CashEntry,
  type Category,
  type Debt,
  type SavingsDeposit,
  type Wallet,
} from "@/db/schema";
import { walletBalance } from "@/lib/calc/cashbook/balance";
import { BANK_FEE_CATEGORY } from "@/lib/calc/cashbook/default-categories";
import {
  CATEGORY_KINDS,
  WALLET_TYPES,
  type CashInput,
} from "@/lib/calc/cashbook/types";
import { parseViMoney } from "@/lib/calc/decimal";
import { monthOf } from "@/lib/calc/cashbook/report";
import { closingValue } from "@/lib/calc/savings";
import { formatDate, todayVN } from "@/lib/format";
import { alertMessages, monthEntries } from "./budgets";
import { quickAmount } from "./fields";
import { ensureDefaultCategories } from "./default-categories";
import { LedgerError, getOwnedAccount } from "./ledger";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Db = Pick<Tx, "select" | "insert" | "update" | "delete" | "query">;

// ——— Loading ————————————————————————————————————————————————

export interface CashRows {
  wallets: Wallet[];
  entries: CashEntry[];
  debts: Debt[];
}

export async function loadCashRows(userId: string): Promise<CashRows> {
  const [w, e, d] = await Promise.all([
    db
      .select()
      .from(wallets)
      .where(eq(wallets.userId, userId))
      .orderBy(asc(wallets.sortOrder), asc(wallets.createdAt)),
    db
      .select()
      .from(cashEntries)
      .where(eq(cashEntries.userId, userId))
      .orderBy(asc(cashEntries.occurredOn), asc(cashEntries.createdAt)),
    db.select().from(debts).where(eq(debts.userId, userId)),
  ]);
  return { wallets: w, entries: e, debts: d };
}

export function toCashInput(
  rows: CashRows,
  accts: readonly Account[],
): CashInput {
  return {
    ...rows,
    accounts: accts.flatMap((a) =>
      a.cashFrom !== null && a.cashOpening !== null
        ? [{ id: a.id, cashOpening: a.cashOpening, cashFrom: a.cashFrom }]
        : [],
    ),
  };
}

export async function loadCategories(userId: string): Promise<Category[]> {
  const load = () =>
    db
      .select()
      .from(categories)
      .where(eq(categories.userId, userId))
      .orderBy(asc(categories.sortOrder), asc(categories.createdAt));
  const rows = await load();
  if (rows.length) return rows;
  // Users created before the cashbook existed.
  await ensureDefaultCategories(db, userId);
  return load();
}

export async function getDefaultWalletId(
  userId: string,
): Promise<string | null> {
  const row = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
    columns: { defaultWalletId: true },
  });
  return row?.defaultWalletId ?? null;
}

// ——— Ownership ——————————————————————————————————————————————

export async function getOwnedWallet(
  tx: Db,
  userId: string,
  id: string,
): Promise<Wallet> {
  const row = z.uuid().safeParse(id).success
    ? await tx.query.wallets.findFirst({
        where: and(eq(wallets.id, id), eq(wallets.userId, userId)),
      })
    : undefined;
  if (!row) throw new LedgerError("Ví không tồn tại");
  return row;
}

export async function getOwnedCategory(
  tx: Db,
  userId: string,
  id: string,
): Promise<Category> {
  const row = z.uuid().safeParse(id).success
    ? await tx.query.categories.findFirst({
        where: and(eq(categories.id, id), eq(categories.userId, userId)),
      })
    : undefined;
  if (!row) throw new LedgerError("Hạng mục không tồn tại");
  return row;
}

export async function getOwnedEvent(tx: Db, userId: string, id: string) {
  const row = z.uuid().safeParse(id).success
    ? await tx.query.events.findFirst({
        where: and(eq(events.id, id), eq(events.userId, userId)),
      })
    : undefined;
  if (!row) throw new LedgerError("Sự kiện không tồn tại");
  return row;
}

export function loadEvents(userId: string) {
  return db
    .select()
    .from(events)
    .where(eq(events.userId, userId))
    .orderBy(desc(events.startOn), desc(events.createdAt));
}

async function getOwnedEntry(
  tx: Db,
  userId: string,
  id: string,
): Promise<CashEntry> {
  const row = z.uuid().safeParse(id).success
    ? await tx.query.cashEntries.findFirst({
        where: and(eq(cashEntries.id, id), eq(cashEntries.userId, userId)),
      })
    : undefined;
  if (!row) throw new LedgerError("Không tìm thấy ghi chép");
  return row;
}

/** A wallet that may take an entry on `date`; archived ones only if already used by the row. */
export async function usableWallet(
  tx: Db,
  userId: string,
  id: string,
  date: string,
  keep: (string | null | undefined)[] = [],
): Promise<Wallet> {
  const w = await getOwnedWallet(tx, userId, id);
  if (w.archivedAt && !keep.includes(w.id))
    throw new LedgerError(`Ví "${w.name}" đã lưu trữ`);
  if (date < w.openingDate)
    throw new LedgerError(
      `Ví "${w.name}" bắt đầu từ ${formatDate(w.openingDate)}, không ghi được ngày trước đó`,
    );
  return w;
}

// ——— Form fields ————————————————————————————————————————————

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
  }, "Ngày không hợp lệ");
export const optionalId = z
  .uuid()
  .optional()
  .or(z.literal("").transform(() => undefined));
export const note = z.string().trim().max(500).optional().default("");

export const optionalAmount = z
  .literal("")
  .transform(() => null)
  .or(quickAmount)
  .optional()
  .default(null);

const MAX_BALANCE = 10n ** 15n;
/** Signed money in vi-VN format. */
export const signedMoney = z.string().transform((v, ctx) => {
  try {
    const value = parseViMoney((v.trim() || "0").replace("−", "-"));
    if (value > MAX_BALANCE || value < -MAX_BALANCE) throw new Error();
    return value;
  } catch {
    ctx.addIssue({ code: "custom", message: `Số tiền không hợp lệ: "${v}"` });
    return z.NEVER;
  }
});

export function assertNotFuture(date: string) {
  if (date > todayVN()) throw new LedgerError("Ngày không được ở tương lai");
}

// ——— Entries ————————————————————————————————————————————————

/** "wallet:<id>" or "account:<id>" */
const endpoint = z
  .string()
  .regex(/^(wallet|account):[0-9a-f-]{36}$/, "Chọn ví nguồn và ví đích")
  .transform((v) => {
    const [kind, id] = v.split(":");
    return { kind: kind as "wallet" | "account", id };
  });

export const entryFormSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal(CATEGORY_KINDS),
    id: optionalId,
    amount: quickAmount,
    occurredOn: isoDate,
    walletId: z.string().min(1, "Chọn ví"),
    categoryId: z.string().min(1, "Chọn hạng mục"),
    eventId: optionalId,
    note,
    excludeFromReport: z
      .literal("on")
      .optional()
      .transform((v) => v === "on"),
  }),
  z.object({
    type: z.literal("transfer"),
    id: optionalId,
    amount: quickAmount,
    occurredOn: isoDate,
    from: endpoint,
    to: endpoint,
    fee: optionalAmount,
    note,
  }),
]);
export type EntryForm = z.infer<typeof entryFormSchema>;

/** Rows managed elsewhere: savings links by the savings book, fees by their transfer. */
function assertEditable(e: CashEntry) {
  if (e.savingsDepositId)
    throw new LedgerError(
      "Dòng này gắn với sổ tiết kiệm — hãy sửa ở màn hình Tiết kiệm",
    );
  if (e.parentEntryId)
    throw new LedgerError(
      "Dòng này đi kèm một chuyển khoản hoặc khoản trả nợ — hãy sửa ở đó",
    );
  if (e.debtId)
    throw new LedgerError(
      "Dòng này gắn với một khoản vay nợ — hãy sửa ở Vay nợ",
    );
}

/** Save an entry. Returns budget alerts it triggered. */
export async function saveEntry(
  userId: string,
  form: EntryForm,
): Promise<string[]> {
  assertNotFuture(form.occurredOn);
  const month = monthOf(form.occurredOn);
  return db.transaction(async (tx) => {
    const before = await monthEntries(tx, userId, month);
    const existing = form.id
      ? await getOwnedEntry(tx, userId, form.id)
      : undefined;
    if (existing) {
      assertEditable(existing);
      if (existing.type === "adjustment")
        throw new LedgerError("Hãy xoá rồi điều chỉnh lại số dư");
    }
    const values =
      form.type === "transfer"
        ? await transferValues(tx, userId, form, existing)
        : await categorizedValues(tx, userId, form, existing);

    let entryId = existing?.id;
    if (entryId) {
      await tx
        .update(cashEntries)
        .set({
          ...values,
          // Moved by hand: it no longer stands for that run of its rule.
          ...(existing!.occurredOn !== form.occurredOn && {
            recurringRuleId: null,
          }),
          updatedAt: new Date(),
        })
        .where(eq(cashEntries.id, entryId));
      await tx
        .delete(cashEntries)
        .where(eq(cashEntries.parentEntryId, entryId));
    } else {
      const [row] = await tx
        .insert(cashEntries)
        .values({ userId, ...values })
        .returning({ id: cashEntries.id });
      entryId = row.id;
    }
    if (form.type === "transfer" && form.fee !== null) {
      if (form.from.kind !== "wallet")
        throw new LedgerError("Phí chỉ ghi được khi chuyển từ ví");
      await tx.insert(cashEntries).values({
        userId,
        type: "expense",
        amount: form.fee,
        occurredOn: form.occurredOn,
        walletId: form.from.id,
        categoryId: await systemCategory(
          tx,
          userId,
          "expense",
          BANK_FEE_CATEGORY,
        ),
        parentEntryId: entryId,
        note: form.note || null,
      });
    }
    const cats = await tx
      .select()
      .from(categories)
      .where(eq(categories.userId, userId));
    return alertMessages(tx, userId, month, before, cats);
  });
}

const CLEARED = {
  toWalletId: null,
  toAccountId: null,
  direction: null,
  categoryId: null,
  eventId: null,
  excludeFromReport: false,
} as const;

async function categorizedValues(
  tx: Db,
  userId: string,
  form: Extract<EntryForm, { categoryId: string }>,
  existing?: CashEntry,
) {
  await usableWallet(tx, userId, form.walletId, form.occurredOn, [
    existing?.walletId,
    existing?.toWalletId,
  ]);
  const category = await getOwnedCategory(tx, userId, form.categoryId);
  if (category.kind !== form.type)
    throw new LedgerError("Hạng mục không khớp loại thu/chi");
  if (category.archivedAt && category.id !== existing?.categoryId)
    throw new LedgerError("Hạng mục đã ẩn");
  if (form.eventId) await getOwnedEvent(tx, userId, form.eventId);
  return {
    ...CLEARED,
    type: form.type,
    amount: form.amount,
    occurredOn: form.occurredOn,
    walletId: form.walletId,
    categoryId: form.categoryId,
    eventId: form.eventId ?? null,
    note: form.note || null,
    excludeFromReport: form.excludeFromReport,
  };
}

async function transferValues(
  tx: Db,
  userId: string,
  form: Extract<EntryForm, { type: "transfer" }>,
  existing?: CashEntry,
) {
  const { from, to } = form;
  if (from.kind === "account" && to.kind === "account")
    throw new LedgerError("Một đầu chuyển khoản phải là ví");
  if (from.kind === to.kind && from.id === to.id)
    throw new LedgerError("Ví nguồn và ví đích phải khác nhau");
  for (const end of [from, to]) {
    if (end.kind === "wallet") {
      await usableWallet(tx, userId, end.id, form.occurredOn, [
        existing?.walletId,
        existing?.toWalletId,
      ]);
    } else {
      const account = await getOwnedAccount(tx, userId, end.id);
      if (!account) throw new LedgerError("Tài khoản không tồn tại");
      if (account.type === "bank")
        throw new LedgerError(
          "Gửi tiết kiệm: chọn nguồn tiền ở màn hình Tiết kiệm",
        );
    }
  }
  const common = {
    ...CLEARED,
    type: "transfer" as const,
    amount: form.amount,
    occurredOn: form.occurredOn,
    note: form.note || null,
  };
  if (from.kind === "wallet" && to.kind === "wallet")
    return { ...common, walletId: from.id, toWalletId: to.id };
  return from.kind === "wallet"
    ? {
        ...common,
        walletId: from.id,
        toAccountId: to.id,
        direction: "out" as const,
      }
    : {
        ...common,
        walletId: to.id,
        toAccountId: from.id,
        direction: "in" as const,
      };
}

/** A category the app books into by itself. */
export async function systemCategory(
  tx: Db,
  userId: string,
  kind: Category["kind"],
  name: string,
): Promise<string> {
  const row = await tx.query.categories.findFirst({
    where: and(
      eq(categories.userId, userId),
      eq(categories.kind, kind),
      eq(categories.isSystem, true),
      eq(categories.name, name),
    ),
  });
  if (!row) throw new LedgerError(`Thiếu hạng mục "${name}"`);
  return row.id;
}

export async function deleteEntry(userId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const e = await getOwnedEntry(tx, userId, id);
    assertEditable(e);
    await tx.delete(cashEntries).where(eq(cashEntries.id, e.id));
  });
}

// ——— Wallets ————————————————————————————————————————————————

const dayOfMonth = z
  .literal("")
  .transform(() => null)
  .or(z.coerce.number().int().min(1).max(31))
  .optional()
  .default(null);

export const walletFormSchema = z.object({
  id: optionalId,
  name: z.string().trim().min(1, "Nhập tên ví").max(80),
  type: z.enum(WALLET_TYPES),
  openingBalance: signedMoney,
  openingDate: isoDate,
  creditLimit: optionalAmount,
  statementDay: dayOfMonth,
  dueDay: dayOfMonth,
  includeInNetWorth: z
    .literal("on")
    .optional()
    .transform((v) => v === "on"),
});
export type WalletForm = z.infer<typeof walletFormSchema>;

export async function saveWallet(
  userId: string,
  form: WalletForm,
): Promise<void> {
  assertNotFuture(form.openingDate);
  await db.transaction(async (tx) => {
    const { id, ...rest } = form;
    const isCard = form.type === "credit_card";
    const values = {
      ...rest,
      creditLimit: isCard ? form.creditLimit : null,
      statementDay: isCard ? form.statementDay : null,
      dueDay: isCard ? form.dueDay : null,
    };
    const clash = await tx.query.wallets.findFirst({
      where: and(eq(wallets.userId, userId), eq(wallets.name, form.name)),
    });
    if (clash && clash.id !== id) throw new LedgerError("Đã có ví cùng tên");
    if (!id) {
      const [{ last }] = await tx
        .select({
          last: sql<number>`coalesce(max(${wallets.sortOrder}), -1)`.mapWith(
            Number,
          ),
        })
        .from(wallets)
        .where(eq(wallets.userId, userId));
      await tx
        .insert(wallets)
        .values({ userId, ...values, sortOrder: last + 1 });
      return;
    }
    await getOwnedWallet(tx, userId, id);
    const [{ first }] = await tx
      .select({ first: min(cashEntries.occurredOn) })
      .from(cashEntries)
      .where(or(eq(cashEntries.walletId, id), eq(cashEntries.toWalletId, id)));
    if (first && form.openingDate > first)
      throw new LedgerError(
        `Ví có ghi chép từ ${formatDate(first)}, ngày bắt đầu không được muộn hơn`,
      );
    await tx.update(wallets).set(values).where(eq(wallets.id, id));
  });
}

export async function setWalletArchived(
  userId: string,
  id: string,
  archived: boolean,
): Promise<void> {
  await getOwnedWallet(db, userId, id);
  await db.transaction(async (tx) => {
    await tx
      .update(wallets)
      .set({ archivedAt: archived ? new Date() : null })
      .where(eq(wallets.id, id));
    if (archived)
      await tx
        .update(userSettings)
        .set({ defaultWalletId: null })
        .where(eq(userSettings.defaultWalletId, id));
  });
}

export async function deleteWallet(userId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await getOwnedWallet(tx, userId, id);
    const used = await tx
      .select({ id: cashEntries.id })
      .from(cashEntries)
      .where(or(eq(cashEntries.walletId, id), eq(cashEntries.toWalletId, id)))
      .limit(1);
    if (used.length)
      throw new LedgerError("Ví đã có ghi chép — hãy lưu trữ thay vì xoá");
    const ruled = await tx
      .select({ id: recurringRules.id })
      .from(recurringRules)
      .where(
        and(
          eq(recurringRules.userId, userId),
          sql`${recurringRules.template}->>'walletId' = ${id}`,
        ),
      )
      .limit(1);
    if (ruled.length)
      throw new LedgerError("Ví đang dùng trong ghi chép định kỳ");
    await tx.delete(wallets).where(eq(wallets.id, id));
  });
}

export const adjustFormSchema = z.object({
  walletId: z.string(),
  actual: signedMoney,
  occurredOn: isoDate,
  note,
});

/** Record the difference between the real balance and the computed one. Returns it. */
export async function adjustBalance(
  userId: string,
  form: z.infer<typeof adjustFormSchema>,
): Promise<bigint> {
  assertNotFuture(form.occurredOn);
  return db.transaction(async (tx) => {
    const w = await usableWallet(tx, userId, form.walletId, form.occurredOn);
    // Serialize adjustments of one wallet so a double submit cannot apply twice.
    await tx
      .select({ id: wallets.id })
      .from(wallets)
      .where(eq(wallets.id, w.id))
      .for("update");
    const entries = await tx
      .select()
      .from(cashEntries)
      .where(
        or(eq(cashEntries.walletId, w.id), eq(cashEntries.toWalletId, w.id)),
      );
    const diff = form.actual - walletBalance(w, entries, form.occurredOn);
    if (diff !== 0n)
      await tx.insert(cashEntries).values({
        userId,
        type: "adjustment",
        amount: diff < 0n ? -diff : diff,
        direction: diff < 0n ? "out" : "in",
        occurredOn: form.occurredOn,
        walletId: w.id,
        note: form.note || null,
        excludeFromReport: true,
      });
    return diff;
  });
}

export async function setDefaultWallet(
  userId: string,
  walletId: string | null,
): Promise<void> {
  if (walletId) await usableWallet(db, userId, walletId, todayVN());
  const [row] = await db
    .update(userSettings)
    .set({ defaultWalletId: walletId, updatedAt: new Date() })
    .where(eq(userSettings.userId, userId))
    .returning({ userId: userSettings.userId });
  if (!row) throw new LedgerError("Hãy lưu cấu hình phí & thuế trước");
}

// ——— Categories ——————————————————————————————————————————————

export const categoryFormSchema = z.object({
  id: optionalId,
  kind: z.enum(CATEGORY_KINDS),
  parentId: optionalId,
  name: z.string().trim().min(1, "Nhập tên hạng mục").max(60),
  icon: z.string().trim().max(8).optional().default(""),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

const siblingsOf = (
  userId: string,
  kind: Category["kind"],
  parentId: string | null,
) =>
  and(
    eq(categories.userId, userId),
    eq(categories.kind, kind),
    sql`${categories.parentId} is not distinct from ${parentId}`,
  );

export async function saveCategory(
  userId: string,
  form: z.infer<typeof categoryFormSchema>,
): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = form.id
      ? await getOwnedCategory(tx, userId, form.id)
      : undefined;
    // Kind and parent are fixed once created.
    const kind = existing?.kind ?? form.kind;
    const parentId = existing ? existing.parentId : (form.parentId ?? null);
    if (!existing && parentId) {
      const parent = await getOwnedCategory(tx, userId, parentId);
      if (parent.parentId)
        throw new LedgerError("Hạng mục chỉ có tối đa 2 cấp");
      if (parent.kind !== kind)
        throw new LedgerError("Hạng mục con phải cùng loại với hạng mục cha");
    }
    if (existing?.isSystem && form.name !== existing.name)
      throw new LedgerError("Không đổi được tên hạng mục hệ thống");
    const siblings = await tx
      .select()
      .from(categories)
      .where(siblingsOf(userId, kind, parentId));
    if (siblings.some((s) => s.name === form.name && s.id !== existing?.id))
      throw new LedgerError("Đã có hạng mục cùng tên (có thể đang ẩn)");
    const values = {
      name: form.name,
      icon: form.icon || null,
      color: form.color ?? null,
    };
    if (existing)
      await tx
        .update(categories)
        .set(values)
        .where(eq(categories.id, existing.id));
    else
      await tx.insert(categories).values({
        userId,
        kind,
        parentId,
        ...values,
        sortOrder: Math.max(-1, ...siblings.map((s) => s.sortOrder)) + 1,
      });
  });
}

export async function setCategoryArchived(
  userId: string,
  id: string,
  archived: boolean,
): Promise<void> {
  await db.transaction(async (tx) => {
    const c = await getOwnedCategory(tx, userId, id);
    if (archived) await assertNoSystem(tx, c);
    await tx
      .update(categories)
      .set({ archivedAt: archived ? new Date() : null })
      .where(eq(categories.id, id));
  });
}

async function assertNoSystem(tx: Db, c: Category) {
  const rows = await tx
    .select({ name: categories.name, isSystem: categories.isSystem })
    .from(categories)
    .where(or(eq(categories.id, c.id), eq(categories.parentId, c.id)));
  const system = rows.find((r) => r.isSystem);
  if (system)
    throw new LedgerError(
      `"${system.name}" là hạng mục hệ thống, không ẩn hay gộp được`,
    );
}

export async function moveCategory(
  userId: string,
  id: string,
  by: -1 | 1,
): Promise<void> {
  await db.transaction(async (tx) => {
    const c = await getOwnedCategory(tx, userId, id);
    const rows = (
      await tx
        .select()
        .from(categories)
        .where(siblingsOf(userId, c.kind, c.parentId))
        .orderBy(asc(categories.sortOrder), asc(categories.createdAt))
    ).filter((r) => !r.archivedAt || r.id === id);
    const i = rows.findIndex((r) => r.id === id);
    const j = i + by;
    if (j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    for (const [order, r] of rows.entries())
      if (r.sortOrder !== order)
        await tx
          .update(categories)
          .set({ sortOrder: order })
          .where(eq(categories.id, r.id));
  });
}

/** Move every entry of `fromId` (and its subcategories) to `toId`, then hide it. */
export async function mergeCategory(
  userId: string,
  fromId: string,
  toId: string,
): Promise<number> {
  return db.transaction(async (tx) => {
    const from = await getOwnedCategory(tx, userId, fromId);
    const to = await getOwnedCategory(tx, userId, toId);
    if (from.id === to.id || to.parentId === from.id)
      throw new LedgerError("Chọn hạng mục đích khác");
    if (from.kind !== to.kind)
      throw new LedgerError("Chỉ gộp được hạng mục cùng loại");
    if (to.archivedAt) throw new LedgerError("Hạng mục đích đang ẩn");
    await assertNoSystem(tx, from);
    const family = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(or(eq(categories.id, from.id), eq(categories.parentId, from.id)));
    let moved = 0;
    for (const c of family) {
      const rows = await tx
        .update(cashEntries)
        .set({ categoryId: to.id, updatedAt: new Date() })
        .where(
          and(eq(cashEntries.categoryId, c.id), eq(cashEntries.userId, userId)),
        )
        .returning({ id: cashEntries.id });
      moved += rows.length;
      await tx
        .update(recurringRules)
        .set({
          template: sql`jsonb_set(${recurringRules.template}, '{categoryId}', to_jsonb(${to.id}::text))`,
        })
        .where(
          and(
            eq(recurringRules.userId, userId),
            sql`${recurringRules.template}->>'categoryId' = ${c.id}`,
          ),
        );
      // A hidden category has nothing left to limit.
      await tx.delete(budgets).where(eq(budgets.categoryId, c.id));
      await tx
        .update(categories)
        .set({ archivedAt: new Date() })
        .where(eq(categories.id, c.id));
    }
    return moved;
  });
}

// ——— Savings links ———————————————————————————————————————————

/** Keep the source-wallet transfer of a savings book in step with the book. undefined = same wallet as now. */
export async function syncSavingsOpening(
  tx: Db,
  userId: string,
  dep: SavingsDeposit,
  walletId: string | null | undefined,
): Promise<void> {
  const current = await savingsEntry(tx, userId, dep.id, "out");
  const target = walletId === undefined ? current?.walletId : walletId;
  if (!target) {
    if (current)
      await tx.delete(cashEntries).where(eq(cashEntries.id, current.id));
    return;
  }
  await writeSavingsEntry(tx, userId, dep, current, {
    walletId: target,
    direction: "out",
    amount: dep.principal,
    occurredOn: dep.startDate,
    note: `Gửi tiết kiệm ${dep.bank} · ${dep.name}`,
  });
}

/** Keep the payout transfer of a closed book in step; removes it when the book is open again. */
export async function syncSavingsClosing(
  tx: Db,
  userId: string,
  dep: SavingsDeposit,
  walletId: string | null | undefined,
): Promise<void> {
  const current = await savingsEntry(tx, userId, dep.id, "in");
  const target = walletId === undefined ? current?.walletId : walletId;
  if (dep.status !== "withdrawn" || !dep.closedDate || !target) {
    if (current)
      await tx.delete(cashEntries).where(eq(cashEntries.id, current.id));
    return;
  }
  await writeSavingsEntry(tx, userId, dep, current, {
    walletId: target,
    direction: "in",
    amount: closingValue(dep),
    occurredOn: dep.closedDate,
    note: `Tất toán ${dep.bank} · ${dep.name}`,
  });
}

async function savingsEntry(
  tx: Db,
  userId: string,
  depositId: string,
  direction: "in" | "out",
) {
  return tx.query.cashEntries.findFirst({
    where: and(
      eq(cashEntries.userId, userId),
      eq(cashEntries.savingsDepositId, depositId),
      eq(cashEntries.direction, direction),
    ),
  });
}

async function writeSavingsEntry(
  tx: Db,
  userId: string,
  dep: SavingsDeposit,
  current: CashEntry | undefined,
  values: {
    walletId: string;
    direction: "in" | "out";
    amount: bigint;
    occurredOn: string;
    note: string;
  },
) {
  assertNotFuture(values.occurredOn);
  await usableWallet(tx, userId, values.walletId, values.occurredOn, [
    current?.walletId,
  ]);
  if (current)
    await tx
      .update(cashEntries)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(cashEntries.id, current.id));
  else
    await tx.insert(cashEntries).values({
      userId,
      type: "transfer",
      savingsDepositId: dep.id,
      ...values,
    });
}

/** Which wallet each savings book was opened from. */
export function savingsSourceWallets(
  entries: readonly CashEntry[],
): Map<string, string> {
  return new Map(
    entries.flatMap((e) =>
      e.savingsDepositId && e.direction === "out"
        ? [[e.savingsDepositId, e.walletId] as const]
        : [],
    ),
  );
}

// ——— Account cash ————————————————————————————————————————————

export const accountCashSchema = z.object({
  accountId: z.uuid(),
  cashFrom: isoDate.or(z.literal("").transform(() => null)),
  cashOpening: signedMoney,
});

/** Start (or stop, with an empty date) tracking uninvested cash in an account. */
export async function setAccountCash(
  userId: string,
  form: z.infer<typeof accountCashSchema>,
): Promise<void> {
  const account = await getOwnedAccount(db, userId, form.accountId);
  if (!account) throw new LedgerError("Tài khoản không tồn tại");
  if (account.type === "bank")
    throw new LedgerError("Tiền ở ngân hàng được quản lý bằng Ví");
  if (form.cashFrom) assertNotFuture(form.cashFrom);
  await db
    .update(accounts)
    .set({
      cashFrom: form.cashFrom,
      cashOpening: form.cashFrom ? form.cashOpening : null,
    })
    .where(eq(accounts.id, account.id));
}

// ——— Quick entry —————————————————————————————————————————————

export interface QuickEntryData {
  today: string;
  wallets: { id: string; name: string; type: Wallet["type"] }[];
  accounts: { id: string; name: string; tracked: boolean }[];
  categories: {
    id: string;
    kind: Category["kind"];
    parentId: string | null;
    name: string;
    icon: string;
  }[];
  events: { id: string; name: string }[];
  recent: Record<Category["kind"], string[]>;
  defaultWalletId: string | null;
}

function monthAgo() {
  const d = new Date(`${todayVN()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 31);
  return d.toISOString().slice(0, 10);
}

export async function loadQuickEntry(userId: string): Promise<QuickEntryData> {
  const [walletRows, cats, accts, fixedDefault, recentRows, last, eventRows] =
    await Promise.all([
      db
        .select()
        .from(wallets)
        .where(eq(wallets.userId, userId))
        .orderBy(asc(wallets.sortOrder), asc(wallets.createdAt)),
      loadCategories(userId),
      db.select().from(accounts).where(eq(accounts.userId, userId)),
      getDefaultWalletId(userId),
      db
        .select({
          id: cashEntries.categoryId,
          used: sql`max(${cashEntries.createdAt})`,
        })
        .from(cashEntries)
        .where(
          and(
            eq(cashEntries.userId, userId),
            isNotNull(cashEntries.categoryId),
            // Fees follow their transfer; nobody picks them.
            isNull(cashEntries.parentEntryId),
          ),
        )
        .groupBy(cashEntries.categoryId)
        .orderBy(sql`2 desc`, sql`max(${cashEntries.occurredOn}) desc`),
      db
        .select({ id: cashEntries.walletId })
        .from(cashEntries)
        .where(eq(cashEntries.userId, userId))
        .orderBy(desc(cashEntries.createdAt), desc(cashEntries.occurredOn))
        .limit(1),
      loadEvents(userId),
    ]);
  const active = walletRows.filter((w) => !w.archivedAt);
  const byId = new Map(cats.map((c) => [c.id, c]));
  const usable = cats.filter(
    (c) => !c.archivedAt && (!c.parentId || !byId.get(c.parentId)?.archivedAt),
  );
  const usableIds = new Set(usable.map((c) => c.id));
  const recent = { expense: [] as string[], income: [] as string[] };
  for (const r of recentRows) {
    const c = r.id && usableIds.has(r.id) ? byId.get(r.id) : undefined;
    if (c && recent[c.kind].length < 6) recent[c.kind].push(c.id);
  }
  // Before any history exists, offer the first top-level categories.
  for (const kind of CATEGORY_KINDS)
    for (const c of usable)
      if (
        c.kind === kind &&
        !c.parentId &&
        recent[kind].length < 6 &&
        !recent[kind].includes(c.id)
      )
        recent[kind].push(c.id);

  const isActive = (id: string | null | undefined) =>
    active.some((w) => w.id === id);
  return {
    today: todayVN(),
    wallets: active.map((w) => ({ id: w.id, name: w.name, type: w.type })),
    accounts: accts
      .filter((a) => a.type !== "bank")
      .map((a) => ({ id: a.id, name: a.name, tracked: a.cashFrom !== null })),
    categories: usable.map((c) => ({
      id: c.id,
      kind: c.kind,
      parentId: c.parentId,
      name: c.name,
      icon: c.icon ?? (c.parentId ? byId.get(c.parentId)?.icon : null) ?? "•",
    })),
    // Events over for more than a month stop being offered.
    events: eventRows
      .filter((e) => !e.endOn || e.endOn >= monthAgo())
      .map((e) => ({ id: e.id, name: e.name })),
    recent,
    defaultWalletId:
      [fixedDefault, last[0]?.id, active[0]?.id].find(isActive) ?? null,
  };
}
