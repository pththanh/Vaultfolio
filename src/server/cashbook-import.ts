import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  accounts,
  cashEntries,
  categories,
  events,
  wallets,
  type Account,
  type Category,
  type Wallet,
} from "@/db/schema";
import { BANK_FEE_CATEGORY } from "@/lib/calc/cashbook/default-categories";
import { todayVN } from "@/lib/format";
import {
  markDuplicates,
  parseCashCsv,
  type CashCsvRow,
  type CashImportRow,
} from "@/lib/cashbook-csv";
import { loadCategories, systemCategory, type Tx } from "./cashbook";
import { LedgerError } from "./ledger";

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 10_000;
export const NEW = "__new";

type Kind = "expense" | "income";

const mappingSchema = z.record(z.string(), z.string());
export const importOptionsSchema = z.object({
  wallets: mappingSchema,
  accounts: mappingSchema,
  categories: mappingSchema,
  includeDuplicates: z.boolean(),
});
export type ImportOptions = z.infer<typeof importOptionsSchema>;

/** A name in the file that matches nothing yet. `key` indexes the mapping sent back. */
export interface Unmatched {
  key: string;
  label: string;
  count: number;
  kind?: Kind;
}

export interface ImportPreview {
  total: number;
  duplicates: number;
  skipped: number;
  from: string;
  to: string;
  income: string;
  expense: string;
  wallets: Unmatched[];
  accounts: Unmatched[];
  categories: Unmatched[];
  errors: string[];
  errorCount: number;
}

interface Books {
  wallets: Wallet[];
  accounts: Account[];
  categories: Category[];
}

const categoryKey = (r: CashImportRow) =>
  JSON.stringify([r.type, r.categoryParent, r.category]);

function matchCategory(r: CashImportRow, cats: readonly Category[]) {
  const named = cats.filter(
    (c) => !c.archivedAt && c.kind === r.type && c.name === r.category,
  );
  if (r.categoryParent)
    return named.find(
      (c) => cats.find((p) => p.id === c.parentId)?.name === r.categoryParent,
    );
  return (
    named.find((c) => !c.parentId) ??
    (named.length === 1 ? named[0] : undefined)
  );
}

const byName = <T extends { name: string }>(list: readonly T[], name: string) =>
  list.find((x) => x.name === name);

async function loadBooks(
  tx: Pick<Tx, "select">,
  userId: string,
): Promise<Books> {
  const [w, a, c] = await Promise.all([
    tx.select().from(wallets).where(eq(wallets.userId, userId)),
    tx.select().from(accounts).where(eq(accounts.userId, userId)),
    tx.select().from(categories).where(eq(categories.userId, userId)),
  ]);
  return {
    wallets: w,
    accounts: a.filter((x) => x.type !== "bank"),
    categories: c,
  };
}

/** Same shape as a file row, with ids in place of names, for duplicate detection. */
async function existingRows(tx: Pick<Tx, "select">, userId: string) {
  const rows = await tx
    .select()
    .from(cashEntries)
    .where(eq(cashEntries.userId, userId));
  const transfers = new Set(
    rows.filter((e) => e.type === "transfer").map((e) => e.id),
  );
  // Transfer fees are a column of their transfer; loan interest is a row of its own.
  return rows
    .filter((e) => !e.parentEntryId || !transfers.has(e.parentEntryId))
    .map((e) => ({
      date: e.occurredOn,
      type: e.type,
      direction: e.direction ?? ("" as const),
      amount: e.amount,
      wallet: e.walletId,
      toWallet: e.toWalletId ?? "",
      toAccount: e.toAccountId ?? "",
      category: e.categoryId ?? "",
      note: e.note ?? "",
    }));
}

function parseOrThrow(text: string) {
  const parsed = parseCashCsv(text);
  if (parsed.rows.length > MAX_ROWS)
    throw new LedgerError(`File có hơn ${MAX_ROWS} dòng, hãy chia nhỏ`);
  return parsed;
}

const lineError = (e: { line: number; message: string }) =>
  `Dòng ${e.line}: ${e.message}`;

function dateErrors(
  rows: CashImportRow[],
  walletOf: (name: string) => Wallet | undefined,
) {
  const today = todayVN();
  return rows.flatMap((r) => {
    if (r.date > today) return [{ line: r.line, message: "Ngày ở tương lai" }];
    for (const name of [r.wallet, r.toWallet]) {
      const w = name ? walletOf(name) : undefined;
      if (w && r.date < w.openingDate)
        return [
          {
            line: r.line,
            message: `Ví "${w.name}" bắt đầu từ ${w.openingDate} — sửa ngày bắt đầu của ví rồi nhập lại`,
          },
        ];
    }
    return [];
  });
}

export async function previewImport(
  userId: string,
  text: string,
): Promise<ImportPreview> {
  await loadCategories(userId);
  const { rows, errors, skipped } = parseOrThrow(text);
  const books = await loadBooks(db, userId);
  const activeWallets = books.wallets.filter((w) => !w.archivedAt);

  const unmatched = {
    wallets: new Map(),
    accounts: new Map(),
    categories: new Map(),
  } as Record<"wallets" | "accounts" | "categories", Map<string, Unmatched>>;
  const add = (group: keyof typeof unmatched, u: Omit<Unmatched, "count">) => {
    const found = unmatched[group].get(u.key);
    if (found) found.count += 1;
    else unmatched[group].set(u.key, { ...u, count: 1 });
  };
  let income = 0n;
  let expense = 0n;
  const resolved = rows.map((r) => {
    const w = byName(activeWallets, r.wallet);
    const tw = r.toWallet ? byName(activeWallets, r.toWallet) : undefined;
    const ta = r.toAccount ? byName(books.accounts, r.toAccount) : undefined;
    const c = r.category ? matchCategory(r, books.categories) : undefined;
    if (!w) add("wallets", { key: r.wallet, label: r.wallet });
    if (r.toWallet && !tw)
      add("wallets", { key: r.toWallet, label: r.toWallet });
    if (r.toAccount && !ta)
      add("accounts", { key: r.toAccount, label: r.toAccount });
    if (r.category && !c)
      add("categories", {
        key: categoryKey(r),
        label: r.categoryParent
          ? `${r.categoryParent} › ${r.category}`
          : r.category,
        kind: r.type as Kind,
      });
    if (!r.exclude && r.type === "income") income += r.amount;
    if (!r.exclude && r.type === "expense") expense += r.amount;
    return {
      ...r,
      wallet: w?.id ?? `?${r.wallet}`,
      toWallet: r.toWallet ? (tw?.id ?? "?") : "",
      toAccount: r.toAccount ? (ta?.id ?? "?") : "",
      category: r.category ? (c?.id ?? "?") : "",
    };
  });
  const dates = rows.map((r) => r.date).sort();
  const problems = [
    ...errors,
    ...dateErrors(rows, (name) => byName(activeWallets, name)),
  ];
  return {
    total: rows.length,
    duplicates: markDuplicates(resolved, await existingRows(db, userId)).filter(
      Boolean,
    ).length,
    skipped,
    from: dates[0] ?? "",
    to: dates.at(-1) ?? "",
    income: income.toString(),
    expense: expense.toString(),
    wallets: [...unmatched.wallets.values()],
    accounts: [...unmatched.accounts.values()],
    categories: [...unmatched.categories.values()],
    errors: problems.slice(0, 8).map(lineError),
    errorCount: problems.length,
  };
}

/** Import everything or nothing. The file is parsed and checked again: the preview is not trusted. */
export async function importCashCsv(
  userId: string,
  text: string,
  options: ImportOptions,
): Promise<{ imported: number; duplicates: number }> {
  await loadCategories(userId);
  const { rows, errors } = parseOrThrow(text);
  if (errors.length) throw new LedgerError(lineError(errors[0]));
  if (rows.length === 0)
    throw new LedgerError("File không có dòng nào để nhập");

  return db.transaction(async (tx) => {
    const books = await loadBooks(tx, userId);
    const firstUse = new Map<string, string>();
    for (const r of rows)
      for (const name of [r.wallet, r.toWallet])
        if (name && !(firstUse.get(name)! <= r.date))
          firstUse.set(name, r.date);

    const walletCache = new Map<string, Wallet>();
    for (const [name, date] of firstUse) {
      const active = books.wallets.filter((w) => !w.archivedAt);
      const choice = options.wallets[name];
      let w = byName(active, name) ?? active.find((x) => x.id === choice);
      if (!w && choice === NEW) {
        if (byName(books.wallets, name))
          throw new LedgerError(
            `Ví "${name}" đang lưu trữ — hãy mở lại hoặc chọn ví khác`,
          );
        if (name.length > 80) throw new LedgerError("Tên ví quá dài");
        [w] = await tx
          .insert(wallets)
          .values({
            userId,
            name,
            type: "other",
            openingDate: date,
            sortOrder: books.wallets.length,
          })
          .returning();
        books.wallets.push(w);
      }
      if (!w) throw new LedgerError(`Chưa chọn ví cho "${name}"`);
      walletCache.set(name, w);
    }
    const late = dateErrors(rows, (name) => walletCache.get(name));
    if (late.length) throw new LedgerError(lineError(late[0]));

    const accountOf = (name: string) => {
      const a =
        byName(books.accounts, name) ??
        books.accounts.find((x) => x.id === options.accounts[name]);
      if (!a) throw new LedgerError(`Chưa chọn tài khoản cho "${name}"`);
      return a.id;
    };
    const categoryCache = new Map<string, string>();
    const categoryOf = async (r: CashImportRow) => {
      const key = categoryKey(r);
      const cached = categoryCache.get(key);
      if (cached) return cached;
      const choice = options.categories[key];
      const id =
        matchCategory(r, books.categories)?.id ??
        (choice === NEW
          ? await createCategory(tx, userId, books, r)
          : books.categories.find(
              (c) => c.id === choice && c.kind === r.type && !c.archivedAt,
            )?.id);
      if (!id) throw new LedgerError(`Chưa chọn hạng mục cho "${r.category}"`);
      categoryCache.set(key, id);
      return id;
    };

    const resolved: (CashCsvRow & { category: string })[] = [];
    for (const r of rows) {
      const wallet = walletCache.get(r.wallet)!.id;
      const toWallet = r.toWallet ? walletCache.get(r.toWallet)!.id : "";
      if (wallet === toWallet)
        throw new LedgerError(
          `Dòng ${r.line}: ví nguồn và ví đích phải khác nhau`,
        );
      resolved.push({
        ...r,
        wallet,
        toWallet,
        toAccount: r.toAccount ? accountOf(r.toAccount) : "",
        category: r.category ? await categoryOf(r) : "",
      });
    }
    const dup = markDuplicates(resolved, await existingRows(tx, userId));
    const keep = resolved.filter(
      (_, i) => options.includeDuplicates || !dup[i],
    );

    const eventIds = new Map(
      (await tx.select().from(events).where(eq(events.userId, userId))).map(
        (e) => [e.name, e.id],
      ),
    );
    for (const name of new Set(keep.map((r) => r.event)))
      if (name && !eventIds.has(name)) {
        const [row] = await tx
          .insert(events)
          .values({ userId, name })
          .returning();
        eventIds.set(name, row.id);
      }

    const feeCategory = keep.some((r) => r.fee !== null)
      ? await systemCategory(tx, userId, "expense", BANK_FEE_CATEGORY)
      : "";
    for (let i = 0; i < keep.length; i += 500) {
      const chunk = keep
        .slice(i, i + 500)
        .map((r) => ({ id: crypto.randomUUID(), r }));
      await tx.insert(cashEntries).values(
        chunk.map(({ id, r }) => ({
          id,
          userId,
          type: r.type,
          amount: r.amount,
          occurredOn: r.date,
          walletId: r.wallet,
          toWalletId: r.toWallet || null,
          toAccountId: r.toAccount || null,
          direction: r.direction || null,
          categoryId: r.category || null,
          eventId: eventIds.get(r.event) ?? null,
          note: r.note || null,
          excludeFromReport: r.exclude,
        })),
      );
      const fees = chunk.filter(({ r }) => r.fee !== null);
      if (fees.length)
        await tx.insert(cashEntries).values(
          fees.map(({ id, r }) => ({
            userId,
            type: "expense" as const,
            amount: r.fee!,
            occurredOn: r.date,
            walletId: r.wallet,
            categoryId: feeCategory,
            parentEntryId: id,
            note: r.note || null,
          })),
        );
    }
    return { imported: keep.length, duplicates: rows.length - keep.length };
  });
}

/** Create (or bring back, when hidden) the category a row names, with its parent if needed. */
async function createCategory(
  tx: Tx,
  userId: string,
  books: Books,
  r: CashImportRow,
): Promise<string> {
  const ensure = async (name: string, parentId: string | null) => {
    if (name.length > 60)
      throw new LedgerError(`Tên hạng mục quá dài: "${name}"`);
    const found = books.categories.find(
      (c) => c.kind === r.type && c.parentId === parentId && c.name === name,
    );
    if (found) {
      if (found.archivedAt) {
        await tx
          .update(categories)
          .set({ archivedAt: null })
          .where(
            and(eq(categories.id, found.id), eq(categories.userId, userId)),
          );
        found.archivedAt = null;
      }
      return found.id;
    }
    const [row] = await tx
      .insert(categories)
      .values({
        userId,
        kind: r.type as Kind,
        parentId,
        name,
        sortOrder: books.categories.length,
      })
      .returning();
    books.categories.push(row);
    return row.id;
  };
  const parentId = r.categoryParent
    ? await ensure(r.categoryParent, null)
    : null;
  return ensure(r.category, parentId);
}
