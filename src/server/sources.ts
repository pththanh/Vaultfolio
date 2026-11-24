/** Price sources and scheduled jobs (CONTEXT.md §4). Providers are wired in step 6. */
export const SOURCE_LABEL: Record<string, string> = {
  dnse: "DNSE",
  coingecko: "CoinGecko",
  binance: "Binance",
  finhay: "Finhay",
  vnstock_js: "vnstock-js",
  vcb: "Vietcombank",
  manual: "Nhập tay",
};

export type JobKey = "stock" | "crypto" | "gold" | "fx" | "snapshot";

export const JOBS: Record<
  JobKey,
  {
    kind: string;
    name: string;
    schedule: string;
    fallback: string;
    label: string;
  }
> = {
  stock: {
    kind: "Cổ phiếu VN",
    name: "DNSE OpenAPI",
    schedule: "15:30 ngày giao dịch",
    fallback: "Nhập tay",
    label: "Cổ phiếu VN",
  },
  crypto: {
    kind: "Crypto",
    name: "CoinGecko Demo",
    schedule: "07:00 hằng ngày",
    fallback: "Binance public",
    label: "Crypto",
  },
  gold: {
    kind: "Vàng",
    name: "Finhay Open API",
    schedule: "16:00 hằng ngày",
    fallback: "vnstock-js / nhập tay",
    label: "Giá vàng",
  },
  fx: {
    kind: "Tỷ giá",
    name: "Vietcombank XML",
    schedule: "07:00 hằng ngày",
    fallback: "AllRatesToday",
    label: "Tỷ giá",
  },
  snapshot: {
    kind: "Báo cáo",
    name: "Snapshot danh mục",
    schedule: "17:00 hằng ngày",
    fallback: "Tính lại từ giao dịch",
    label: "Snapshot",
  },
};

export const JOB_KEYS = Object.keys(JOBS) as JobKey[];
