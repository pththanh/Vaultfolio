"use client";

import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { saveEntryAction } from "@/app/admin/cashbook/actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, inputClass, selectClass } from "@/components/vf/form";
import { Segmented } from "@/components/vf/segmented";
import { buttonClass } from "@/components/vf/ui";
import { useFormAction } from "@/components/vf/use-form-action";
import { parseAmount } from "@/lib/calc/cashbook/parse-amount";
import { formatVnd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { QuickEntryData } from "@/server/cashbook";

type Kind = "expense" | "income" | "transfer";

export interface EntryInitial {
  /** Set when editing, missing when duplicating. */
  id?: string;
  type: Kind;
  amount: string;
  occurredOn: string;
  walletId?: string;
  categoryId?: string;
  from?: string;
  to?: string;
  fee?: string;
  note: string;
  excludeFromReport?: boolean;
  eventId?: string;
}

/** Display names for wallets/categories that are archived but still used by the row being edited. */
export type ExtraOptions = {
  wallets: { id: string; name: string }[];
  category?: { id: string; name: string };
  event?: { id: string; name: string };
};

type OpenArgs = { initial?: EntryInitial; extra?: ExtraOptions };

const QuickEntryContext = createContext<(args?: OpenArgs) => void>(() => {});
export const useQuickEntry = () => useContext(QuickEntryContext);

const TABS: { value: Kind; label: string }[] = [
  { value: "expense", label: "Chi" },
  { value: "income", label: "Thu" },
  { value: "transfer", label: "Chuyển khoản" },
];

export function QuickEntryProvider({
  data,
  children,
}: {
  data: QuickEntryData;
  children: ReactNode;
}) {
  const [args, setArgs] = useState<OpenArgs | null>(null);
  const [key, setKey] = useState(0);
  const open = (next: OpenArgs = {}) => {
    setKey((k) => k + 1);
    setArgs(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "n" || e.ctrlKey || e.metaKey || e.altKey)
        return;
      const el = e.target as HTMLElement;
      if (
        el.closest("input, textarea, select, [contenteditable], [role=dialog]")
      )
        return;
      if (document.querySelector("[role=dialog]")) return;
      e.preventDefault();
      setKey((k) => k + 1);
      setArgs({});
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <QuickEntryContext value={open}>
      {children}
      <button
        type="button"
        onClick={() => open()}
        title="Phím tắt: N"
        className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 inline-flex min-h-13 items-center gap-2 rounded-full bg-brand px-5 text-[15px] font-semibold text-white shadow-[0_4px_16px_rgba(22,24,29,0.22)] hover:bg-brand-ink focus-visible:ring-3 focus-visible:ring-brand/40 sm:right-6 sm:bottom-6"
      >
        <span aria-hidden="true" className="text-xl leading-none">
          +
        </span>
        Ghi chép
      </button>
      <Dialog open={args !== null} onOpenChange={(o) => !o && setArgs(null)}>
        <DialogContent className="top-auto bottom-0 left-0 max-h-[92dvh] max-w-full translate-x-0 translate-y-0 overflow-y-auto rounded-b-none p-5 pb-0 max-sm:top-auto max-sm:bottom-[var(--vv-bottom,0px)] max-sm:max-h-[calc(var(--vv-height,100dvh)*0.94)] sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-b-xl sm:p-6 sm:pb-0">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              {args?.initial?.id ? "Sửa ghi chép" : "Ghi chép"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Nhập khoản chi, khoản thu hoặc chuyển khoản
            </DialogDescription>
          </DialogHeader>
          {args &&
            (data.wallets.length === 0 ? (
              <div className="flex flex-col gap-3 pb-5 text-sm">
                <p className="m-0">
                  Bạn chưa có ví nào. Hãy thêm ví tiền mặt hoặc tài khoản ngân
                  hàng trước.
                </p>
                <Link
                  href="/admin/cashbook/wallets"
                  onClick={() => setArgs(null)}
                  className={buttonClass("primary")}
                >
                  Thêm ví
                </Link>
              </div>
            ) : (
              <EntryForm
                key={key}
                data={data}
                initial={args.initial}
                extra={args.extra}
                onDone={() => setArgs(null)}
              />
            ))}
        </DialogContent>
      </Dialog>
    </QuickEntryContext>
  );
}

function yesterdayOf(today: string) {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function EntryForm({
  data,
  initial,
  extra,
  onDone,
}: {
  data: QuickEntryData;
  initial?: EntryInitial;
  extra?: ExtraOptions;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<Kind>(initial?.type ?? "expense");
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [date, setDate] = useState(initial?.occurredOn ?? data.today);
  const [note, setNote] = useState(initial?.note ?? "");
  const [fee, setFee] = useState(initial?.fee ?? "");
  const defaultWallet = initial?.walletId ?? data.defaultWalletId ?? "";
  const [walletId, setWalletId] = useState(defaultWallet);
  const [category, setCategory] = useState<Record<string, string>>(
    initial?.categoryId ? { [initial.type]: initial.categoryId } : {},
  );
  const [from, setFrom] = useState(initial?.from ?? `wallet:${defaultWallet}`);
  const [to, setTo] = useState(initial?.to ?? "");
  const [excluded, setExcluded] = useState(initial?.excludeFromReport ?? false);
  const [eventId, setEventId] = useState(initial?.eventId ?? "");
  const keepOpen = useRef(false);
  const amountRef = useRef<HTMLInputElement>(null);

  const [, action, pending] = useFormAction(saveEntryAction, () => {
    if (!keepOpen.current) return onDone();
    setAmount("");
    setNote("");
    setFee("");
    amountRef.current?.focus();
  });

  const parsed = amount ? parseAmount(amount) : null;
  const wallets = useMemo(
    () => [
      ...data.wallets,
      ...(extra?.wallets ?? []).filter(
        (w) => !data.wallets.some((x) => x.id === w.id),
      ),
    ],
    [data.wallets, extra],
  );
  const selected = kind === "transfer" ? "" : (category[kind] ?? "");
  const untracked = [from, to].some((end) =>
    data.accounts.some((a) => end === `account:${a.id}` && !a.tracked),
  );
  const events =
    extra?.event && !data.events.some((x) => x.id === extra.event!.id)
      ? [...data.events, extra.event]
      : data.events;
  const append = (suffix: string) => {
    setAmount((a) => a + suffix);
    amountRef.current?.focus();
  };

  const submit = (stay: boolean) => {
    keepOpen.current = stay;
    const fd = new FormData();
    const values: Record<string, string> = {
      id: initial?.id ?? "",
      type: kind,
      amount,
      occurredOn: date,
      note,
      ...(kind === "transfer"
        ? { from, to, fee: from.startsWith("wallet:") ? fee : "" }
        : { walletId, categoryId: selected, eventId }),
      ...(kind !== "transfer" && excluded ? { excludeFromReport: "on" } : {}),
    };
    for (const [k, v] of Object.entries(values)) fd.set(k, v);
    startTransition(() => action(fd));
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
      className="flex min-w-0 flex-col gap-4"
    >
      <Segmented
        label="Loại ghi chép"
        options={TABS}
        value={kind}
        onChange={setKind}
        buttonClassName="min-h-11 flex-1 px-1 whitespace-nowrap"
      />

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="qe-amount"
          className="text-[13px] font-semibold text-ink-2"
        >
          Số tiền
        </label>
        <div className="flex gap-2">
          <input
            id="qe-amount"
            ref={amountRef}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            autoFocus
            required
            placeholder="45k, 1tr2, 250.000"
            aria-describedby="qe-preview"
            className={cn(
              inputClass,
              "min-h-13 min-w-0 flex-1 text-xl font-bold num sm:text-xl",
            )}
          />
          {["k", "tr"].map((unit) => (
            <button
              key={unit}
              type="button"
              onClick={() => append(unit)}
              aria-label={unit === "k" ? "Nghìn" : "Triệu"}
              className={buttonClass("outline", "min-w-13 px-2")}
            >
              {unit}
            </button>
          ))}
        </div>
        <span
          id="qe-preview"
          aria-live="polite"
          className={cn(
            "min-h-5 text-[13px] num",
            amount && parsed === null ? "text-loss" : "text-subtle",
          )}
        >
          {amount &&
            (parsed === null
              ? "Chưa đọc được số tiền"
              : `= ${formatVnd(parsed)}`)}
        </span>
      </div>

      {kind !== "transfer" ? (
        <>
          <CategoryPicker
            key={kind}
            kind={kind}
            data={data}
            extra={extra?.category}
            value={selected}
            onChange={(id) => setCategory((c) => ({ ...c, [kind]: id }))}
          />
          <Field label="Ví">
            <select
              value={walletId}
              onChange={(e) => setWalletId(e.target.value)}
              className={selectClass}
            >
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Endpoint
              label="Từ"
              value={from}
              onChange={setFrom}
              wallets={wallets}
              data={data}
            />
            <Endpoint
              label="Đến"
              value={to}
              onChange={setTo}
              wallets={wallets}
              data={data}
            />
          </div>
          {from.startsWith("wallet:") && (
            <Field
              label="Phí chuyển khoản (không bắt buộc)"
              hint="Ghi thành khoản chi Phí ngân hàng"
            >
              <input
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                className={cn(inputClass, "num")}
              />
            </Field>
          )}
          {untracked && (
            <p className="m-0 rounded-lg bg-warn-bg px-3 py-2.5 text-[13px] text-warn-ink">
              Tài khoản này chưa theo dõi tiền mặt, nên tiền chuyển vào chỉ hiện
              lại khi bạn mua tài sản. Bật ở Cài đặt → Tiền trong tài khoản đầu
              tư.
            </p>
          )}
        </>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <Field label="Ngày" className="min-w-0 flex-1">
          <input
            type="date"
            value={date}
            max={data.today}
            required
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
          />
        </Field>
        <button
          type="button"
          onClick={() => setDate(yesterdayOf(data.today))}
          className={buttonClass("outline")}
        >
          Hôm qua
        </button>
      </div>
      <Field label="Ghi chú">
        <input
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Không bắt buộc"
          className={inputClass}
        />
      </Field>
      {kind !== "transfer" && events.length > 0 && (
        <Field label="Sự kiện">
          <select
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            className={selectClass}
          >
            <option value="">Không</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {kind !== "transfer" && (
        <label className="flex min-h-11 items-center gap-2.5 text-sm text-ink-2">
          <input
            type="checkbox"
            checked={excluded}
            onChange={(e) => setExcluded(e.target.checked)}
            className="size-5 accent-brand"
          />
          Không tính vào báo cáo
        </label>
      )}

      <div className="sticky bottom-0 -mx-5 flex gap-2.5 border-t border-line-soft bg-surface px-5 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6">
        <button
          type="submit"
          disabled={pending}
          className={buttonClass("primary", "flex-1")}
        >
          {pending ? "Đang lưu…" : "Lưu"}
        </button>
        {!initial?.id && (
          <button
            type="button"
            disabled={pending}
            onClick={() => submit(true)}
            className={buttonClass("outline", "flex-1")}
          >
            Lưu &amp; thêm tiếp
          </button>
        )}
      </div>
    </form>
  );
}

function Endpoint({
  label,
  value,
  onChange,
  wallets,
  data,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  wallets: { id: string; name: string }[];
  data: QuickEntryData;
}) {
  return (
    <Field label={label}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={selectClass}
      >
        <option value="" disabled>
          Chọn…
        </option>
        <optgroup label="Ví">
          {wallets.map((w) => (
            <option key={w.id} value={`wallet:${w.id}`}>
              {w.name}
            </option>
          ))}
        </optgroup>
        {data.accounts.length > 0 && (
          <optgroup label="Tài khoản đầu tư">
            {data.accounts.map((a) => (
              <option key={a.id} value={`account:${a.id}`}>
                {a.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </Field>
  );
}

function CategoryPicker({
  kind,
  data,
  extra,
  value,
  onChange,
}: {
  kind: "expense" | "income";
  data: QuickEntryData;
  extra?: { id: string; name: string };
  value: string;
  onChange: (id: string) => void;
}) {
  const [all, setAll] = useState(false);
  const cats = data.categories.filter((c) => c.kind === kind);
  const byId = new Map(cats.map((c) => [c.id, c]));
  const recent = data.recent[kind].flatMap((id) => byId.get(id) ?? []);
  const selected = byId.get(value);
  const chips =
    selected && !recent.includes(selected) ? [selected, ...recent] : recent;

  const chip = (c: { id: string; name: string; icon: string }) => (
    <button
      key={c.id}
      type="button"
      aria-pressed={c.id === value}
      onClick={() => onChange(c.id)}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold",
        c.id === value
          ? "border-brand bg-brand-soft text-brand-ink"
          : "border-field bg-surface text-ink-2 hover:bg-chip",
      )}
    >
      <span aria-hidden="true">{c.icon}</span>
      {c.name}
    </button>
  );

  return (
    <div role="group" aria-label="Hạng mục" className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-ink-2">Hạng mục</span>
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          aria-expanded={all}
          className="min-h-11 px-2 text-[13px] font-semibold text-brand"
        >
          {all ? "Thu gọn" : "Tất cả hạng mục"}
        </button>
      </div>
      {!all && (
        <div className="flex flex-wrap gap-2">
          {extra &&
            extra.id === value &&
            !selected &&
            chip({ ...extra, icon: "•" })}
          {chips.map(chip)}
        </div>
      )}
      {all && (
        <div className="flex max-h-72 flex-col gap-3 overflow-y-auto rounded-lg bg-well p-3">
          {cats
            .filter((c) => !c.parentId)
            .map((parent) => (
              <div key={parent.id} className="flex flex-wrap gap-2">
                {chip(parent)}
                {cats.filter((c) => c.parentId === parent.id).map(chip)}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
