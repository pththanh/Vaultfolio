/**
 * Cashbook against a real Postgres. Runs only with TEST_DATABASE_URL pointing at a
 * migrated database whose name ends in "_test" (npm run test:db).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { todayVN } from "@/lib/format";
import { fullNetWorthAt } from "@/lib/calc/cashbook/net-worth";
import { walletBalance } from "@/lib/calc/cashbook/balance";

const url = vi.hoisted(() => {
  const test = process.env.TEST_DATABASE_URL;
  if (test && !/_test(\?|$)/.test(test))
    throw new Error("TEST_DATABASE_URL must name a database ending in _test");
  process.env.DATABASE_URL = test ?? "postgres://unused/unused";
  return test;
});

describe.skipIf(!url)("cashbook (database)", async () => {
  const { db } = await import("@/db");
  const s = await import("@/db/schema");
  const c = await import("./cashbook");
  const sv = await import("./savings");
  const { loadPortfolio } = await import("./portfolio");
  const { snapshotUser } = await import("./snapshots");
  const today = todayVN();
  const START = "2026-01-01";

  async function person(name: string) {
    const email = `${name}-${crypto.randomUUID()}@test.local`;
    const [u] = await db
      .insert(s.users)
      .values({ email, passwordHash: "x" })
      .returning();
    const cats = await c.loadCategories(u.id);
    const mk = async (
      w: string,
      type: "bank" | "credit_card",
      openingBalance: bigint,
    ) => {
      await c.saveWallet(u.id, {
        id: undefined,
        name: w,
        type,
        openingBalance,
        openingDate: START,
        creditLimit: null,
        statementDay: null,
        dueDay: null,
        includeInNetWorth: true,
      });
      return (await db.query.wallets.findFirst({
        where: and(eq(s.wallets.userId, u.id), eq(s.wallets.name, w)),
      }))!.id;
    };
    const [broker, bankAccount] = await db
      .insert(s.accounts)
      .values([
        { userId: u.id, name: "DNSE", type: "broker" as const },
        { userId: u.id, name: "VCB", type: "bank" as const },
      ])
      .returning();
    return {
      id: u.id,
      bank: await mk("Bank", "bank", 100_000_000n),
      card: await mk("Card", "credit_card", 0n),
      broker: broker.id,
      bankAccount: bankAccount.id,
      food: cats.find((x) => x.name === "Ăn uống")!.id,
      coffee: cats.find((x) => x.name === "Cà phê/đồ uống")!.id,
      salary: cats.find((x) => x.name === "Lương")!.id,
      fee: cats.find((x) => x.name === "Phí ngân hàng")!.id,
    };
  }
  let a: Awaited<ReturnType<typeof person>>;
  let b: Awaited<ReturnType<typeof person>>;

  const parse = (raw: Record<string, string>) => c.entryFormSchema.parse(raw);
  const spend = (u: typeof a, over: Record<string, string> = {}) =>
    parse({
      type: "expense",
      amount: "45k",
      occurredOn: today,
      walletId: u.bank,
      categoryId: u.food,
      ...over,
    });
  const move = (from: string, to: string, over: Record<string, string> = {}) =>
    parse({
      type: "transfer",
      amount: "1tr",
      occurredOn: today,
      from,
      to,
      ...over,
    });
  const entries = (userId: string) =>
    db.select().from(s.cashEntries).where(eq(s.cashEntries.userId, userId));
  const balance = async (userId: string, walletId: string) => {
    const rows = await c.loadCashRows(userId);
    return walletBalance(
      rows.wallets.find((w) => w.id === walletId)!,
      rows.entries,
      today,
    );
  };

  beforeAll(async () => {
    a = await person("a");
    b = await person("b");
  });
  afterAll(async () => {
    // Also proves that deleting a user cascades through the cashbook.
    await db.delete(s.users).where(eq(s.users.id, a.id));
    await db.delete(s.users).where(eq(s.users.id, b.id));
    expect(await entries(a.id)).toEqual([]);
  });

  it("seeds default categories once", async () => {
    const { ensureDefaultCategories } = await import("./default-categories");
    const before = (await c.loadCategories(a.id)).length;
    await ensureDefaultCategories(db, a.id);
    expect((await c.loadCategories(a.id)).length).toBe(before);
    expect(before).toBeGreaterThan(50);
  });

  it("rejects every reference to another user's data", async () => {
    const bad: Record<string, () => Promise<unknown>> = {
      "wallet in expense": () =>
        c.saveEntry(a.id, spend(a, { walletId: b.bank })),
      "category in expense": () =>
        c.saveEntry(a.id, spend(a, { categoryId: b.food })),
      "source wallet": () =>
        c.saveEntry(a.id, move(`wallet:${b.bank}`, `wallet:${a.bank}`)),
      "target wallet": () =>
        c.saveEntry(a.id, move(`wallet:${a.bank}`, `wallet:${b.bank}`)),
      account: () =>
        c.saveEntry(a.id, move(`wallet:${a.bank}`, `account:${b.broker}`)),
      "adjust wallet": () =>
        c.adjustBalance(a.id, {
          walletId: b.bank,
          actual: 0n,
          occurredOn: today,
          note: "",
        }),
      "archive wallet": () => c.setWalletArchived(a.id, b.bank, true),
      "delete wallet": () => c.deleteWallet(a.id, b.bank),
      "default wallet": () => c.setDefaultWallet(a.id, b.bank),
      "archive category": () => c.setCategoryArchived(a.id, b.food, true),
      "move category": () => c.moveCategory(a.id, b.food, 1),
      "merge from": () => c.mergeCategory(a.id, b.coffee, a.food),
      "merge to": () => c.mergeCategory(a.id, a.coffee, b.food),
      "category parent": () =>
        c.saveCategory(a.id, {
          id: undefined,
          kind: "expense",
          parentId: b.food,
          name: "x",
          icon: "",
          color: undefined,
        }),
      "rename category": () =>
        c.saveCategory(a.id, {
          id: b.food,
          kind: "expense",
          parentId: undefined,
          name: "x",
          icon: "",
          color: undefined,
        }),
      "account cash": () =>
        c.setAccountCash(a.id, {
          accountId: b.broker,
          cashFrom: START,
          cashOpening: 0n,
        }),
      "savings source": () =>
        sv.createSavingsDeposit(a.id, { ...book(a), sourceWalletId: b.bank }),
    };
    for (const [name, run] of Object.entries(bad))
      await expect(run(), name).rejects.toThrow(/không tồn tại/);

    await c.saveEntry(b.id, spend(b));
    const [theirs] = await entries(b.id);
    await expect(c.deleteEntry(a.id, theirs.id)).rejects.toThrow(
      "Không tìm thấy",
    );
    await expect(
      c.saveEntry(a.id, spend(a, { id: theirs.id })),
    ).rejects.toThrow("Không tìm thấy");
    expect(await entries(b.id)).toEqual([theirs]);
    expect(await entries(a.id)).toEqual([]);
  });

  const book = (
    u: typeof a,
  ): Parameters<typeof sv.createSavingsDeposit>[1] => ({
    accountId: u.bankAccount,
    newAccount: "",
    asset: "Sổ 6T",
    quantity: 20_000_000n,
    price: 500,
    termMonths: 6,
    tradeDate: "2026-02-01",
    interestType: "end_of_term",
    rollover: "none",
    note: "",
    sourceWalletId: u.bank,
  });

  it("validates dates, kinds and endpoints", async () => {
    const no = (p: Promise<unknown>, m: RegExp) => expect(p).rejects.toThrow(m);
    await no(
      c.saveEntry(a.id, spend(a, { occurredOn: "2999-01-01" })),
      /tương lai/,
    );
    await no(
      c.saveEntry(a.id, spend(a, { occurredOn: "2025-12-31" })),
      /bắt đầu từ/,
    );
    await no(
      c.saveEntry(a.id, spend(a, { categoryId: a.salary })),
      /không khớp/,
    );
    await no(
      c.saveEntry(a.id, move(`account:${a.broker}`, `account:${a.broker}`)),
      /phải là ví/,
    );
    await no(
      c.saveEntry(a.id, move(`wallet:${a.bank}`, `wallet:${a.bank}`)),
      /khác nhau/,
    );
    await no(
      c.saveEntry(a.id, move(`wallet:${a.bank}`, `account:${a.bankAccount}`)),
      /Tiết kiệm/,
    );
    await no(
      c.saveEntry(
        a.id,
        move(`account:${a.broker}`, `wallet:${a.bank}`, { fee: "5k" }),
      ),
      /Phí/,
    );
    expect(
      c.entryFormSchema.safeParse({
        type: "expense",
        amount: "45k",
        occurredOn: "2026-02-31",
        walletId: "x",
        categoryId: "y",
      }).success,
    ).toBe(false);
    expect(await entries(a.id)).toEqual([]);
  });

  it("records a transfer fee, replaces it on edit and deletes it with the transfer", async () => {
    await c.saveEntry(
      a.id,
      move(`wallet:${a.bank}`, `wallet:${a.card}`, { fee: "11k" }),
    );
    let rows = await entries(a.id);
    const t = rows.find((r) => r.type === "transfer")!;
    const fee = rows.find((r) => r.type === "expense")!;
    expect(fee).toMatchObject({
      amount: 11_000n,
      categoryId: a.fee,
      parentEntryId: t.id,
    });
    expect(await balance(a.id, a.bank)).toBe(98_989_000n);
    await expect(c.deleteEntry(a.id, fee.id)).rejects.toThrow(/chuyển khoản/);

    await c.saveEntry(
      a.id,
      move(`wallet:${a.bank}`, `wallet:${a.card}`, { id: t.id, fee: "5k" }),
    );
    rows = await entries(a.id);
    expect(rows.filter((r) => r.parentEntryId).map((r) => r.amount)).toEqual([
      5_000n,
    ]);

    // Changing the type clears the transfer columns (CHECK constraints would fail otherwise).
    await c.saveEntry(a.id, spend(a, { id: t.id }));
    rows = await entries(a.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "expense", toWalletId: null });
    await c.deleteEntry(a.id, t.id);
    expect(await entries(a.id)).toEqual([]);
  });

  it("adjusts to the real balance", async () => {
    expect(
      await c.adjustBalance(a.id, {
        walletId: a.bank,
        actual: 99_000_000n,
        occurredOn: today,
        note: "",
      }),
    ).toBe(-1_000_000n);
    expect(
      await c.adjustBalance(a.id, {
        walletId: a.bank,
        actual: 99_000_000n,
        occurredOn: today,
        note: "",
      }),
    ).toBe(0n);
    const [adj] = await entries(a.id);
    expect(adj).toMatchObject({
      type: "adjustment",
      direction: "out",
      excludeFromReport: true,
    });
    await c.deleteEntry(a.id, adj.id);
  });

  it("links savings books to wallets both ways", async () => {
    const nw = async (d: string) => {
      const p = await loadPortfolio(a.id);
      return fullNetWorthAt(p.input, p.cash, d).total;
    };
    await sv.createSavingsDeposit(a.id, book(a));
    expect(await nw("2026-01-31")).toBe(100_000_000n);
    expect(await nw("2026-02-01")).toBe(100_000_000n);
    const p = await loadPortfolio(a.id);
    const dep = p.savings[0].row;

    await sv.updateSavingsDeposit(a.id, dep.id, {
      ...book(a),
      quantity: 30_000_000n,
      sourceWalletId: undefined,
    });
    expect(await balance(a.id, a.bank)).toBe(70_000_000n);

    await sv.closeSavingsDeposit(a.id, dep.id, {
      date: "2026-03-01",
      amount: 30_010_000n,
      walletId: a.bank,
    });
    expect(await balance(a.id, a.bank)).toBe(100_010_000n);
    expect(await nw("2026-03-01")).toBe(100_010_000n);
    const linked = await entries(a.id);
    expect(linked).toHaveLength(2);
    await expect(c.deleteEntry(a.id, linked[0].id)).rejects.toThrow(
      /Tiết kiệm/,
    );

    await sv.reopenSavingsDeposit(a.id, dep.id);
    expect(await balance(a.id, a.bank)).toBe(70_000_000n);
    await db.delete(s.savingsDeposits).where(eq(s.savingsDeposits.id, dep.id));
    expect(await entries(a.id)).toEqual([]);
  });

  it("writes cash and liability snapshots that add up to net worth", async () => {
    await c.saveEntry(a.id, spend(a, { walletId: a.card, amount: "2tr" }));
    await c.setAccountCash(a.id, {
      accountId: a.broker,
      cashFrom: START,
      cashOpening: 500_000n,
    });
    await c.saveEntry(a.id, move(`wallet:${a.bank}`, `account:${a.broker}`));
    await snapshotUser(a.id, { to: today });
    const rows = await db
      .select()
      .from(s.portfolioSnapshots)
      .where(eq(s.portfolioSnapshots.userId, a.id));
    const by = Object.fromEntries(
      rows.map((r) => [r.assetClass, r.marketValue]),
    );
    expect(by).toMatchObject({
      cash: 100_500_000n,
      receivable: 0n,
      liability: -2_000_000n,
    });
    const p = await loadPortfolio(a.id);
    expect(rows.reduce((x, r) => x + r.marketValue, 0n)).toBe(
      fullNetWorthAt(p.input, p.cash, today).total,
    );
  });

  it("manages categories", async () => {
    await c.saveEntry(a.id, spend(a, { categoryId: a.coffee }));
    await expect(c.mergeCategory(a.id, a.food, a.coffee)).rejects.toThrow(
      /khác/,
    );
    await expect(c.mergeCategory(a.id, a.coffee, a.salary)).rejects.toThrow(
      /cùng loại/,
    );
    await expect(c.mergeCategory(a.id, a.fee, a.food)).rejects.toThrow(
      /hệ thống/,
    );
    await expect(c.setCategoryArchived(a.id, a.fee, true)).rejects.toThrow(
      /hệ thống/,
    );
    expect(await c.mergeCategory(a.id, a.coffee, a.food)).toBe(1);
    await expect(
      c.saveEntry(a.id, spend(a, { categoryId: a.coffee })),
    ).rejects.toThrow(/đã ẩn/);
    const quick = await c.loadQuickEntry(a.id);
    expect(quick.categories.some((x) => x.id === a.coffee)).toBe(false);
    expect(quick.recent.expense[0]).toBe(a.food);
    const first = (await c.loadCategories(a.id)).filter(
      (x) => x.kind === "expense" && !x.parentId,
    );
    await c.moveCategory(a.id, first[1].id, -1);
    expect(
      (await c.loadCategories(a.id)).filter(
        (x) => x.kind === "expense" && !x.parentId,
      )[0].id,
    ).toBe(first[1].id);
  });

  it("sets, splits, copies and alerts on budgets", async () => {
    const bud = await import("./budgets");
    const { budgetsForMonth } = await import("@/lib/calc/cashbook/budget");
    const month = today.slice(0, 7);
    const set = (over: Record<string, string> = {}) =>
      bud.setBudget(
        b.id,
        bud.budgetFormSchema.parse({
          categoryId: "",
          month,
          scope: "month",
          amount: "100k",
          alertPct: "80",
          ...over,
        }),
      );
    await expect(set({ categoryId: a.food })).rejects.toThrow(/không tồn tại/);
    await expect(set({ categoryId: b.salary })).rejects.toThrow(/hạng mục chi/);
    await expect(
      bud.removeBudget(b.id, { categoryId: a.food, month, scope: "month" }),
    ).rejects.toThrow(/không tồn tại/);

    await set();
    await set({ categoryId: b.food, amount: "60k", scope: "onward" });
    // b already spent 45k: 45 → 90k is over the food budget and past 80% of the total.
    const warnings = await c.saveEntry(
      b.id,
      spend(b, { categoryId: b.coffee }),
    );
    expect(warnings).toHaveLength(2);
    expect(warnings.join()).toMatch(/Tổng chi tháng: đã dùng 90%/);
    expect(warnings.join()).toMatch(/Ăn uống: vượt hạn mức 30.000/);
    expect(await c.saveEntry(b.id, spend(b, { amount: "1k" }))).toEqual([]);

    const { shiftMonth } = await import("@/lib/calc/cashbook/report");
    const next = shiftMonth(month, 1);
    expect(budgetsForMonth(await bud.loadBudgets(b.id), next)).toHaveLength(1);
    expect(await bud.copyPreviousBudgets(b.id, next)).toBe(1);
    expect(await bud.copyPreviousBudgets(b.id, next)).toBe(0);
    expect(budgetsForMonth(await bud.loadBudgets(b.id), next)).toHaveLength(2);
    await set({ categoryId: b.food, amount: "70k", scope: "month" });
    const food = (await bud.loadBudgets(b.id)).filter(
      (x) => x.categoryId === b.food,
    );
    expect(food.map((x) => [x.effectiveFrom, x.effectiveTo, x.amount])).toEqual(
      expect.arrayContaining([
        [month, month, 70_000n],
        [next, null, 60_000n],
      ]),
    );
    expect(await bud.loadBudgets(a.id)).toEqual([]);
  });

  it("previews and imports CSV all-or-nothing, skipping duplicates", async () => {
    const imp = await import("./cashbook-import");
    const { CASH_CSV_HEADER } = await import("@/lib/cashbook-csv");
    const csv = [
      CASH_CSV_HEADER.join(","),
      "2026-04-01,expense,,120000,Bank,,,,Ăn uống,Cà phê/đồ uống,,'=x,",
      "2026-04-02,expense,,50000,Ví lạ,,,,Thú cưng,Thức ăn,,,",
      "2026-04-03,transfer,,200000,Bank,Ví lạ,,,,,5000,,",
      "2026-04-04,transfer,out,300000,Bank,,DNSE,,,,,,",
      "2026-04-05,adjustment,in,7000,Bank,,,,,,,,",
    ].join("\n");
    const before = (await entries(b.id)).length;
    const preview = await imp.previewImport(b.id, csv);
    expect(preview).toMatchObject({
      total: 5,
      duplicates: 0,
      errorCount: 0,
      accounts: [],
    });
    expect(preview.wallets).toEqual([
      { key: "Ví lạ", label: "Ví lạ", count: 2 },
    ]);
    expect(preview.categories).toMatchObject([
      { label: "Thú cưng › Thức ăn", kind: "expense", count: 1 },
    ]);
    const key = preview.categories[0].key;

    const opts = {
      wallets: {},
      accounts: {},
      categories: {},
      includeDuplicates: false,
    };
    await expect(imp.importCashCsv(b.id, csv, opts)).rejects.toThrow(
      /Chưa chọn ví/,
    );
    // Another user's wallet or category id is never accepted as a mapping.
    await expect(
      imp.importCashCsv(b.id, csv, { ...opts, wallets: { "Ví lạ": a.card } }),
    ).rejects.toThrow(/Chưa chọn ví/);
    await expect(
      imp.importCashCsv(b.id, csv, {
        ...opts,
        wallets: { "Ví lạ": imp.NEW },
        categories: { [key]: a.food },
      }),
    ).rejects.toThrow(/Chưa chọn hạng mục/);
    expect((await entries(b.id)).length).toBe(before);
    expect(
      (await c.loadCashRows(b.id)).wallets.some((w) => w.name === "Ví lạ"),
    ).toBe(false);

    const good = {
      ...opts,
      wallets: { "Ví lạ": imp.NEW },
      categories: { [key]: imp.NEW },
    };
    expect(await imp.importCashCsv(b.id, csv, good)).toEqual({
      imported: 5,
      duplicates: 0,
    });
    // 5 rows + 1 fee row
    expect((await entries(b.id)).length).toBe(before + 6);
    expect((await entries(b.id)).some((e) => e.note === "=x")).toBe(true);
    expect(await imp.importCashCsv(b.id, csv, good)).toEqual({
      imported: 0,
      duplicates: 5,
    });
    expect((await imp.previewImport(b.id, csv)).duplicates).toBe(5);
    const early = await imp.previewImport(
      b.id,
      csv.replace("2026-04-01", "2025-04-01"),
    );
    expect(early.errors[0]).toMatch(/Dòng 2.*bắt đầu từ/);
  });

  it("runs debts through wallets without changing net worth", async () => {
    const d = await import("./debts");
    const form = (over: Record<string, string> = {}) =>
      d.debtFormSchema.parse({
        direction: "lent",
        counterparty: "Anh Nam",
        principal: "10tr",
        startOn: "2026-03-01",
        dueOn: "",
        walletId: b.bank,
        note: "",
        ...over,
      });
    const pay = (debtId: string, over: Record<string, string> = {}) =>
      d.payDebt(
        b.id,
        d.paymentFormSchema.parse({
          debtId,
          amount: "4tr",
          interest: "",
          walletId: b.bank,
          occurredOn: "2026-03-10",
          note: "",
          ...over,
        }),
      );
    const nw = async (day: string) => {
      const p = await loadPortfolio(b.id);
      return fullNetWorthAt(p.input, p.cash, day).total;
    };
    const base = await nw("2026-03-20");
    await d.saveDebt(b.id, form());
    expect(await nw("2026-03-20")).toBe(base);
    const debt = (await loadPortfolio(b.id)).cashRows.debts[0];
    expect(await pay(debt.id)).toBe("open");
    expect(await nw("2026-03-20")).toBe(base);
    await expect(pay(debt.id, { amount: "7tr" })).rejects.toThrow(/vượt quá/);
    await expect(pay(debt.id, { occurredOn: "2026-02-01" })).rejects.toThrow(
      /bắt đầu/,
    );
    await expect(
      d.saveDebt(b.id, form({ id: debt.id, principal: "3tr" })),
    ).rejects.toThrow(/nhỏ hơn/);
    expect(await pay(debt.id, { amount: "6tr", interest: "200k" })).toBe(
      "settled",
    );
    expect(await nw("2026-03-20")).toBe(base + 200_000n);

    // Someone else cannot touch it, nor use their wallet.
    await expect(
      d.saveDebt(a.id, { ...form({ id: debt.id }), walletId: a.card }),
    ).rejects.toThrow(/không tồn tại/);
    await expect(d.deleteDebt(a.id, debt.id)).rejects.toThrow(/không tồn tại/);
    await expect(
      d.payDebt(a.id, {
        debtId: debt.id,
        amount: 1n,
        interest: null,
        walletId: a.card,
        occurredOn: today,
        note: "",
      }),
    ).rejects.toThrow(/không tồn tại/);
    await expect(d.saveDebt(b.id, form({ walletId: a.card }))).rejects.toThrow(
      /Ví không tồn tại/,
    );

    const rows = await entries(b.id);
    const last = rows.find(
      (r) => r.type === "collect" && r.amount === 6_000_000n,
    )!;
    await expect(d.deletePayment(a.id, last.id)).rejects.toThrow(
      /Không tìm thấy/,
    );
    await expect(c.deleteEntry(b.id, last.id)).rejects.toThrow(/Vay nợ/);
    await d.deletePayment(b.id, last.id);
    expect(await nw("2026-03-20")).toBe(base);
    expect((await loadPortfolio(b.id)).cashRows.debts[0].status).toBe("open");
    // Two payments at once can never exceed what is left.
    const race = await Promise.allSettled([
      pay(debt.id, { amount: "6tr" }),
      pay(debt.id, { amount: "6tr" }),
    ]);
    expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await d.deleteDebt(b.id, debt.id);
    expect(await nw("2026-03-20")).toBe(base);
    expect((await entries(b.id)).some((r) => r.debtId)).toBe(false);
  });

  it("posts recurring entries once, and waits when it cannot", async () => {
    const r = await import("./recurring");
    const form = (over: Record<string, string> = {}) =>
      r.ruleFormSchema.parse({
        type: "expense",
        amount: "3tr",
        walletId: b.card,
        categoryId: b.food,
        note: "Thuê",
        freq: "monthly",
        day: "31",
        startOn: today,
        autoPost: "on",
        ...over,
      });
    await expect(r.saveRule(b.id, form({ walletId: a.card }))).rejects.toThrow(
      /không tồn tại/,
    );
    await expect(
      r.saveRule(b.id, form({ categoryId: a.food })),
    ).rejects.toThrow(/không tồn tại/);
    await expect(
      r.saveRule(b.id, form({ startOn: "2026-01-01" })),
    ).rejects.toThrow(/quá khứ/);
    await r.saveRule(b.id, form());
    const [rule] = await r.loadRules(b.id);
    await expect(r.deleteRule(a.id, rule.id)).rejects.toThrow(/không tồn tại/);
    await expect(
      r.resolveRun(a.id, rule.id, rule.nextRunOn, 1n),
    ).rejects.toThrow(/không tồn tại/);
    const set = (v: Partial<typeof rule>) =>
      db
        .update(s.recurringRules)
        .set(v)
        .where(eq(s.recurringRules.id, rule.id));
    const posted = async () =>
      (await entries(b.id))
        .filter((x) => x.recurringRuleId === rule.id)
        .map((x) => x.occurredOn)
        .sort();

    await set({ nextRunOn: "2026-01-31" });
    await r.postRecurring("2026-03-31");
    expect(await posted()).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    await set({ nextRunOn: "2026-01-31" });
    await r.postRecurring("2026-03-31");
    expect(await posted()).toHaveLength(3);

    await c.setWalletArchived(b.id, b.card, true);
    await r.postRecurring("2026-04-30");
    expect(await posted()).toHaveLength(3);
    expect(r.waitingRules(await r.loadRules(b.id), "2026-05-01")).toMatchObject(
      [{ count: 1 }],
    );
    await expect(r.resolveRun(b.id, rule.id, "2026-04-30", 1n)).rejects.toThrow(
      /không còn dùng/,
    );
    await c.setWalletArchived(b.id, b.card, false);
    await r.resolveRun(b.id, rule.id, "2026-04-30", 3_100_000n);
    await expect(r.resolveRun(b.id, rule.id, "2026-04-30", 1n)).rejects.toThrow(
      /đã được xử lý/,
    );
    await r.resolveRun(b.id, rule.id, "2026-05-31", null);
    expect(await posted()).toHaveLength(4);
    // Moving a posted entry onto another run's date must not collide.
    const moved = (await entries(b.id)).find(
      (x) => x.occurredOn === "2026-04-30" && x.recurringRuleId,
    )!;
    await c.saveEntry(
      b.id,
      spend(b, { id: moved.id, walletId: b.card, occurredOn: "2026-03-31" }),
    );
    // Merging the category carries the rule along.
    await set({ template: { ...rule.template, categoryId: b.coffee } });
    await c.mergeCategory(b.id, b.coffee, b.food);
    expect((await r.loadRules(b.id))[0].template.categoryId).toBe(b.food);
    await set({ active: false });
    await r.setRuleActive(b.id, rule.id, true);
    expect((await r.loadRules(b.id))[0].nextRunOn >= today).toBe(true);
    await expect(c.deleteWallet(b.id, b.card)).rejects.toThrow();
    await r.deleteRule(b.id, rule.id);
    expect(
      (await entries(b.id)).filter((x) => x.note === "Thuê").length,
    ).toBeGreaterThan(2);
  });

  it("tags entries with events", async () => {
    const ev = await import("./events");
    const form = (over: Record<string, string> = {}) =>
      ev.eventFormSchema.parse({
        name: "Đà Lạt",
        startOn: "",
        endOn: "",
        budget: "5tr",
        ...over,
      });
    await ev.saveEvent(b.id, form());
    await expect(ev.saveEvent(b.id, form())).rejects.toThrow(/cùng tên/);
    const [event] = await c.loadEvents(b.id);
    await expect(ev.deleteEvent(a.id, event.id)).rejects.toThrow(
      /không tồn tại/,
    );
    await expect(
      c.saveEntry(a.id, spend(a, { walletId: a.card, eventId: event.id })),
    ).rejects.toThrow(/Sự kiện/);
    await c.saveEntry(b.id, spend(b, { eventId: event.id, note: "tagged" }));
    const tagged = (await entries(b.id)).find((x) => x.note === "tagged")!;
    expect(tagged.eventId).toBe(event.id);
    await ev.deleteEvent(b.id, event.id);
    expect(
      (await entries(b.id)).find((x) => x.id === tagged.id)!.eventId,
    ).toBeNull();
  });

  it("protects wallets that are in use", async () => {
    await expect(c.deleteWallet(a.id, a.bank)).rejects.toThrow(/lưu trữ/);
    const w = (await c.loadCashRows(a.id)).wallets.find(
      (x) => x.id === a.bank,
    )!;
    await expect(
      c.saveWallet(a.id, {
        id: w.id,
        name: w.name,
        type: w.type,
        openingBalance: 0n,
        openingDate: today,
        creditLimit: null,
        statementDay: null,
        dueDay: null,
        includeInNetWorth: true,
      }),
    ).resolves.toBeUndefined();
    await c.saveWallet(a.id, {
      id: w.id,
      name: w.name,
      type: w.type,
      openingBalance: 0n,
      openingDate: START,
      creditLimit: null,
      statementDay: null,
      dueDay: null,
      includeInNetWorth: true,
    });
    await c.saveEntry(a.id, spend(a, { occurredOn: "2026-05-01" }));
    await expect(
      c.saveWallet(a.id, {
        id: w.id,
        name: w.name,
        type: w.type,
        openingBalance: 0n,
        openingDate: "2026-05-02",
        creditLimit: null,
        statementDay: null,
        dueDay: null,
        includeInNetWorth: true,
      }),
    ).rejects.toThrow(/không được muộn hơn/);
    await c.setWalletArchived(a.id, a.bank, true);
    await expect(c.saveEntry(a.id, spend(a))).rejects.toThrow(/lưu trữ/);
  });
});
