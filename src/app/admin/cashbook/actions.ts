"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formatSignedVnd } from "@/lib/format";
import {
  adjustBalance,
  adjustFormSchema,
  accountCashSchema,
  categoryFormSchema,
  deleteEntry,
  deleteWallet,
  entryFormSchema,
  mergeCategory,
  moveCategory,
  saveCategory,
  saveEntry,
  saveWallet,
  setAccountCash,
  setCategoryArchived,
  setDefaultWallet,
  setWalletArchived,
  walletFormSchema,
} from "@/server/cashbook";
import {
  budgetFormSchema,
  budgetRemoveSchema,
  copyPreviousBudgets,
  removeBudget,
  setBudget,
} from "@/server/budgets";
import {
  MAX_IMPORT_BYTES,
  importCashCsv,
  importOptionsSchema,
  previewImport,
  type ImportPreview,
} from "@/server/cashbook-import";
import {
  debtFormSchema,
  deleteDebt,
  deletePayment,
  payDebt,
  paymentFormSchema,
  saveDebt,
} from "@/server/debts";
import { deleteEvent, eventFormSchema, saveEvent } from "@/server/events";
import { quickAmount } from "@/server/fields";
import {
  deleteRule,
  resolveRun,
  ruleFormSchema,
  saveRule,
  setRuleActive,
} from "@/server/recurring";
import { LedgerError } from "@/server/ledger";
import { requireUser } from "@/server/session";
import type { FormState } from "../transactions/actions";

/** Run as the signed-in user; LedgerError and validation errors become form errors. */
async function run(
  fn: (userId: string) => Promise<string | FormState>,
): Promise<FormState> {
  const user = await requireUser();
  try {
    const result = await fn(user.id);
    revalidatePath("/admin", "layout");
    const state = typeof result === "string" ? { message: result } : result;
    return { ok: true, nonce: Date.now(), ...state };
  } catch (err) {
    if (err instanceof LedgerError) return { error: err.message };
    if (err instanceof z.ZodError)
      return { error: err.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
    throw err;
  }
}

const fields = (fd: FormData) => Object.fromEntries(fd);

export async function saveEntryAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  return run(async (userId) => {
    const form = entryFormSchema.parse(fields(fd));
    const warnings = await saveEntry(userId, form);
    return {
      message: form.id ? "Đã cập nhật ghi chép" : "Đã lưu ghi chép",
      warnings,
    };
  });
}

export async function deleteEntryAction(id: string): Promise<FormState> {
  return run(async (userId) => {
    await deleteEntry(userId, id);
    return "Đã xoá ghi chép";
  });
}

export async function saveWalletAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  return run(async (userId) => {
    const form = walletFormSchema.parse(fields(fd));
    // Cards are entered as the amount owed.
    const isCard = form.type === "credit_card";
    await saveWallet(userId, {
      ...form,
      openingBalance: isCard ? -form.openingBalance : form.openingBalance,
    });
    return form.id ? "Đã cập nhật ví" : "Đã thêm ví";
  });
}

export async function archiveWalletAction(
  id: string,
  archived: boolean,
): Promise<FormState> {
  return run(async (userId) => {
    await setWalletArchived(userId, id, archived);
    return archived ? "Đã lưu trữ ví" : "Đã mở lại ví";
  });
}

export async function deleteWalletAction(id: string): Promise<FormState> {
  return run(async (userId) => {
    await deleteWallet(userId, id);
    return "Đã xoá ví";
  });
}

export async function adjustBalanceAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  return run(async (userId) => {
    const form = adjustFormSchema.parse(fields(fd));
    const diff = await adjustBalance(userId, {
      ...form,
      actual: fd.get("isCard") ? -form.actual : form.actual,
    });
    return diff === 0n
      ? "Số dư đã khớp"
      : `Đã điều chỉnh ${formatSignedVnd(diff)}`;
  });
}

export async function setDefaultWalletAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  return run(async (userId) => {
    await setDefaultWallet(userId, String(fd.get("walletId") ?? "") || null);
    return "Đã lưu ví mặc định";
  });
}

export async function saveCategoryAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  return run(async (userId) => {
    await saveCategory(userId, categoryFormSchema.parse(fields(fd)));
    return "Đã lưu hạng mục";
  });
}

export async function archiveCategoryAction(
  id: string,
  archived: boolean,
): Promise<FormState> {
  return run(async (userId) => {
    await setCategoryArchived(userId, id, archived);
    return archived ? "Đã ẩn hạng mục" : "Đã hiện hạng mục";
  });
}

export async function moveCategoryAction(
  id: string,
  up: boolean,
): Promise<FormState> {
  return run(async (userId) => {
    await moveCategory(userId, id, up ? -1 : 1);
    return "Đã đổi thứ tự";
  });
}

export async function mergeCategoryAction(
  fromId: string,
  toId: string,
): Promise<FormState> {
  return run(async (userId) => {
    const moved = await mergeCategory(userId, fromId, toId);
    return `Đã chuyển ${moved} ghi chép và ẩn hạng mục cũ`;
  });
}

export async function setAccountCashAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  return run(async (userId) => {
    const form = accountCashSchema.parse(fields(fd));
    await setAccountCash(userId, form);
    return form.cashFrom
      ? "Đã lưu theo dõi tiền mặt"
      : "Đã tắt theo dõi tiền mặt";
  });
}

// ——— Budgets ————————————————————————————————————————————————

export async function saveBudgetAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  return run(async (userId) => {
    await setBudget(userId, budgetFormSchema.parse(fields(fd)));
    return "Đã lưu hạn mức";
  });
}

export async function removeBudgetAction(
  categoryId: string,
  month: string,
  scope: string,
): Promise<FormState> {
  return run(async (userId) => {
    await removeBudget(
      userId,
      budgetRemoveSchema.parse({ categoryId, month, scope }),
    );
    return "Đã bỏ hạn mức";
  });
}

export async function copyBudgetsAction(month: string): Promise<FormState> {
  return run(async (userId) => {
    const n = await copyPreviousBudgets(userId, month);
    return `Đã sao chép ${n} hạn mức`;
  });
}

// ——— CSV import ——————————————————————————————————————————————

async function csvText(fd: FormData): Promise<string> {
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0)
    throw new LedgerError("Chọn file CSV");
  if (file.size > MAX_IMPORT_BYTES)
    throw new LedgerError("File quá lớn (tối đa 2 MB)");
  return file.text();
}

export async function previewCashAction(
  fd: FormData,
): Promise<{ preview: ImportPreview } | { error: string }> {
  const user = await requireUser();
  try {
    return { preview: await previewImport(user.id, await csvText(fd)) };
  } catch (err) {
    if (err instanceof LedgerError) return { error: err.message };
    throw err;
  }
}

export async function importCashAction(fd: FormData): Promise<FormState> {
  return run(async (userId) => {
    let raw: unknown;
    try {
      raw = JSON.parse(String(fd.get("options") ?? ""));
    } catch {
      throw new LedgerError("Dữ liệu không hợp lệ");
    }
    const r = await importCashCsv(
      userId,
      await csvText(fd),
      importOptionsSchema.parse(raw),
    );
    return `Đã nhập ${r.imported} ghi chép${r.duplicates ? `, bỏ qua ${r.duplicates} dòng trùng` : ""}`;
  });
}

// ——— Debts ——————————————————————————————————————————————————

export async function saveDebtAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  return run(async (userId) => {
    await saveDebt(userId, debtFormSchema.parse(fields(fd)));
    return "Đã lưu khoản vay nợ";
  });
}

export async function payDebtAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  return run(async (userId) => {
    const status = await payDebt(userId, paymentFormSchema.parse(fields(fd)));
    return status === "settled" ? "Đã thanh toán xong khoản này" : "Đã ghi";
  });
}

export async function deletePaymentAction(id: string): Promise<FormState> {
  return run(async (userId) => {
    await deletePayment(userId, id);
    return "Đã xoá khoản trả";
  });
}

export async function deleteDebtAction(id: string): Promise<FormState> {
  return run(async (userId) => {
    await deleteDebt(userId, id);
    return "Đã xoá khoản vay nợ";
  });
}

// ——— Recurring entries ———————————————————————————————————————

export async function saveRuleAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  return run(async (userId) => {
    await saveRule(userId, ruleFormSchema.parse(fields(fd)));
    return "Đã lưu ghi chép định kỳ";
  });
}

export async function toggleRuleAction(
  id: string,
  active: boolean,
): Promise<FormState> {
  return run(async (userId) => {
    await setRuleActive(userId, id, active);
    return active ? "Đã tiếp tục" : "Đã tạm dừng";
  });
}

export async function deleteRuleAction(id: string): Promise<FormState> {
  return run(async (userId) => {
    await deleteRule(userId, id);
    return "Đã xoá ghi chép định kỳ";
  });
}

/** null = skip this run. */
export async function resolveRunAction(
  id: string,
  date: string,
  amount: string | null,
): Promise<FormState> {
  return run(async (userId) => {
    const value = amount === null ? null : quickAmount.parse(amount);
    const warnings = await resolveRun(userId, id, date, value);
    return {
      message: value === null ? "Đã bỏ qua kỳ này" : "Đã ghi",
      warnings,
    };
  });
}

// ——— Events —————————————————————————————————————————————————

export async function saveEventAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  return run(async (userId) => {
    await saveEvent(userId, eventFormSchema.parse(fields(fd)));
    return "Đã lưu sự kiện";
  });
}

export async function deleteEventAction(id: string): Promise<FormState> {
  return run(async (userId) => {
    await deleteEvent(userId, id);
    return "Đã xoá sự kiện";
  });
}
