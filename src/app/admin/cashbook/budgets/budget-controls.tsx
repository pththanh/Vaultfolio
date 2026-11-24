"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, inputClass, selectClass } from "@/components/vf/form";
import { buttonClass } from "@/components/vf/ui";
import { useFormAction } from "@/components/vf/use-form-action";
import { useRun } from "@/components/vf/use-run";
import {
  copyBudgetsAction,
  removeBudgetAction,
  saveBudgetAction,
} from "../actions";

export interface BudgetInitial {
  categoryId: string;
  name: string;
  amount: string;
  alertPct: number;
}

export function BudgetDialog({
  month,
  label,
  options,
  initial,
}: {
  month: string;
  label: string;
  /** Categories without a budget this month ("" = total). */
  options: { id: string; name: string }[];
  initial?: BudgetInitial;
}) {
  const [open, setOpen] = useState(false);
  const [, action, pending] = useFormAction(saveBudgetAction, () =>
    setOpen(false),
  );
  const [run, removing] = useRun();
  const [scope, setScope] = useState("onward");
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={initial ? `Sửa hạn mức ${initial.name}` : undefined}
        className={
          initial
            ? "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 text-[13px] font-semibold text-brand hover:bg-chip"
            : buttonClass("primary")
        }
      >
        {initial ? "Sửa" : "Thêm hạn mức"}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto p-6 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              {initial ? `Hạn mức ${initial.name}` : "Thêm hạn mức"}
            </DialogTitle>
            <DialogDescription>
              {label}. Hạn mức của hạng mục cha tính cả hạng mục con.
            </DialogDescription>
          </DialogHeader>
          <form action={action} className="flex flex-col gap-3">
            <input type="hidden" name="month" value={month} />
            {initial ? (
              <input
                type="hidden"
                name="categoryId"
                value={initial.categoryId}
              />
            ) : (
              <Field label="Hạng mục">
                <select name="categoryId" className={selectClass}>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Số tiền mỗi tháng">
              <input
                name="amount"
                required
                inputMode="decimal"
                autoComplete="off"
                placeholder="5tr"
                defaultValue={initial?.amount}
                className={`${inputClass} num`}
              />
            </Field>
            <Field label="Nhắc khi dùng đến (%)">
              <input
                type="number"
                name="alertPct"
                min={1}
                max={100}
                required
                defaultValue={initial?.alertPct ?? 80}
                className={inputClass}
              />
            </Field>
            <Field label="Áp dụng">
              <select
                name="scope"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className={selectClass}
              >
                <option value="onward">Từ tháng này trở đi</option>
                <option value="month">Chỉ tháng này</option>
              </select>
            </Field>
            <div className="flex gap-2.5 pt-1">
              <button
                type="submit"
                disabled={pending}
                className={buttonClass("primary", "flex-1")}
              >
                {pending ? "Đang lưu…" : "Lưu"}
              </button>
              {initial && (
                <button
                  type="button"
                  disabled={removing}
                  onClick={() =>
                    confirm(
                      scope === "month"
                        ? "Bỏ hạn mức này trong tháng đang xem?"
                        : "Bỏ hạn mức này từ tháng đang xem trở đi?",
                    ) &&
                    run(
                      () =>
                        removeBudgetAction(initial.categoryId, month, scope),
                      () => setOpen(false),
                    )
                  }
                  className={buttonClass("danger")}
                >
                  Bỏ
                </button>
              )}
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CopyButton({ month, count }: { month: string; count: number }) {
  const [run, pending] = useRun();
  return (
    <button
      type="button"
      disabled={pending || count === 0}
      onClick={() => run(() => copyBudgetsAction(month))}
      className={buttonClass("outline")}
    >
      Sao chép tháng trước{count > 0 && ` (${count})`}
    </button>
  );
}
