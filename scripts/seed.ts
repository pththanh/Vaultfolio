/**
 * Seed sample data matching docs/design (owner account, holdings, savings,
 * price history, review queue, job log). Wipes all tables first.
 *
 *   npm run db:seed            # refuses when NODE_ENV=production
 */
import { config } from "dotenv";
import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, ne, sql } from "drizzle-orm";
import postgres from "postgres";
import * as s from "../src/db/schema";
import { DEFAULT_FEE_CONFIG } from "../src/lib/calc/fees";
import { ensureDefaultCategories } from "../src/server/default-categories";

config({ path: ".env.local" });

if (
  process.env.NODE_ENV === "production" &&
  !process.argv.includes("--force")
) {
  console.error(
    "Refusing to wipe a production database. Pass --force if you really mean it.",
  );
  process.exit(1);
}
const email = process.env.SEED_OWNER_EMAIL;
const password = process.env.SEED_OWNER_PASSWORD;
if (!email || !password) {
  console.error("Set SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD in .env.local");
  process.exit(1);
}

const client = postgres(process.env.DATABASE_URL!, {
  max: 1,
  onnotice: () => {},
});
const db = drizzle(client, { schema: s, casing: "snake_case" });

// Deterministic PRNG so every seed produces the same charts.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261121);
const gauss = () =>
  Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (
    let d = new Date(`${from}T00:00:00Z`);
    d <= new Date(`${to}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
const dow = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

/** Brownian bridge in log space: exact start and end, noisy in between. */
function bridge(
  days: string[],
  start: number,
  end: number,
  vol: number,
  roundTo: number,
): bigint[] {
  const n = days.length - 1;
  const walk = [0];
  for (let i = 1; i <= n; i++) walk.push(walk[i - 1] + gauss() * vol);
  return days.map((_, i) => {
    const t = i / n;
    const logP =
      Math.log(start) +
      t * (Math.log(end) - Math.log(start)) +
      (walk[i] - t * walk[n]);
    return BigInt(Math.round(Math.exp(logP) / roundTo) * roundTo);
  });
}

/** Wall-clock time in Vietnam (UTC+7) → Date. */
const vn = (iso: string, hhmm: string) => new Date(`${iso}T${hhmm}:00+07:00`);

async function main() {
  const others = await db
    .select({ id: s.users.id })
    .from(s.users)
    .where(ne(s.users.email, email!.toLowerCase()));
  if (others.length && !process.argv.includes("--force"))
    throw new Error(
      `This database has ${others.length} user(s) besides ${email}; seeding would erase their data. Use another database, or pass --force.`,
    );
  console.log("Wiping tables…");
  await db.execute(
    sql`TRUNCATE users, instruments, prices, fx_rates, job_runs RESTART IDENTITY CASCADE`,
  );

  const [owner] = await db
    .insert(s.users)
    .values({
      email: email!.toLowerCase(),
      passwordHash: await bcrypt.hash(password!, 12),
    })
    .returning();
  await db
    .insert(s.userSettings)
    .values({ userId: owner.id, fees: DEFAULT_FEE_CONFIG });

  const acc = Object.fromEntries(
    (
      await db
        .insert(s.accounts)
        .values([
          { userId: owner.id, name: "DNSE", type: "broker" as const },
          { userId: owner.id, name: "Ví Binance", type: "exchange" as const },
          { userId: owner.id, name: "DOJI", type: "physical" as const },
          {
            userId: owner.id,
            name: "Bảo Tín Minh Châu",
            type: "physical" as const,
          },
          { userId: owner.id, name: "MB Bank", type: "bank" as const },
          { userId: owner.id, name: "Techcombank", type: "bank" as const },
          { userId: owner.id, name: "Vietcombank", type: "bank" as const },
        ])
        .returning()
    ).map((a) => [a.name, a.id]),
  );

  type Spec = typeof s.instruments.$inferInsert & {
    key: string;
    start: number;
    end: number;
    vol: number;
    round: number;
    days: "weekday" | "daily" | "no-sunday";
  };
  const specs: Spec[] = [
    {
      key: "MWG",
      assetClass: "stock",
      symbol: "MWG",
      name: "Thế Giới Di Động",
      exchange: "HOSE",
      unit: "share",
      providerRef: "MWG",
      start: 52_000,
      end: 69_740,
      vol: 0.016,
      round: 10,
      days: "weekday",
    },
    {
      key: "VCB",
      assetClass: "stock",
      symbol: "VCB",
      name: "Vietcombank",
      exchange: "HOSE",
      unit: "share",
      providerRef: "VCB",
      start: 85_000,
      end: 92_400,
      vol: 0.011,
      round: 100,
      days: "weekday",
    },
    {
      key: "HPG",
      assetClass: "stock",
      symbol: "HPG",
      name: "Hòa Phát",
      exchange: "HOSE",
      unit: "share",
      providerRef: "HPG",
      start: 22_000,
      end: 26_950,
      vol: 0.015,
      round: 50,
      days: "weekday",
    },
    {
      key: "FPT",
      assetClass: "stock",
      symbol: "FPT",
      name: "FPT",
      exchange: "HOSE",
      unit: "share",
      providerRef: "FPT",
      start: 120_000,
      end: 112_300,
      vol: 0.014,
      round: 100,
      days: "weekday",
    },
    {
      key: "SSI",
      assetClass: "stock",
      symbol: "SSI",
      name: "Chứng khoán SSI",
      exchange: "HOSE",
      unit: "share",
      providerRef: "SSI",
      start: 24_000,
      end: 31_000,
      vol: 0.018,
      round: 50,
      days: "weekday",
    },
    // Index points are stored in hundredths (1.675,50 điểm → 167550).
    {
      key: "VNINDEX",
      assetClass: "index",
      symbol: "VNINDEX",
      name: "VN-Index",
      exchange: "HOSE",
      unit: "point",
      providerRef: "VNINDEX",
      start: 135_000,
      end: 167_550,
      vol: 0.009,
      round: 1,
      days: "weekday",
    },
    {
      key: "BTC",
      assetClass: "crypto",
      symbol: "BTC",
      name: "Bitcoin",
      unit: "coin",
      providerRef: "bitcoin",
      start: 2_300_000_000,
      end: 2_400_000_000,
      vol: 0.025,
      round: 100_000,
      days: "daily",
    },
    {
      key: "ETH",
      assetClass: "crypto",
      symbol: "ETH",
      name: "Ethereum",
      unit: "coin",
      providerRef: "ethereum",
      start: 60_000_000,
      end: 86_000_000,
      vol: 0.03,
      round: 10_000,
      days: "daily",
    },
    {
      key: "SJC",
      assetClass: "gold",
      symbol: "Miếng SJC · DOJI",
      name: "Vàng miếng SJC tại DOJI",
      unit: "luong",
      providerRef: "SJC_BAR@DOJI",
      start: 11_800_000,
      end: 14_650_000,
      vol: 0.006,
      round: 10_000,
      days: "no-sunday",
    },
    {
      key: "RING",
      assetClass: "gold",
      symbol: "Nhẫn tròn 9999 · BTMC",
      name: "Nhẫn tròn trơn 9999 Bảo Tín Minh Châu",
      unit: "chi",
      providerRef: "RING_9999@BTMC",
      start: 11_500_000,
      end: 15_300_000,
      vol: 0.007,
      round: 10_000,
      days: "no-sunday",
    },
  ];

  const inst: Record<string, string> = {};
  for (const { key, start, end, vol, round, days, ...values } of specs) {
    void start;
    void end;
    void vol;
    void round;
    void days;
    const [row] = await db.insert(s.instruments).values(values).returning();
    inst[key] = row.id;
  }

  console.log("Generating price history…");
  const sourceOf = {
    stock: ["dnse", "15:32"],
    index: ["dnse", "15:32"],
    crypto: ["coingecko", "07:00"],
    gold: ["finhay", "16:00"],
  } as const;
  const priceRows: (typeof s.prices.$inferInsert)[] = [];
  for (const spec of specs) {
    const last =
      spec.assetClass === "stock" ||
      spec.assetClass === "index" ||
      spec.assetClass === "gold"
        ? "2026-11-20"
        : "2026-11-21";
    const days = eachDay("2025-06-02", last).filter((d) =>
      spec.days === "weekday"
        ? dow(d) !== 0 && dow(d) !== 6
        : spec.days === "no-sunday"
          ? dow(d) !== 0
          : true,
    );
    const values = bridge(days, spec.start, spec.end, spec.vol, spec.round);
    const [source, time] = sourceOf[spec.assetClass as keyof typeof sourceOf];
    days.forEach((date, i) =>
      priceRows.push({
        instrumentId: inst[spec.key],
        date,
        price: values[i],
        source,
        fetchedAt: vn(date, time),
      }),
    );
  }
  // Today's gold quotes were held back for review (see Prices screen).
  priceRows.push(
    {
      instrumentId: inst.RING,
      date: "2026-11-21",
      price: 12_850_000n,
      source: "finhay",
      needsReview: true,
      reviewReason: "Lệch hơn 15%; các tiệm khác không biến động tương tự",
      fetchedAt: vn("2026-11-21", "09:00"),
    },
    {
      instrumentId: inst.SJC,
      date: "2026-11-21",
      price: 0n,
      source: "finhay",
      needsReview: true,
      reviewReason: "Nguồn trả giá 0 (có thể chưa cập nhật)",
      fetchedAt: vn("2026-11-21", "09:00"),
    },
  );
  for (let i = 0; i < priceRows.length; i += 1000)
    await db.insert(s.prices).values(priceRows.slice(i, i + 1000));

  await db.insert(s.fxRates).values({
    date: "2026-11-21",
    pair: "USD/VND",
    rate: "26315.000000",
    source: "vcb",
  });

  console.log("Inserting transactions…");
  type Tx = typeof s.transactions.$inferInsert;
  const tx = (
    t: Omit<Tx, "fee" | "tax" | "price"> & {
      price?: bigint;
      fee?: bigint;
      tax?: bigint;
    },
  ): Tx => ({
    price: 0n,
    fee: 0n,
    tax: 0n,
    ...t,
  });
  await db.insert(s.transactions).values([
    tx({
      accountId: acc.DNSE,
      instrumentId: inst.MWG,
      type: "buy",
      quantity: "5000",
      price: 61_108n,
      fee: 458_310n,
      tradeDate: "2025-10-15",
    }),
    tx({
      accountId: acc.DNSE,
      instrumentId: inst.VCB,
      type: "buy",
      quantity: "3000",
      price: 87_868n,
      fee: 395_406n,
      tradeDate: "2025-10-20",
    }),
    tx({
      accountId: acc.DNSE,
      instrumentId: inst.HPG,
      type: "buy",
      quantity: "9000",
      price: 24_520n,
      fee: 331_020n,
      tradeDate: "2025-11-03",
    }),
    tx({
      accountId: acc.DNSE,
      instrumentId: inst.FPT,
      type: "buy",
      quantity: "1740",
      price: 113_050n,
      fee: 295_061n,
      tradeDate: "2025-11-10",
    }),
    tx({
      accountId: acc["Ví Binance"],
      instrumentId: inst.ETH,
      type: "buy",
      quantity: "0.5",
      price: 68_100_000n,
      fee: 34_050n,
      tradeDate: "2025-12-05",
    }),
    tx({
      accountId: acc.DNSE,
      instrumentId: inst.SSI,
      type: "buy",
      quantity: "2000",
      price: 27_500n,
      fee: 82_500n,
      tradeDate: "2026-01-08",
    }),
    tx({
      accountId: acc.DOJI,
      instrumentId: inst.SJC,
      type: "buy",
      quantity: "20",
      price: 13_950_000n,
      tradeDate: "2026-01-15",
      note: "2 lượng",
    }),
    tx({
      accountId: acc["Ví Binance"],
      instrumentId: inst.BTC,
      type: "buy",
      quantity: "0.065",
      price: 2_150_000_000n,
      fee: 139_750n,
      tradeDate: "2026-02-10",
    }),
    tx({
      accountId: acc.DNSE,
      instrumentId: inst.FPT,
      type: "bonus_share",
      quantity: "260",
      tradeDate: "2026-03-02",
      note: "Tỷ lệ 20:3",
    }),
    tx({
      accountId: acc.DNSE,
      instrumentId: inst.SSI,
      type: "sell",
      quantity: "2000",
      price: 31_200n,
      fee: 93_600n,
      tax: 62_400n,
      tradeDate: "2026-04-14",
    }),
    tx({
      accountId: acc["Bảo Tín Minh Châu"],
      instrumentId: inst.RING,
      type: "buy",
      quantity: "10",
      price: 13_900_000n,
      tradeDate: "2026-05-22",
    }),
    tx({
      accountId: acc["Ví Binance"],
      instrumentId: inst.ETH,
      type: "buy",
      quantity: "0.25",
      price: 85_600_000n,
      fee: 21_400n,
      tradeDate: "2026-11-05",
    }),
    tx({
      accountId: acc.DNSE,
      instrumentId: inst.VCB,
      type: "dividend_cash",
      quantity: "3000",
      price: 1_000n,
      tax: 150_000n,
      tradeDate: "2026-11-12",
    }),
    tx({
      accountId: acc.DNSE,
      instrumentId: inst.HPG,
      type: "buy",
      quantity: "1000",
      price: 26_950n,
      fee: 40_425n,
      tradeDate: "2026-11-18",
    }),
  ]);

  await db.insert(s.savingsDeposits).values([
    {
      accountId: acc["MB Bank"],
      name: "Sổ 6 tháng",
      bank: "MB Bank",
      principal: 135_000_000n,
      rateBps: 460,
      termMonths: 6,
      startDate: "2026-06-05",
      rollover: "principal_interest",
    },
    {
      accountId: acc.Techcombank,
      name: "Sổ 9 tháng",
      bank: "Techcombank",
      principal: 250_000_000n,
      rateBps: 500,
      termMonths: 9,
      startDate: "2026-06-02",
      rollover: "none",
    },
    {
      accountId: acc.Vietcombank,
      name: "Sổ 12 tháng",
      bank: "Vietcombank",
      principal: 300_000_000n,
      rateBps: 520,
      termMonths: 12,
      startDate: "2026-06-29",
      rollover: "principal",
    },
  ]);

  await seedCashbook(owner.id, acc.DNSE);

  const run = (
    job: string,
    start: Date,
    status: (typeof s.jobRuns.$inferInsert)["status"],
    detail: string,
  ) => ({
    job,
    startedAt: start,
    finishedAt: new Date(start.getTime() + 2000),
    status,
    detail,
  });
  await db
    .insert(s.jobRuns)
    .values([
      run(
        "stock",
        vn("2026-11-20", "15:30"),
        "retry",
        "429 Too Many Requests · Retry-After 2s · thành công ở lần 2",
      ),
      run(
        "stock",
        vn("2026-11-20", "15:32"),
        "success",
        "OHLC 1D · 5 mã · đã quy đổi nghìn đồng × 1.000",
      ),
      run("fx", vn("2026-11-21", "07:00"), "success", "USD/VND chuyển khoản"),
      run(
        "crypto",
        vn("2026-11-21", "07:00"),
        "success",
        "1 lượt gọi /simple/price · 2 coin · vs_currencies=vnd,usd",
      ),
      run(
        "gold",
        vn("2026-11-21", "09:00"),
        "warning",
        "2 giá bị giữ lại để xem xét; giá cũ được dùng tạm (stale)",
      ),
      run(
        "stock",
        vn("2026-11-21", "15:30"),
        "skipped",
        "Thứ Bảy, không có phiên giao dịch (working dates)",
      ),
    ]);

  console.log(`Done. Owner: ${email} · ${priceRows.length} prices`);
}

/** One month of income and spending, plus wallets and a tracked broker account. */
async function seedCashbook(userId: string, dnse: string) {
  await ensureDefaultCategories(db, userId);
  const cats = await db.select().from(s.categories);
  const cat = (name: string) => cats.find((c) => c.name === name)!.id;
  const from = "2026-10-20";
  const [cash, bank, momo, card] = await db
    .insert(s.wallets)
    .values([
      {
        userId,
        name: "Tiền mặt",
        type: "cash" as const,
        openingBalance: 3_500_000n,
        openingDate: from,
        sortOrder: 0,
      },
      {
        userId,
        name: "VCB thanh toán",
        type: "bank" as const,
        openingBalance: 42_000_000n,
        openingDate: from,
        sortOrder: 1,
      },
      {
        userId,
        name: "MoMo",
        type: "ewallet" as const,
        openingBalance: 850_000n,
        openingDate: from,
        sortOrder: 2,
      },
      {
        userId,
        name: "Thẻ tín dụng",
        type: "credit_card" as const,
        openingBalance: -2_400_000n,
        openingDate: from,
        creditLimit: 50_000_000n,
        statementDay: 20,
        dueDay: 5,
        sortOrder: 3,
      },
    ])
    .returning();
  await db
    .update(s.accounts)
    .set({ cashFrom: "2026-10-20", cashOpening: 60_000_000n })
    .where(eq(s.accounts.id, dnse));

  const spend = (
    occurredOn: string,
    walletId: string,
    name: string,
    amount: bigint,
    note?: string,
  ) => ({
    userId,
    type: "expense" as const,
    occurredOn,
    walletId,
    categoryId: cat(name),
    amount,
    note,
  });
  const base = { userId, occurredOn: "", amount: 0n };
  const rows: (typeof s.cashEntries.$inferInsert)[] = [
    {
      ...base,
      type: "income",
      occurredOn: "2026-10-31",
      walletId: bank.id,
      categoryId: cat("Lương"),
      amount: 32_000_000n,
      note: "Lương tháng 10",
    },
    {
      ...base,
      type: "income",
      occurredOn: "2026-11-12",
      walletId: bank.id,
      categoryId: cat("Thu nhập phụ/freelance"),
      amount: 4_500_000n,
    },
    spend("2026-11-01", bank.id, "Tiền nhà", 8_500_000n),
    spend("2026-11-02", cash.id, "Đi chợ/siêu thị", 420_000n),
    spend("2026-11-03", momo.id, "Cà phê/đồ uống", 55_000n),
    spend("2026-11-05", bank.id, "Điện", 640_000n),
    spend("2026-11-05", bank.id, "Internet", 220_000n),
    spend("2026-11-07", card.id, "Quần áo", 1_250_000n),
    spend("2026-11-08", cash.id, "Xăng xe", 90_000n),
    spend("2026-11-10", card.id, "Ăn ngoài", 780_000n, "Sinh nhật"),
    spend("2026-11-14", bank.id, "Đám cưới", 1_000_000n),
    spend("2026-11-16", momo.id, "Taxi/Grab", 120_000n),
    spend("2026-11-18", cash.id, "Đi chợ/siêu thị", 510_000n),
    spend("2026-11-20", card.id, "Ứng dụng & dịch vụ đăng ký", 260_000n),
    {
      ...base,
      type: "transfer",
      occurredOn: "2026-11-04",
      walletId: bank.id,
      toWalletId: card.id,
      amount: 2_400_000n,
      note: "Trả nợ thẻ",
    },
    {
      ...base,
      type: "transfer",
      occurredOn: "2026-11-06",
      walletId: bank.id,
      toWalletId: cash.id,
      amount: 2_000_000n,
      note: "Rút ATM",
    },
    {
      ...base,
      type: "transfer",
      occurredOn: "2026-11-09",
      walletId: bank.id,
      toAccountId: dnse,
      direction: "out",
      amount: 10_000_000n,
    },
    {
      ...base,
      type: "adjustment",
      occurredOn: "2026-11-19",
      walletId: cash.id,
      direction: "out",
      amount: 35_000n,
      excludeFromReport: true,
    },
  ];
  await db.insert(s.cashEntries).values(rows);
  const budget = (categoryId: string | null, amount: bigint) => ({
    userId,
    categoryId,
    amount,
    effectiveFrom: "2026-10",
  });
  await db
    .insert(s.budgets)
    .values([
      budget(null, 18_000_000n),
      budget(cat("Ăn uống"), 2_000_000n),
      budget(cat("Mua sắm"), 1_000_000n),
    ]);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => client.end());
