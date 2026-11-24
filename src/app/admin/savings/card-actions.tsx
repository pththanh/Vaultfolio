"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { FormState } from "../transactions/actions";
import { deleteSavings, reopenSavings, withdrawSavings } from "./actions";

const linkBtn =
  "inline-flex min-h-11 items-center rounded-lg px-2 text-[13px] font-semibold text-brand hover:bg-chip hover:text-brand-ink disabled:opacity-50";

export function CardActions({
  id,
  withdrawn,
  today,
  earlyValue,
  wallets,
  edit,
}: {
  id: string;
  withdrawn: boolean;
  today: string;
  earlyValue: string;
  wallets: { id: string; name: string }[];
  edit: React.ReactNode;
}) {
  const [pending, start] = useTransition();
  const [closing, setClosing] = useState(false);
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [walletId, setWalletId] = useState("");

  const run = (fn: () => Promise<FormState>) =>
    start(async () => {
      const res = await fn();
      if (res.error) toast.error(res.error);
      else {
        toast.success(res.message);
        setClosing(false);
      }
    });

  if (closing) {
    return (
      <div className="flex flex-col gap-2 rounded-[10px] bg-well p-3 text-[13px]">
        <span className="text-subtle">
          Rút trước hạn hôm nay nhận khoảng {earlyValue} (lãi không kỳ hạn).
        </span>
        <label className="flex items-center gap-2 font-semibold text-ink-2">
          Ngày tất toán
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value)}
            className="min-h-11 rounded-lg border border-field bg-surface px-2 text-base sm:text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 font-semibold text-ink-2">
          Số tiền thực nhận (gốc + lãi)
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="Để trống = tính theo lãi suất sổ"
            className="min-h-11 rounded-lg border border-field bg-surface px-2 text-base font-normal num sm:text-sm"
          />
        </label>
        {wallets.length > 0 && (
          <label className="flex flex-col gap-1 font-semibold text-ink-2">
            Nhận về ví
            <select
              value={walletId}
              onChange={(e) => setWalletId(e.target.value)}
              className="min-h-11 rounded-lg border border-field bg-surface px-2 text-base font-normal sm:text-sm"
            >
              <option value="">Không ghi vào ví</option>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex gap-1">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(() => withdrawSavings(id, date, amount, walletId))
            }
            className={linkBtn}
          >
            Xác nhận tất toán
          </button>
          <button
            type="button"
            onClick={() => setClosing(false)}
            className={linkBtn}
          >
            Huỷ
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="-mx-2 -mb-2 flex flex-wrap gap-1">
      {edit}
      {withdrawn ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => reopenSavings(id))}
          className={linkBtn}
        >
          Mở lại
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setClosing(true)}
          className={linkBtn}
        >
          Tất toán
        </button>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          confirm("Xoá sổ tiết kiệm này?") && run(() => deleteSavings(id))
        }
        className={`${linkBtn} text-err-ink hover:text-err-ink`}
      >
        Xoá
      </button>
    </div>
  );
}
