"use client";

import { useState } from "react";
import { Field, inputClass, selectClass } from "@/components/vf/form";
import { Modal, linkBtn } from "@/components/vf/modal";
import { buttonClass } from "@/components/vf/ui";
import { useFormAction } from "@/components/vf/use-form-action";
import { useRun } from "@/components/vf/use-run";
import type { DebtDirection } from "@/lib/calc/cashbook/types";
import {
  deleteDebtAction,
  deletePaymentAction,
  payDebtAction,
  saveDebtAction,
} from "../actions";

interface Option {
  id: string;
  name: string;
}

export interface DebtInitial {
  id: string;
  direction: DebtDirection;
  counterparty: string;
  principal: string;
  startOn: string;
  dueOn: string;
  walletId: string;
  note: string;
}

function WalletSelect({
  wallets,
  value,
  none,
}: {
  wallets: Option[];
  value: string;
  none?: string;
}) {
  return (
    <select name="walletId" defaultValue={value} className={selectClass}>
      {none && <option value="">{none}</option>}
      {wallets.map((w) => (
        <option key={w.id} value={w.id}>
          {w.name}
        </option>
      ))}
    </select>
  );
}

export function DebtDialog({
  initial,
  wallets,
  people,
  today,
}: {
  initial?: DebtInitial;
  wallets: Option[];
  people: string[];
  today: string;
}) {
  return (
    <Modal
      title={initial ? "Sửa khoản vay nợ" : "Thêm khoản vay nợ"}
      description="Vay và cho vay không tính là thu hay chi."
      trigger={initial ? "Sửa" : "Thêm khoản vay nợ"}
      triggerClassName={initial ? linkBtn : buttonClass("primary")}
    >
      {(close) => (
        <DebtForm
          initial={initial}
          wallets={wallets}
          people={people}
          today={today}
          onDone={close}
        />
      )}
    </Modal>
  );
}

function DebtForm({
  initial,
  wallets,
  people,
  today,
  onDone,
}: {
  initial?: DebtInitial;
  wallets: Option[];
  people: string[];
  today: string;
  onDone: () => void;
}) {
  const [, action, pending] = useFormAction(saveDebtAction, onDone);
  const [direction, setDirection] = useState<DebtDirection>(
    initial?.direction ?? "lent",
  );
  return (
    <form action={action} className="grid grid-cols-2 gap-3">
      {initial && <input type="hidden" name="id" value={initial.id} />}
      {initial ? (
        <input type="hidden" name="direction" value={direction} />
      ) : (
        <Field label="Loại" className="col-span-2">
          <select
            name="direction"
            value={direction}
            onChange={(e) => setDirection(e.target.value as DebtDirection)}
            className={selectClass}
          >
            <option value="lent">Cho vay (người khác nợ tôi)</option>
            <option value="borrowed">Đi vay (tôi nợ)</option>
          </select>
        </Field>
      )}
      <Field
        label={direction === "lent" ? "Người vay" : "Vay của"}
        className="col-span-2"
      >
        <input
          name="counterparty"
          required
          maxLength={80}
          list="counterparties"
          defaultValue={initial?.counterparty}
          autoComplete="off"
          className={inputClass}
        />
        <datalist id="counterparties">
          {people.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </Field>
      <Field label="Số tiền gốc" className="col-span-2">
        <input
          name="principal"
          required
          inputMode="decimal"
          autoComplete="off"
          placeholder="10tr"
          defaultValue={initial?.principal}
          className={`${inputClass} num`}
        />
      </Field>
      <Field label="Ngày vay">
        <input
          type="date"
          name="startOn"
          required
          max={today}
          defaultValue={initial?.startOn ?? today}
          className={inputClass}
        />
      </Field>
      <Field label="Hạn trả">
        <input
          type="date"
          name="dueOn"
          defaultValue={initial?.dueOn}
          className={inputClass}
        />
      </Field>
      <Field
        label={direction === "lent" ? "Lấy tiền từ ví" : "Nhận tiền vào ví"}
        className="col-span-2"
        hint="Khoản có từ trước khi dùng sổ: chọn Không ghi vào ví"
      >
        <WalletSelect
          wallets={wallets}
          value={initial ? initial.walletId : (wallets[0]?.id ?? "")}
          none="Không ghi vào ví"
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

export function PayDialog({
  debtId,
  direction,
  remaining,
  wallets,
  today,
}: {
  debtId: string;
  direction: DebtDirection;
  remaining: string;
  wallets: Option[];
  today: string;
}) {
  const lent = direction === "lent";
  return (
    <Modal
      title={lent ? "Thu nợ" : "Trả nợ"}
      description={`Còn lại ${remaining} ₫. Lãi ghi riêng, tính là ${lent ? "thu" : "chi"}.`}
      trigger={lent ? "Thu nợ" : "Trả nợ"}
      triggerClassName={linkBtn}
    >
      {(close) => (
        <PayForm
          debtId={debtId}
          remaining={remaining}
          wallets={wallets}
          today={today}
          onDone={close}
        />
      )}
    </Modal>
  );
}

function PayForm({
  debtId,
  remaining,
  wallets,
  today,
  onDone,
}: {
  debtId: string;
  remaining: string;
  wallets: Option[];
  today: string;
  onDone: () => void;
}) {
  const [, action, pending] = useFormAction(payDebtAction, onDone);
  return (
    <form action={action} className="grid grid-cols-2 gap-3">
      <input type="hidden" name="debtId" value={debtId} />
      <Field label="Tiền gốc">
        <input
          name="amount"
          required
          inputMode="decimal"
          autoComplete="off"
          defaultValue={remaining}
          className={`${inputClass} num`}
        />
      </Field>
      <Field label="Tiền lãi (nếu có)">
        <input
          name="interest"
          inputMode="decimal"
          autoComplete="off"
          className={`${inputClass} num`}
        />
      </Field>
      <Field label="Ví">
        <WalletSelect wallets={wallets} value={wallets[0]?.id ?? ""} />
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
      <Field label="Ghi chú" className="col-span-2">
        <input name="note" maxLength={500} className={inputClass} />
      </Field>
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

export function DeleteDebtButton({ id, name }: { id: string; name: string }) {
  const [run, pending] = useRun();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        confirm(
          `Xoá khoản với "${name}" cùng mọi dòng vay, trả và lãi của nó trong sổ ghi chép?`,
        ) && run(() => deleteDebtAction(id))
      }
      className={`${linkBtn} text-err-ink hover:text-err-ink`}
    >
      Xoá
    </button>
  );
}

export function DeletePaymentButton({ id }: { id: string }) {
  const [run, pending] = useRun();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label="Xoá khoản trả này"
      onClick={() =>
        confirm("Xoá khoản trả này (kể cả lãi đi kèm)?") &&
        run(() => deletePaymentAction(id))
      }
      className={`${linkBtn} text-err-ink hover:text-err-ink`}
    >
      Xoá
    </button>
  );
}
