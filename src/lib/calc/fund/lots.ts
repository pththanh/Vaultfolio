import { divRound, mulQty } from "../decimal";
import { CalcError, sortTransactions } from "../holdings";
import type { CalcTransaction } from "../types";
import {
  freeOfChargesOn,
  holdingTaxBps,
  monthsHeld,
  tierAt,
  tierStart,
  type FeeTier,
  type FundTax,
} from "./schedule";

export interface FundLot {
  transactionId: string;
  /** Match date (units allotted). */
  date: string;
  /** Hundreds of CCQ, scaled. */
  quantity: bigint;
  price: bigint;
  /** Cost of the units left, buy fee included. */
  cost: bigint;
}

function takeFifo(
  lots: readonly FundLot[],
  quantity: bigint,
  transactionId?: string,
): { taken: FundLot[]; rest: FundLot[] } {
  const taken: FundLot[] = [];
  const rest: FundLot[] = [];
  let left = quantity;
  for (const lot of lots) {
    if (left === 0n) rest.push(lot);
    else if (lot.quantity <= left) {
      taken.push(lot);
      left -= lot.quantity;
    } else {
      const cost = divRound(lot.cost * left, lot.quantity);
      taken.push({ ...lot, quantity: left, cost });
      rest.push({
        ...lot,
        quantity: lot.quantity - left,
        cost: lot.cost - cost,
      });
      left = 0n;
    }
  }
  if (left > 0n)
    throw new CalcError("Bán vượt quá số lượng đang nắm giữ", transactionId);
  return { taken, rest };
}

/** Lots of one fund still held, oldest first. Sales consume them FIFO. */
export function fundLots(
  txs: readonly CalcTransaction[],
  asOf?: string,
): FundLot[] {
  let lots: FundLot[] = [];
  for (const tx of sortTransactions(txs)) {
    if (asOf && tx.tradeDate > asOf) break;
    if (tx.type === "buy")
      lots.push({
        transactionId: tx.id,
        date: tx.tradeDate,
        quantity: tx.quantity,
        price: tx.price,
        cost: mulQty(tx.quantity, tx.price) + tx.fee + tx.tax,
      });
    else if (tx.type === "sell") lots = takeFifo(lots, tx.quantity, tx.id).rest;
  }
  return lots;
}

const bps = (amount: bigint, rate: number) =>
  divRound(amount * BigInt(rate), 10_000n);

function lotCharges(
  lot: FundLot,
  price: bigint,
  date: string,
  tiers: readonly FeeTier[],
  tax: FundTax,
) {
  const value = mulQty(lot.quantity, price);
  const feeBps = tierAt(tiers, lot.date, date)?.feeBps ?? 0;
  const taxBps = holdingTaxBps(lot.date, date, tax);
  return {
    value,
    feeBps,
    taxBps,
    fee: bps(value, feeBps),
    tax: bps(value, taxBps),
  };
}

export interface FundSale {
  gross: bigint;
  fee: bigint;
  tax: bigint;
  net: bigint;
}

/** Fee and tax of selling `quantity` on `date`, lot by lot. */
export function fundSale(
  lots: readonly FundLot[],
  quantity: bigint,
  price: bigint,
  date: string,
  tiers: readonly FeeTier[],
  tax: FundTax,
): FundSale {
  const gross = mulQty(quantity, price);
  const out = { gross, fee: 0n, tax: 0n, net: gross };
  for (const lot of takeFifo(lots, quantity).taken) {
    const c = lotCharges(lot, price, date, tiers, tax);
    out.fee += c.fee;
    out.tax += c.tax;
  }
  out.net -= out.fee + out.tax;
  return out;
}

export interface FundLotView extends FundLot {
  months: number;
  value: bigint;
  feeBps: number;
  taxBps: number;
  fee: bigint;
  tax: bigint;
  /** Next date with a lower sell fee. */
  stepDownOn: string | null;
  /** First date with neither fee nor tax. */
  freeOn: string | null;
}

export interface FundPosition {
  units: bigint;
  cost: bigint;
  /** At NAV. */
  value: bigint;
  fee: bigint;
  tax: bigint;
  /** Received if everything were sold on `date`. */
  net: bigint;
  pl: bigint;
  netPl: bigint;
  nextStepDown: string | null;
  nextFree: string | null;
  lots: FundLotView[];
}

const earliest = (dates: (string | null)[]) =>
  dates.filter((d) => d !== null).sort()[0] ?? null;

export function fundPosition(
  lots: readonly FundLot[],
  price: bigint,
  date: string,
  tiers: readonly FeeTier[],
  tax: FundTax,
): FundPosition {
  const views = lots.map((lot): FundLotView => {
    const c = lotCharges(lot, price, date, tiers, tax);
    const lower = tiers.filter((t) => t.feeBps < c.feeBps);
    return {
      ...lot,
      ...c,
      months: monthsHeld(lot.date, date),
      stepDownOn: earliest(
        lower.map((t) => tierStart(lot.date, t)).filter((d) => d > date),
      ),
      freeOn: freeOfChargesOn(lot.date, tiers, tax),
    };
  });
  const units = lots.reduce((s, l) => s + l.quantity, 0n);
  const cost = lots.reduce((s, l) => s + l.cost, 0n);
  const value = mulQty(units, price);
  const fee = views.reduce((s, l) => s + l.fee, 0n);
  const taxSum = views.reduce((s, l) => s + l.tax, 0n);
  const net = value - fee - taxSum;
  return {
    units,
    cost,
    value,
    fee,
    tax: taxSum,
    net,
    pl: value - cost,
    netPl: net - cost,
    nextStepDown: earliest(views.map((l) => l.stepDownOn)),
    nextFree: earliest(
      views.map((l) => (l.freeOn && l.freeOn > date ? l.freeOn : null)),
    ),
    lots: views,
  };
}
