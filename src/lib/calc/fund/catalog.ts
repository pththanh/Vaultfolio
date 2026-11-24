import type { FeeTier } from "./schedule";

export interface CatalogFund {
  name: string;
  /** Fmarket product id. */
  providerRef: string;
  buy: readonly FeeTier[];
  sell: readonly FeeTier[];
}

const tier = (
  fromMonths: number,
  feeBps: number,
  fromInclusive = true,
): FeeTier => ({ fromMonths, fromInclusive, feeBps });

/** When the schedules below were read from Fmarket ("Linh hoạt" program). */
export const CATALOG_EFFECTIVE_FROM = "2026-11-24";

/** Seed data for known funds (CONTEXT.md §14.3); the database is the source of truth. */
export const FUND_CATALOG: Record<string, CatalogFund> = {
  VMEEF: {
    name: "VinaCapital VMEEF",
    providerRef: "68",
    buy: [tier(0, 0)],
    sell: [tier(0, 200), tier(12, 100), tier(24, 0)],
  },
  "VCBF-AIF": {
    name: "VCBF-AIF",
    providerRef: "82",
    buy: [tier(0, 0)],
    sell: [
      tier(0, 300),
      tier(1, 200, false),
      tier(12, 50, false),
      tier(24, 0, false),
    ],
  },
};
