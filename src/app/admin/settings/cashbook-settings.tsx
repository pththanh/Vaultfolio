"use client";

import { useState } from "react";
import { Field, inputClass, selectClass } from "@/components/vf/form";
import { buttonClass } from "@/components/vf/ui";
import { useFormAction } from "@/components/vf/use-form-action";
import { useRun } from "@/components/vf/use-run";
import { cn } from "@/lib/utils";
import {
  archiveCategoryAction,
  mergeCategoryAction,
  moveCategoryAction,
  saveCategoryAction,
  setAccountCashAction,
  setDefaultWalletAction,
} from "../cashbook/actions";

export function DefaultWalletForm({
  wallets,
  value,
}: {
  wallets: { id: string; name: string }[];
  value: string;
}) {
  const [, action, pending] = useFormAction(setDefaultWalletAction);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2.5">
      <Field label="Ví mặc định khi ghi chép" className="flex-[1_1_220px]">
        <select name="walletId" defaultValue={value} className={selectClass}>
          <option value="">Ví dùng lần trước</option>
          {wallets.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </Field>
      <button
        type="submit"
        disabled={pending}
        className={buttonClass("outline")}
      >
        Lưu
      </button>
    </form>
  );
}

export function AccountCashRow({
  account,
  today,
}: {
  account: { id: string; name: string; cashFrom: string; cashOpening: string };
  today: string;
}) {
  const [, action, pending] = useFormAction(setAccountCashAction);
  return (
    <form
      action={action}
      className="flex flex-wrap items-end gap-2.5 border-t border-line-soft pt-3 first:border-t-0 first:pt-0"
    >
      <input type="hidden" name="accountId" value={account.id} />
      <span className="flex min-h-11 flex-[1_1_140px] items-center font-semibold">
        {account.name}
      </span>
      <Field label="Theo dõi từ ngày" className="flex-[1_1_160px]">
        <input
          type="date"
          name="cashFrom"
          max={today}
          defaultValue={account.cashFrom}
          className={inputClass}
        />
      </Field>
      <Field label="Tiền đầu ngày đó (₫)" className="flex-[1_1_160px]">
        <input
          name="cashOpening"
          inputMode="numeric"
          defaultValue={account.cashOpening}
          className={`${inputClass} num`}
        />
      </Field>
      <button
        type="submit"
        disabled={pending}
        className={buttonClass("outline")}
      >
        Lưu
      </button>
    </form>
  );
}

export interface CategoryNode {
  id: string;
  kind: "expense" | "income";
  parentId: string | null;
  name: string;
  icon: string;
  color: string;
  isSystem: boolean;
  archived: boolean;
}

const small =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 text-[13px] font-semibold text-brand hover:bg-chip disabled:opacity-40";

export function CategoryManager({
  categories,
}: {
  categories: CategoryNode[];
}) {
  const tops = (kind: CategoryNode["kind"]) =>
    categories.filter((c) => c.kind === kind && !c.parentId);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {(["expense", "income"] as const).map((kind) => (
        <section key={kind} className="flex min-w-0 flex-col gap-1">
          <h3 className="m-0 text-sm font-semibold">
            {kind === "expense" ? "Hạng mục chi" : "Hạng mục thu"}
          </h3>
          {tops(kind).map((parent) => {
            const children = categories.filter((c) => c.parentId === parent.id);
            return (
              <details
                key={parent.id}
                className="border-t border-line-soft first-of-type:border-t-0"
              >
                <summary
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-semibold",
                    parent.archived && "text-faint line-through",
                  )}
                >
                  <span aria-hidden="true">{parent.icon || "•"}</span>
                  {parent.name}
                  <span className="text-xs font-normal text-subtle">
                    {children.length || ""}
                  </span>
                </summary>
                <div className="flex flex-col gap-2 pb-3 pl-4">
                  <CategoryRow category={parent} all={categories} />
                  {children.map((c) => (
                    <CategoryRow key={c.id} category={c} all={categories} />
                  ))}
                  <NewCategory
                    kind={kind}
                    parentId={parent.id}
                    key={`new-${children.length}`}
                  />
                </div>
              </details>
            );
          })}
          <NewCategory kind={kind} key={`new-${tops(kind).length}`} />
        </section>
      ))}
    </div>
  );
}

function CategoryRow({
  category: c,
  all,
}: {
  category: CategoryNode;
  all: CategoryNode[];
}) {
  const [, action, saving] = useFormAction(saveCategoryAction);
  const [run, pending] = useRun();
  const [merging, setMerging] = useState(false);
  const [target, setTarget] = useState("");
  const targets = all.filter(
    (t) =>
      t.kind === c.kind && !t.archived && t.id !== c.id && t.parentId !== c.id,
  );
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-well p-2">
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="id" value={c.id} />
        <input type="hidden" name="kind" value={c.kind} />
        <input
          name="icon"
          defaultValue={c.icon}
          maxLength={8}
          aria-label={`Biểu tượng của ${c.name}`}
          className={cn(inputClass, "w-14 text-center")}
        />
        <input
          name="name"
          required
          defaultValue={c.name}
          readOnly={c.isSystem}
          aria-label="Tên hạng mục"
          className={cn(inputClass, "min-w-0 flex-1")}
        />
        {c.parentId ? (
          <input type="hidden" name="color" value={c.color} />
        ) : (
          <input
            type="color"
            name="color"
            defaultValue={c.color || "#5B6270"}
            aria-label={`Màu của ${c.name}`}
            className="size-11 rounded-lg border border-field bg-surface p-1"
          />
        )}
        <button type="submit" disabled={saving} className={small}>
          Lưu
        </button>
      </form>
      <div className="flex flex-wrap gap-1">
        {c.isSystem && (
          <span className="flex min-h-11 items-center px-2 text-xs text-subtle">
            Hạng mục hệ thống
          </span>
        )}
        {!c.archived && (
          <>
            <button
              type="button"
              disabled={pending}
              aria-label={`Đưa ${c.name} lên`}
              onClick={() => run(() => moveCategoryAction(c.id, true))}
              className={small}
            >
              ↑
            </button>
            <button
              type="button"
              disabled={pending}
              aria-label={`Đưa ${c.name} xuống`}
              onClick={() => run(() => moveCategoryAction(c.id, false))}
              className={small}
            >
              ↓
            </button>
          </>
        )}
        {!c.isSystem && (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(() => archiveCategoryAction(c.id, !c.archived))
              }
              className={small}
            >
              {c.archived ? "Hiện lại" : "Ẩn"}
            </button>
            {!c.archived && (
              <button
                type="button"
                onClick={() => setMerging((m) => !m)}
                aria-expanded={merging}
                className={small}
              >
                Gộp…
              </button>
            )}
          </>
        )}
      </div>
      {merging && (
        <div className="flex flex-wrap gap-2">
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            aria-label="Chuyển ghi chép sang"
            className={cn(selectClass, "min-w-0 flex-1")}
          >
            <option value="">Chuyển ghi chép sang…</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.parentId ? "— " : ""}
                {t.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!target || pending}
            onClick={() =>
              confirm(
                `Chuyển mọi ghi chép của "${c.name}" (kể cả hạng mục con) rồi ẩn hạng mục này? Hạn mức của nó sẽ bị xoá.`,
              ) &&
              run(
                () => mergeCategoryAction(c.id, target),
                () => setMerging(false),
              )
            }
            className={buttonClass("outline")}
          >
            Gộp
          </button>
        </div>
      )}
    </div>
  );
}

function NewCategory({
  kind,
  parentId = "",
}: {
  kind: CategoryNode["kind"];
  parentId?: string;
}) {
  const [, action, pending] = useFormAction(saveCategoryAction);
  return (
    <form action={action} className="flex gap-2 pt-1">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="parentId" value={parentId} />
      <input
        name="name"
        required
        maxLength={60}
        placeholder={parentId ? "Hạng mục con mới" : "Hạng mục mới"}
        aria-label={parentId ? "Hạng mục con mới" : "Hạng mục mới"}
        className={cn(inputClass, "min-w-0 flex-1")}
      />
      <button
        type="submit"
        disabled={pending}
        className={buttonClass("outline")}
      >
        Thêm
      </button>
    </form>
  );
}
