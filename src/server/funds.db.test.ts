/**
 * Fund import and charges against a real Postgres (npm run test:db). Made-up orders only.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { DEFAULT_FEE_CONFIG } from "@/lib/calc/fees";
import { navToPrice, toHundreds } from "@/lib/calc/fund/units";
import { parseDecimal } from "@/lib/calc/decimal";

const url = vi.hoisted(() => {
  const test = process.env.TEST_DATABASE_URL;
  if (test && !/_test(\?|$)/.test(test))
    throw new Error("TEST_DATABASE_URL must name a database ending in _test");
  process.env.DATABASE_URL = test ?? "postgres://unused/unused";
  return test;
});

describe.skipIf(!url)("funds (database)", async () => {
  const { db } = await import("@/db");
  const s = await import("@/db/schema");
  const { importFundCsv, previewFundCsv } = await import("./fund-import");
  const { fundCharges } = await import("./funds");
  const { loadPortfolio, holdingsByClass } = await import("./portfolio");
  const { snapshotUser } = await import("./snapshots");
  const today = "2026-11-24";
  const MAPPED = `T${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  const HEAD =
    "order_date,match_date,fund,type,units,nav,value,fee,tax,program\n";
  const twin =
    "2026-01-05,2026-01-06,VMEEF,BUY,5.00,10000.02,50000,0,0,Linh hoạt\n";
  const csv =
    HEAD +
    "2025-01-09,2025-01-10,VMEEF,BUY,10.50,10000.02,105000,0,0,Linh hoạt\n" +
    "2025-02-09,2025-02-10,VCBF-AIF,BUY,20.25,9000.50,182260,0,0,Linh hoạt\n" +
    twin +
    twin;
  const person = async () =>
    (
      await db
        .insert(s.users)
        .values({
          email: `fund-${crypto.randomUUID()}@test.local`,
          passwordHash: "x",
        })
        .returning()
    )[0].id;
  let a: string;
  let b: string;
  const none = { funds: {} };

  beforeAll(async () => {
    a = await person();
    b = await person();
  });
  afterAll(async () => {
    await db.delete(s.users).where(inArray(s.users.id, [a, b]));
    await db.delete(s.instruments).where(eq(s.instruments.symbol, MAPPED));
  });

  it("previews without writing", async () => {
    const p = await previewFundCsv(a, csv);
    expect(p).toMatchObject({ total: 4, duplicates: 0, errorCount: 0 });
    expect(p.funds.find((f) => f.fund === "VMEEF")).toMatchObject({
      known: true,
      buys: 3,
      units: "20.5",
      value: "205000",
    });
    expect((await loadPortfolio(a)).txRows).toEqual([]);
  });

  it("imports once, also when submitted twice at the same time", async () => {
    const [x, y] = await Promise.all([
      importFundCsv(a, csv, none),
      importFundCsv(a, csv, none),
    ]);
    expect([x.imported, y.imported].sort()).toEqual([0, 4]);
    expect(await importFundCsv(a, csv, none)).toEqual({
      imported: 0,
      duplicates: 4,
    });
    // A third identical order is a new order.
    expect((await previewFundCsv(a, csv + twin)).duplicates).toBe(4);

    const p = await loadPortfolio(a);
    expect(p.accounts.map((x) => [x.name, x.type])).toEqual([
      ["Fmarket", "broker"],
    ]);
    const vmeef = holdingsByClass(p, today).fund.rows.find(
      (r) => r.instrument.symbol === "VMEEF",
    )!;
    expect(vmeef.holding.quantity).toBe(toHundreds(parseDecimal("20.5")));
    expect(vmeef.holding.costBasis).toBe(205_000n);
    expect(vmeef.instrument).toMatchObject({ providerRef: "68", unit: "ccq" });
  });

  it("keeps other users out", async () => {
    expect((await loadPortfolio(b)).txRows).toEqual([]);
    expect((await previewFundCsv(b, csv)).duplicates).toBe(0);
  });

  it("seeds the fee schedule and charges a sale lot by lot", async () => {
    const [vmeef] = await db
      .select()
      .from(s.instruments)
      .where(
        and(
          eq(s.instruments.assetClass, "fund"),
          eq(s.instruments.symbol, "VMEEF"),
        ),
      );
    const sale = {
      type: "sell" as const,
      quantity: toHundreds(parseDecimal("15.5")),
      price: navToPrice("20000"),
      date: today,
      fees: DEFAULT_FEE_CONFIG,
    };
    // 10,5 CCQ at 1% + 5 CCQ at 2%, 0,1% tax on both.
    expect(await fundCharges(db, a, vmeef.id, sale)).toMatchObject({
      fee: 4_100n,
      tax: 310n,
    });
    await expect(
      fundCharges(db, a, vmeef.id, {
        ...sale,
        quantity: toHundreds(parseDecimal("20.51")),
      }),
    ).rejects.toThrow(/vượt quá/);
    await expect(fundCharges(db, b, vmeef.id, sale)).rejects.toThrow(
      /vượt quá/,
    );
  });

  it("maps unknown funds, and rolls everything back on error", async () => {
    const other = csv.replaceAll("VCBF-AIF", MAPPED);
    expect(
      (await previewFundCsv(b, other)).funds.find((f) => f.fund === MAPPED)!
        .known,
    ).toBe(false);
    await expect(importFundCsv(b, other, none)).rejects.toThrow(/Chưa chọn/);
    const oversold =
      csv +
      "2026-02-05,2026-02-06,VMEEF,SELL,99.00,10000.00,990000,0,0,Linh hoạt\n";
    await expect(importFundCsv(b, oversold, none)).rejects.toThrow(/vượt quá/);
    expect((await loadPortfolio(b)).accounts).toEqual([]);

    await importFundCsv(b, other, { funds: { [MAPPED]: "__new" } });
    expect(
      (await loadPortfolio(b)).txRows.some(
        (r) => r.instrument.symbol === MAPPED,
      ),
    ).toBe(true);
  });

  it("writes fund snapshots, valued at cost until a NAV exists", async () => {
    await snapshotUser(b, { to: today });
    const [row] = await db
      .select()
      .from(s.portfolioSnapshots)
      .where(
        and(
          eq(s.portfolioSnapshots.userId, b),
          eq(s.portfolioSnapshots.date, today),
          eq(s.portfolioSnapshots.assetClass, "fund"),
        ),
      );
    expect(row.costBasis).toBe(387_260n);
  });

  it("keeps approvals, flags failures and takes late NAVs", async () => {
    const { runJob } = await import("./prices/runner");
    const [vmeef] = await db
      .select()
      .from(s.instruments)
      .where(
        and(
          eq(s.instruments.assetClass, "fund"),
          eq(s.instruments.symbol, "VMEEF"),
        ),
      );
    await db.delete(s.prices).where(eq(s.prices.instrumentId, vmeef.id));
    let navs: [string, number][] | null = [];
    vi.stubGlobal("fetch", async () =>
      navs
        ? Response.json({
            data: navs.map(([navDate, nav]) => ({ navDate, nav })),
          })
        : new Response("blocked", { status: 403 }),
    );
    const run = () =>
      runJob("fund", {
        trigger: "cron",
        now: new Date("2026-11-24T03:00:00Z"),
      });
    const rows = async () =>
      (
        await db
          .select()
          .from(s.prices)
          .where(eq(s.prices.instrumentId, vmeef.id))
          .orderBy(s.prices.date)
      ).map((r) => [r.date, r.price, r.needsReview, r.stale]);
    try {
      // +12% is held back; a NAV dated in the future is ignored.
      navs = [
        ["2026-11-18", 10000],
        ["2026-11-19", 11200.55],
        ["2026-11-25", 1],
      ];
      expect((await run()).status).toBe("warning");
      expect(await rows()).toEqual([
        ["2026-11-18", 1_000_000n, false, false],
        ["2026-11-19", 1_120_055n, true, false],
      ]);

      await db
        .update(s.prices)
        .set({ needsReview: false })
        .where(eq(s.prices.instrumentId, vmeef.id));
      await run();
      expect((await rows())[1]).toEqual([
        "2026-11-19",
        1_120_055n,
        false,
        false,
      ]);

      navs = null;
      expect((await run()).status).toBe("error");
      expect(await rows()).toEqual([
        ["2026-11-18", 1_000_000n, false, false],
        ["2026-11-19", 1_120_055n, false, true],
      ]);

      navs = [
        ["2026-11-19", 11200.55],
        ["2026-11-20", 11300],
      ];
      await run();
      expect((await rows()).slice(1)).toEqual([
        ["2026-11-19", 1_120_055n, false, false],
        ["2026-11-20", 1_130_000n, false, false],
      ]);

      const { fundPositions } = await import("./funds");
      const pos = (await fundPositions(await loadPortfolio(a), today)).get(
        vmeef.id,
      )!;
      expect(pos.value).toBe(231_650n);
      expect(pos.hasSchedule).toBe(true);
      expect(pos.net).toBe(pos.value - pos.fee - pos.tax);
    } finally {
      vi.unstubAllGlobals();
      const funds = await db
        .select({ id: s.instruments.id })
        .from(s.instruments)
        .where(eq(s.instruments.assetClass, "fund"));
      await db.delete(s.prices).where(
        inArray(
          s.prices.instrumentId,
          funds.map((f) => f.id),
        ),
      );
    }
  });
});
