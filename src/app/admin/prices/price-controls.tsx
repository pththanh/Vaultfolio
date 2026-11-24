"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, inputClass } from "@/components/vf/form";
import { buttonClass } from "@/components/vf/ui";
import { useFormAction } from "@/components/vf/use-form-action";
import { cn } from "@/lib/utils";
import type { FormState } from "../transactions/actions";
import { approvePrice, overridePrice, rerunJob } from "./actions";

function report(res: FormState) {
  if (res.error) toast.error(res.error);
  else if (res.message) toast.success(res.message);
}

export function RerunButton({ job }: { job: string }) {
  const [pending, start] = useTransition();
  const [ran, setRan] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await rerunJob(job);
          report(res);
          if (res.ok) setRan(true);
        })
      }
      className={buttonClass("outline", "w-full")}
    >
      {pending ? "Đang chạy…" : ran ? "Đã chạy xong ✓" : "Chạy lại ngay"}
    </button>
  );
}

export function ApproveButton({
  instrumentId,
  date,
  disabled,
}: {
  instrumentId: string;
  date: string;
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending || disabled}
      title={disabled ? "Giá 0 không thể áp dụng" : undefined}
      onClick={() =>
        start(async () => report(await approvePrice(instrumentId, date)))
      }
      className="min-h-10 rounded-lg border-0 bg-ink px-3 text-[13px] font-semibold text-white disabled:opacity-40"
    >
      Áp dụng
    </button>
  );
}

export function OverrideDialog({
  instrumentId,
  label,
  isGold,
  defaultDate,
  today,
  defaultPrice,
  trigger,
  primary,
}: {
  instrumentId: string;
  label: string;
  isGold: boolean;
  defaultDate: string;
  today: string;
  defaultPrice?: string;
  trigger: string;
  primary?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [, action, pending] = useFormAction(overridePrice, () =>
    setOpen(false),
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "min-h-10 rounded-lg px-3 text-[13px] font-semibold",
          primary
            ? "border-0 bg-ink text-white"
            : "border border-field bg-surface text-ink hover:bg-chip",
        )}
      >
        {trigger}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="p-6 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              Nhập giá tay · {label}
            </DialogTitle>
            <DialogDescription>
              Giá nhập tay được áp dụng ngay và ghi nguồn &quot;Nhập tay&quot;.
            </DialogDescription>
          </DialogHeader>
          <form action={action} className="grid grid-cols-2 gap-3">
            <input type="hidden" name="instrumentId" value={instrumentId} />
            <input
              type="hidden"
              name="unit"
              value={isGold ? "luong" : "unit"}
            />
            <Field label="Ngày">
              <input
                type="date"
                name="date"
                required
                max={today}
                defaultValue={defaultDate}
                className={inputClass}
              />
            </Field>
            <Field label={isGold ? "Giá mua vào (₫/lượng)" : "Giá (₫)"}>
              <input
                name="price"
                inputMode="decimal"
                required
                autoFocus
                defaultValue={defaultPrice}
                className={`${inputClass} num`}
              />
            </Field>
            <div className="col-span-2 flex gap-2.5 pt-1">
              <button
                type="submit"
                disabled={pending}
                className={buttonClass("primary", "flex-auto")}
              >
                {pending ? "Đang lưu…" : "Lưu giá"}
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
