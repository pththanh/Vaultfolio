import type { WalletType } from "./calc/cashbook/types";

export const WALLET_LABEL: Record<WalletType, string> = {
  cash: "Tiền mặt",
  bank: "Tài khoản ngân hàng",
  ewallet: "Ví điện tử",
  credit_card: "Thẻ tín dụng",
  other: "Khác",
};
