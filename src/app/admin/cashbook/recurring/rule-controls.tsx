"use client";

import { useState } from "react";
import { Field, inputClass, selectClass } from "@/components/vf/form";
import { Modal, linkBtn } from "@/components/vf/modal";
import { buttonClass } from "@/components/vf/ui";
import { useFormAction } from "@/components/vf/use-form-action";
import { useRun } from "@/components/vf/use-run";
import type { RecurringFreq } from "@/lib/calc/cashbook/types";
import {
  deleteRuleAction,
  resolveRunAction,
  saveRuleAction,
  toggleRuleAction,
} from "../actions";

export interface RuleOptions {
  wallets: { id: string; name: string }[];
  categories: { id: string; name: string; kind: "expense" | "income" }[];
}

export interface RuleInitial {
  id?: string;
  type: "expense" | "income";
  amount: string;
  walletId: string;
  categoryId: string;
  note: string;
  freq: RecurringFreq;
  day: number;
  startOn: string;
  autoPost: boolean;
}

export function RuleDialog({
  initial,
  options,
  today,
  trigger,
  triggerClassName,
}: {
  initial?: RuleInitial;
  options: RuleOptions;
  today: string;
  trigger: string;
  triggerClassName?: string;
}) {
  return (
    <Modal
      title={initial?.id ? "Sửa ghi chép định kỳ" : "Thêm ghi chép định kỳ"}
      description="Ngày 29–31 ở tháng ngắn sẽ lùi về ngày cuối tháng."
      trigger={trigger}
      triggerClassName={
        triggerClassName ?? (initial?.id ? linkBtn : buttonClass("primary"))
      }
    >
      {(close) => (
        <RuleForm
          initial={initial}
          options={options}
          today={today}
          onDone={close}
        />
      )}
    </Modal>
  );
}

export function RuleForm({
  initial,
  options,
  today,
  onDone,
}: {
  initial?: RuleInitial;
  options: RuleOptions;
  today: string;
  onDone: () => void;
}) {
  const [, action, pending] = useFormAction(saveRuleAction, onDone);
  const [type, setType] = useState(initial?.type ?? "expense");
  const [freq, setFreq] = useState<RecurringFreq>(initial?.freq ?? "monthly");
  const categories = options.categories.filter((c) => c.kind === type);
  return (
    <form action={action} className="grid grid-cols-2 gap-3">
      <input type="hidden" name="id" value={initial?.id ?? ""} />
      <Field label="Loại">
        <select
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value as "expense" | "income")}
          className={selectClass}
        >
          <option value="expense">Chi</option>
          <option value="income">Thu</option>
        </select>
      </Field>
      <Field label="Số tiền">
        <input
          name="amount"
          required
          inputMode="decimal"
          autoComplete="off"
          placeholder="8tr5"
          defaultValue={initial?.amount}
          className={`${inputClass} num`}
        />
      </Field>
      <Field label="Hạng mục">
        <select
          key={type}
          name="categoryId"
          defaultValue={
            categories.some((c) => c.id === initial?.categoryId)
              ? initial!.categoryId
              : ""
          }
          required
          className={selectClass}
        >
          <option value="" disabled>
            Chọn…
          </option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Ví">
        <select
          name="walletId"
          required
          defaultValue={
            options.wallets.some((w) => w.id === initial?.walletId)
              ? initial!.walletId
              : (options.wallets[0]?.id ?? "")
          }
          className={selectClass}
        >
          {options.wallets.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Lặp lại">
        <select
          name="freq"
          value={freq}
          onChange={(e) => setFreq(e.target.value as RecurringFreq)}
          className={selectClass}
        >
          <option value="weekly">Hằng tuần</option>
          <option value="monthly">Hằng tháng</option>
          <option value="yearly">Hằng năm</option>
        </select>
      </Field>
      {freq === "monthly" ? (
        <Field label="Vào ngày">
          <input
            type="number"
            name="day"
            min={1}
            max={31}
            required
            defaultValue={initial?.day ?? Number(today.slice(8))}
            className={inputClass}
          />
        </Field>
      ) : (
        <div />
      )}
      <Field
        label={freq === "monthly" ? "Bắt đầu từ" : "Lần đầu vào ngày"}
        className="col-span-2"
      >
        <input
          type="date"
          name="startOn"
          required
          defaultValue={initial?.startOn ?? today}
          className={inputClass}
        />
      </Field>
      <Field label="Ghi chú" className="col-span-2">
        <input
          name="note"
          maxLength={500}
          defaultValue={initial?.note}
          className={inputClass}
        />
      </Field>
      <label className="col-span-2 flex min-h-11 items-center gap-2.5 text-sm text-ink-2">
        <input
          type="checkbox"
          name="autoPost"
          defaultChecked={initial?.autoPost ?? false}
          className="size-5 accent-brand"
        />
        Tự ghi khi đến ngày (không cần xác nhận)
      </label>
      <button
        type="submit"
        disabled={pending}
        className={buttonClass("primary", "col-span-2")}
      >
        {pending ? "Đang lưu…" : "Lưu"}
      </button>
    </form>
  );
}

export function RuleActions({ id, active }: { id: string; active: boolean }) {
  const [run, pending] = useRun();
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => toggleRuleAction(id, !active))}
        className={linkBtn}
      >
        {active ? "Tạm dừng" : "Tiếp tục"}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          confirm(
            "Xoá ghi chép định kỳ này? Các dòng đã ghi vẫn giữ nguyên.",
          ) && run(() => deleteRuleAction(id))
        }
        className={`${linkBtn} text-err-ink hover:text-err-ink`}
      >
        Xoá
      </button>
    </>
  );
}

/** Confirm or skip one due run. */
export function PendingRun({
  id,
  date,
  amount,
  label,
}: {
  id: string;
  date: string;
  amount: string;
  label: string;
}) {
  const [run, pending] = useRun();
  const [value, setValue] = useState(amount);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        inputMode="decimal"
        aria-label={`Số tiền ${label}`}
        className={`${inputClass} max-w-36 text-right num`}
      />
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => resolveRunAction(id, date, value))}
        className={buttonClass("primary")}
      >
        Ghi
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => resolveRunAction(id, date, null))}
        className={buttonClass("outline")}
      >
        Bỏ qua
      </button>
    </div>
  );
}
