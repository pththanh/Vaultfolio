"use client";

import { useState } from "react";
import { Field, inputClass, selectClass } from "@/components/vf/form";
import { Modal, linkBtn } from "@/components/vf/modal";
import { useQuickEntry } from "@/components/vf/quick-entry";
import { buttonClass } from "@/components/vf/ui";
import { useFormAction } from "@/components/vf/use-form-action";
import { useRun } from "@/components/vf/use-run";
import { WALLET_LABEL } from "@/lib/labels";
import type { WalletType } from "@/lib/calc/cashbook/types";
import {
  adjustBalanceAction,
  archiveWalletAction,
  deleteWalletAction,
  saveWalletAction,
} from "../actions";

export interface WalletInitial {
  id: string;
  name: string;
  type: WalletType;
  /** Owed amount for cards. */
  openingBalance: string;
  openingDate: string;
  creditLimit: string;
  statementDay: string;
  dueDay: string;
  includeInNetWorth: boolean;
}

export function WalletDialog({
  initial,
  today,
}: {
  initial?: WalletInitial;
  today: string;
}) {
  return (
    <Modal
      title={initial ? "Sửa ví" : "Thêm ví"}
      description="Số dư hiện tại luôn được tính từ số dư đầu và các ghi chép."
      trigger={initial ? "Sửa" : "Thêm ví"}
      triggerClassName={initial ? linkBtn : buttonClass("primary")}
    >
      {(close) => <WalletForm initial={initial} today={today} onDone={close} />}
    </Modal>
  );
}

function WalletForm({
  initial,
  today,
  onDone,
}: {
  initial?: WalletInitial;
  today: string;
  onDone: () => void;
}) {
  const [, action, pending] = useFormAction(saveWalletAction, onDone);
  const [type, setType] = useState<WalletType>(initial?.type ?? "cash");
  const isCard = type === "credit_card";
  return (
    <form action={action} className="grid grid-cols-2 gap-3">
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <Field label="Tên ví" className="col-span-2">
        <input
          name="name"
          required
          maxLength={80}
          defaultValue={initial?.name}
          placeholder="VD: Tiền mặt, Vietcombank"
          className={inputClass}
        />
      </Field>
      <Field label="Loại" className="col-span-2">
        <select
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value as WalletType)}
          className={selectClass}
        >
          {Object.entries(WALLET_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      <Field label={isCard ? "Dư nợ ban đầu (₫)" : "Số dư ban đầu (₫)"}>
        <input
          name="openingBalance"
          inputMode="numeric"
          defaultValue={initial?.openingBalance ?? "0"}
          className={`${inputClass} num`}
        />
      </Field>
      <Field label="Tính từ ngày">
        <input
          type="date"
          name="openingDate"
          required
          max={today}
          defaultValue={initial?.openingDate ?? today}
          className={inputClass}
        />
      </Field>
      {isCard && (
        <>
          <Field label="Hạn mức (₫)" className="col-span-2">
            <input
              name="creditLimit"
              inputMode="decimal"
              defaultValue={initial?.creditLimit}
              placeholder="50tr"
              className={`${inputClass} num`}
            />
          </Field>
          <Field label="Ngày sao kê">
            <input
              type="number"
              name="statementDay"
              min={1}
              max={31}
              defaultValue={initial?.statementDay}
              className={inputClass}
            />
          </Field>
          <Field label="Ngày đến hạn">
            <input
              type="number"
              name="dueDay"
              min={1}
              max={31}
              defaultValue={initial?.dueDay}
              className={inputClass}
            />
          </Field>
        </>
      )}
      <label className="col-span-2 flex min-h-11 items-center gap-2.5 text-sm text-ink-2">
        <input
          type="checkbox"
          name="includeInNetWorth"
          defaultChecked={initial?.includeInNetWorth ?? true}
          className="size-5 accent-brand"
        />
        Tính vào tài sản ròng
      </label>
      <button
        type="submit"
        disabled={pending}
        className={buttonClass("primary", "col-span-2")}
      >
        {pending ? "Đang lưu…" : "Lưu ví"}
      </button>
    </form>
  );
}

export function WalletActions({
  id,
  name,
  isCard,
  archived,
  used,
  today,
  edit,
}: {
  id: string;
  name: string;
  isCard: boolean;
  archived: boolean;
  used: boolean;
  today: string;
  edit: WalletInitial;
}) {
  const [run, pending] = useRun();
  const quick = useQuickEntry();
  return (
    <div className="-mx-2 -mb-2 flex flex-wrap gap-1">
      {!archived && (
        <>
          <button
            type="button"
            className={linkBtn}
            onClick={() =>
              quick({
                initial: {
                  type: "transfer",
                  amount: "",
                  occurredOn: today,
                  note: "",
                  // Cards are usually the target: paying the bill.
                  ...(isCard
                    ? { to: `wallet:${id}` }
                    : { from: `wallet:${id}` }),
                },
              })
            }
          >
            {isCard ? "Trả nợ thẻ" : "Chuyển tiền"}
          </button>
          <Modal
            title={`Điều chỉnh số dư · ${name}`}
            description="Nhập số thực tế, hệ thống ghi một dòng chênh lệch (không tính vào thu chi)."
            trigger="Điều chỉnh"
            triggerClassName={linkBtn}
          >
            {(close) => (
              <AdjustForm
                id={id}
                isCard={isCard}
                today={today}
                onDone={close}
              />
            )}
          </Modal>
          <WalletDialog initial={edit} today={today} />
        </>
      )}
      <button
        type="button"
        disabled={pending}
        className={linkBtn}
        onClick={() => run(() => archiveWalletAction(id, !archived))}
      >
        {archived ? "Mở lại" : "Lưu trữ"}
      </button>
      {!used && (
        <button
          type="button"
          disabled={pending}
          className={`${linkBtn} text-err-ink hover:text-err-ink`}
          onClick={() =>
            confirm(`Xoá ví "${name}"?`) && run(() => deleteWalletAction(id))
          }
        >
          Xoá
        </button>
      )}
    </div>
  );
}

function AdjustForm({
  id,
  isCard,
  today,
  onDone,
}: {
  id: string;
  isCard: boolean;
  today: string;
  onDone: () => void;
}) {
  const [, action, pending] = useFormAction(adjustBalanceAction, onDone);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="walletId" value={id} />
      {isCard && <input type="hidden" name="isCard" value="1" />}
      <Field label={isCard ? "Dư nợ thực tế (₫)" : "Số dư thực tế (₫)"}>
        <input
          name="actual"
          required
          inputMode="numeric"
          className={`${inputClass} num`}
        />
      </Field>
      <Field label="Ngày">
        <input
          type="date"
          name="occurredOn"
          required
          max={today}
          defaultValue={today}
          className={inputClass}
        />
      </Field>
      <Field label="Ghi chú">
        <input name="note" maxLength={500} className={inputClass} />
      </Field>
      <button
        type="submit"
        disabled={pending}
        className={buttonClass("primary")}
      >
        {pending ? "Đang lưu…" : "Điều chỉnh"}
      </button>
    </form>
  );
}
