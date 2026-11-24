import { z } from "zod";
import { parseAmount } from "@/lib/calc/cashbook/parse-amount";

/** Amount as typed in forms ("45k", "1tr2") → VND. */
export const quickAmount = z.string().transform((v, ctx) => {
  const amount = parseAmount(v);
  if (amount === null) {
    ctx.addIssue({
      code: "custom",
      message: v.trim() ? `Số tiền không hợp lệ: "${v}"` : "Nhập số tiền",
    });
    return z.NEVER;
  }
  return amount;
});
