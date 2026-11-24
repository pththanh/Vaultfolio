"use client";

import { useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  inputClass,
  selectClass,
  textareaClass,
} from "@/components/vf/form";
import { buttonClass } from "@/components/vf/ui";
import { useFormAction } from "@/components/vf/use-form-action";
import { saveSavings } from "./actions";

export interface SavingsInitial {
  id: string;
  accountId: string;
  name: string;
  principal: string;
  rate: string;
  termMonths: number;
  startDate: string;
  interestType: string;
  rollover: string;
  note: string;
  sourceWalletId: string;
}

export function SavingsDialog({
  banks,
  wallets,
  today,
  initial,
  trigger,
  triggerClassName,
}: {
  banks: { id: string; name: string }[];
  wallets: { id: string; name: string }[];
  today: string;
  initial?: SavingsInitial;
  trigger: ReactNode;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [, action, pending] = useFormAction(saveSavings, () => setOpen(false));
  const [bank, setBank] = useState(
    initial?.accountId ?? banks[0]?.id ?? "__new",
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={triggerClassName}
      >
        {trigger}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto p-6 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              {initial ? "Sửa sổ tiết kiệm" : "Thêm sổ tiết kiệm"}
            </DialogTitle>
            <DialogDescription>
              Lãi tính theo ngày thực gửi (actual/365), cộng dồn đến hôm nay.
            </DialogDescription>
          </DialogHeader>
          <form action={action} className="grid grid-cols-2 gap-3">
            {initial && <input type="hidden" name="id" value={initial.id} />}
            <Field label="Ngân hàng">
              <select
                name="accountId"
                value={bank}
                onChange={(e) => setBank(e.target.value)}
                className={selectClass}
              >
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
                <option value="__new">+ Ngân hàng mới…</option>
              </select>
            </Field>
            <Field label="Tên sổ">
              <input
                name="asset"
                required
                defaultValue={initial?.name}
                placeholder="VD: Sổ 12 tháng"
                className={inputClass}
              />
            </Field>
            {bank === "__new" && (
              <Field label="Tên ngân hàng" className="col-span-2">
                <input
                  name="newAccount"
                  required
                  placeholder="VD: ACB"
                  className={inputClass}
                />
              </Field>
            )}
            <Field label="Tiền gốc (₫)">
              <input
                name="quantity"
                inputMode="numeric"
                required
                defaultValue={initial?.principal}
                placeholder="300.000.000"
                className={`${inputClass} num`}
              />
            </Field>
            <Field label="Lãi suất (%/năm)">
              <input
                name="price"
                inputMode="decimal"
                required
                defaultValue={initial?.rate}
                placeholder="5,2"
                className={`${inputClass} num`}
              />
            </Field>
            <Field label="Kỳ hạn">
              <select
                name="termMonths"
                defaultValue={String(initial?.termMonths ?? 12)}
                className={selectClass}
              >
                {[1, 2, 3, 6, 9, 12, 13, 18, 24, 36].map((m) => (
                  <option key={m} value={m}>
                    {m} tháng
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Ngày gửi">
              <input
                type="date"
                name="tradeDate"
                required
                defaultValue={initial?.startDate ?? today}
                className={inputClass}
              />
            </Field>
            <Field label="Trả lãi">
              <select
                name="interestType"
                defaultValue={initial?.interestType ?? "end_of_term"}
                className={selectClass}
              >
                <option value="end_of_term">Cuối kỳ</option>
                <option value="monthly">Hằng tháng</option>
              </select>
            </Field>
            <Field label="Khi đáo hạn">
              <select
                name="rollover"
                defaultValue={initial?.rollover ?? "principal_interest"}
                className={selectClass}
              >
                <option value="principal_interest">Tái tục gốc + lãi</option>
                <option value="principal">Tái tục gốc</option>
                <option value="none">Rút về tài khoản</option>
              </select>
            </Field>
            {wallets.length > 0 && (
              <Field
                label="Nguồn tiền"
                className="col-span-2"
                hint="Chọn ví để trừ số dư (chuyển khoản, không tính là chi)"
              >
                <select
                  name="sourceWalletId"
                  defaultValue={initial?.sourceWalletId ?? ""}
                  className={selectClass}
                >
                  <option value="">Không ghi vào ví</option>
                  {wallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Ghi chú" className="col-span-2">
              <textarea
                name="note"
                rows={2}
                defaultValue={initial?.note}
                placeholder="Không bắt buộc"
                className={textareaClass}
              />
            </Field>
            <div className="col-span-2 flex gap-2.5 pt-1">
              <button
                type="submit"
                disabled={pending}
                className={buttonClass("primary", "flex-auto")}
              >
                {pending ? "Đang lưu…" : "Lưu sổ"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className={buttonClass("outline")}
              >
                Huỷ
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
