"use client";

import { useState } from "react";
import {
  useQuickEntry,
  type EntryInitial,
  type ExtraOptions,
} from "@/components/vf/quick-entry";
import { useRun } from "@/components/vf/use-run";
import { cn } from "@/lib/utils";
import { deleteEntryAction } from "./actions";
import { RuleDialog, type RuleOptions } from "./recurring/rule-controls";

export interface EntryRowData {
  id: string;
  icon: string;
  title: string;
  subtitle: string;
  amount: string;
  tone: "gain" | "loss" | "flat";
  excluded: boolean;
  /** null = managed elsewhere (savings link, transfer fee) or not editable. */
  initial: EntryInitial | null;
  extra: ExtraOptions;
  deletable: boolean;
  today: string;
  lockedReason: string;
}

const actionClass =
  "inline-flex min-h-11 items-center rounded-lg px-3 text-[13px] font-semibold text-brand hover:bg-chip disabled:opacity-50";

/** Repeats start after today, so today's entry is not booked twice. */
function nextDay(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function EntryRow({
  row,
  options,
}: {
  row: EntryRowData;
  options: RuleOptions;
}) {
  const [open, setOpen] = useState(false);
  const [run, pending] = useRun();
  const quick = useQuickEntry();
  return (
    <li className="border-t border-line-soft">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-14 w-full items-center gap-3 px-1 py-2 text-left hover:bg-well"
      >
        <span
          aria-hidden="true"
          className="flex size-9 flex-none items-center justify-center rounded-full bg-chip text-base"
        >
          {row.icon}
        </span>
        <span className="flex min-w-0 flex-auto flex-col gap-0.5">
          <span className="truncate text-sm font-semibold">{row.title}</span>
          <span className="truncate text-[13px] text-subtle">
            {row.subtitle}
            {row.excluded && " · ngoài báo cáo"}
          </span>
        </span>
        <span
          className={cn(
            "flex-none text-sm font-semibold num",
            row.tone === "gain" && "text-gain",
            row.tone === "loss" && "text-loss",
          )}
        >
          {row.amount}
        </span>
      </button>
      {open && (
        <div className="flex flex-wrap items-center gap-1 pb-2 pl-12">
          {row.initial && (
            <>
              <button
                type="button"
                className={actionClass}
                onClick={() =>
                  quick({ initial: row.initial!, extra: row.extra })
                }
              >
                Sửa
              </button>
              <button
                type="button"
                className={actionClass}
                onClick={() =>
                  quick({
                    initial: {
                      ...row.initial!,
                      id: undefined,
                      occurredOn: row.today,
                    },
                  })
                }
              >
                Nhân bản
              </button>
              {row.initial.type !== "transfer" && (
                <RuleDialog
                  options={options}
                  today={row.today}
                  trigger="Lặp lại"
                  triggerClassName={actionClass}
                  initial={{
                    type: row.initial.type,
                    amount: row.initial.amount,
                    walletId: row.initial.walletId!,
                    categoryId: row.initial.categoryId!,
                    note: row.initial.note,
                    freq: "monthly",
                    day: Number(row.initial.occurredOn.slice(8)),
                    startOn: nextDay(row.today),
                    autoPost: false,
                  }}
                />
              )}
            </>
          )}
          {row.deletable ? (
            <button
              type="button"
              disabled={pending}
              className={cn(actionClass, "text-err-ink")}
              onClick={() =>
                confirm("Xoá ghi chép này?") &&
                run(() => deleteEntryAction(row.id))
              }
            >
              Xoá
            </button>
          ) : (
            <span className="text-[13px] text-subtle">{row.lockedReason}</span>
          )}
        </div>
      )}
    </li>
  );
}
