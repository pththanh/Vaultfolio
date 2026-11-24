import { QTY_SCALE, divRound, mulQty, ratio } from "./decimal";
import type { CalcTransaction } from "./types";

export class CalcError extends Error {
  constructor(
    message: string,
    readonly transactionId?: string,
  ) {
    super(message);
    this.name = "CalcError";
  }
}

export interface Holding {
  instrumentId: string;
  /** Scaled by QTY_SCALE. */
  quantity: bigint;
  /** Total cost of the units still held (weighted average method), VND. */
  costBasis: bigint;
  /** Closed trades and standalone fees, VND. */
  realizedPnl: bigint;
  /** Cash dividends and interest net of tax, VND. */
  dividendIncome: bigint;
}

/** Stable chronological order: trade date, then input order. */
export function sortTransactions<T extends { tradeDate: string }>(
  txs: readonly T[],
): T[] {
  return txs
    .map((tx, i) => [tx, i] as const)
    .sort(([a, i], [b, j]) =>
      a.tradeDate < b.tradeDate ? -1 : a.tradeDate > b.tradeDate ? 1 : i - j,
    )
    .map(([tx]) => tx);
}

/**
 * Replay transactions into holdings using weighted average cost.
 * Holdings are never stored: this is the single source of truth.
 */
export function computeHoldings(
  txs: readonly CalcTransaction[],
  options: { asOf?: string; onRealized?: (event: RealizedEvent) => void } = {},
): Map<string, Holding> {
  const emit = (
    tx: CalcTransaction,
    kind: RealizedEvent["kind"],
    amount: bigint,
  ) =>
    options.onRealized?.({
      transactionId: tx.id,
      instrumentId: tx.instrumentId,
      date: tx.tradeDate,
      kind,
      amount,
    });
  const holdings = new Map<string, Holding>();
  const get = (id: string) => {
    let h = holdings.get(id);
    if (!h) {
      h = {
        instrumentId: id,
        quantity: 0n,
        costBasis: 0n,
        realizedPnl: 0n,
        dividendIncome: 0n,
      };
      holdings.set(id, h);
    }
    return h;
  };

  for (const tx of sortTransactions(txs)) {
    if (options.asOf && tx.tradeDate > options.asOf) break;
    const h = get(tx.instrumentId);
    const gross = mulQty(tx.quantity, tx.price);

    switch (tx.type) {
      case "buy":
        h.quantity += tx.quantity;
        h.costBasis += gross + tx.fee + tx.tax;
        break;
      case "sell": {
        if (tx.quantity > h.quantity) {
          throw new CalcError("Bán vượt quá số lượng đang nắm giữ", tx.id);
        }
        const costOut =
          tx.quantity === h.quantity
            ? h.costBasis
            : divRound(h.costBasis * tx.quantity, h.quantity);
        h.quantity -= tx.quantity;
        h.costBasis -= costOut;
        h.realizedPnl += gross - tx.fee - tx.tax - costOut;
        emit(tx, "trade", gross - tx.fee - tx.tax - costOut);
        break;
      }
      case "dividend_stock":
      case "bonus_share":
        // Extra shares at zero cost: quantity up, cost unchanged, average down.
        h.quantity += tx.quantity;
        h.costBasis += tx.fee;
        break;
      case "dividend_cash":
      case "interest":
        h.dividendIncome += gross - tx.fee - tx.tax;
        emit(tx, "income", gross - tx.fee - tx.tax);
        break;
      case "fee":
        h.realizedPnl -= tx.fee + tx.tax;
        emit(tx, "fee", -(tx.fee + tx.tax));
        break;
      case "deposit":
      case "withdraw":
        // Cash movements do not change instrument holdings.
        break;
    }
  }
  return holdings;
}

export interface RealizedEvent {
  transactionId: string;
  instrumentId: string;
  date: string;
  /** trade = closed position P/L, income = dividends/interest net of tax, fee = standalone fee. */
  kind: "trade" | "income" | "fee";
  amount: bigint;
}

/** Every realized amount in chronological order, for income reports. */
export function realizedEvents(
  txs: readonly CalcTransaction[],
): RealizedEvent[] {
  const events: RealizedEvent[] = [];
  computeHoldings(txs, { onRealized: (e) => events.push(e) });
  return events;
}

/** Average cost per unit in VND, rounded. */
export function averageCost(
  h: Pick<Holding, "quantity" | "costBasis">,
): bigint {
  if (h.quantity === 0n) return 0n;
  return divRound(h.costBasis * QTY_SCALE, h.quantity);
}

export function unrealized(
  h: Pick<Holding, "quantity" | "costBasis">,
  price: bigint,
) {
  const marketValue = mulQty(h.quantity, price);
  const amount = marketValue - h.costBasis;
  return { marketValue, amount, ratio: ratio(amount, h.costBasis) };
}

/**
 * Money moving between the investor and the portfolio, investor perspective:
 * negative = paid in (buy, deposit, fee), positive = received.
 */
export function cashFlow(tx: CalcTransaction): bigint {
  const gross = mulQty(tx.quantity, tx.price);
  switch (tx.type) {
    case "buy":
      return -(gross + tx.fee + tx.tax);
    case "sell":
    case "dividend_cash":
    case "interest":
      return gross - tx.fee - tx.tax;
    case "deposit":
      return -gross;
    case "withdraw":
      return gross;
    case "fee":
      return -(tx.fee + tx.tax);
    case "dividend_stock":
    case "bonus_share":
      return -tx.fee;
  }
}
