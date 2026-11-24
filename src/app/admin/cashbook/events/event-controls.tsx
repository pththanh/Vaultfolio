"use client";

import { Field, inputClass } from "@/components/vf/form";
import { Modal, linkBtn } from "@/components/vf/modal";
import { buttonClass } from "@/components/vf/ui";
import { useFormAction } from "@/components/vf/use-form-action";
import { useRun } from "@/components/vf/use-run";
import { deleteEventAction, saveEventAction } from "../actions";

export interface EventInitial {
  id: string;
  name: string;
  startOn: string;
  endOn: string;
  budget: string;
}

export function EventDialog({ initial }: { initial?: EventInitial }) {
  return (
    <Modal
      title={initial ? "Sửa sự kiện" : "Thêm sự kiện"}
      description="Chuyến đi, đám cưới… để gom các khoản chi lại."
      trigger={initial ? "Sửa" : "Thêm sự kiện"}
      triggerClassName={initial ? linkBtn : buttonClass("primary")}
    >
      {(close) => <EventForm initial={initial} onDone={close} />}
    </Modal>
  );
}

function EventForm({
  initial,
  onDone,
}: {
  initial?: EventInitial;
  onDone: () => void;
}) {
  const [, action, pending] = useFormAction(saveEventAction, onDone);
  return (
    <form action={action} className="grid grid-cols-2 gap-3">
      <input type="hidden" name="id" value={initial?.id ?? ""} />
      <Field label="Tên" className="col-span-2">
        <input
          name="name"
          required
          maxLength={80}
          defaultValue={initial?.name}
          placeholder="VD: Đà Lạt tháng 12"
          className={inputClass}
        />
      </Field>
      <Field label="Từ ngày">
        <input
          type="date"
          name="startOn"
          defaultValue={initial?.startOn}
          className={inputClass}
        />
      </Field>
      <Field label="Đến ngày">
        <input
          type="date"
          name="endOn"
          defaultValue={initial?.endOn}
          className={inputClass}
        />
      </Field>
      <Field label="Ngân sách (không bắt buộc)" className="col-span-2">
        <input
          name="budget"
          inputMode="decimal"
          autoComplete="off"
          placeholder="5tr"
          defaultValue={initial?.budget}
          className={`${inputClass} num`}
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

export function DeleteEventButton({ id, name }: { id: string; name: string }) {
  const [run, pending] = useRun();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        confirm(`Xoá sự kiện "${name}"? Các ghi chép vẫn giữ nguyên.`) &&
        run(() => deleteEventAction(id))
      }
      className={`${linkBtn} text-err-ink hover:text-err-ink`}
    >
      Xoá
    </button>
  );
}
