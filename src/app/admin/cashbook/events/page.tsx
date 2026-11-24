import type { Metadata } from "next";
import { Card, PageHeader, Pill } from "@/components/vf/ui";
import { eventTotals } from "@/lib/calc/cashbook/events";
import { topExpenses } from "@/lib/calc/cashbook/report";
import { formatDate, formatInt, formatPct, formatVnd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { describeEntry, entryNames } from "@/server/activity";
import { loadCategories, loadEvents } from "@/server/cashbook";
import { loadPortfolio } from "@/server/portfolio";
import { requireUser } from "@/server/session";
import { CashbookTabs } from "../tabs";
import { DeleteEventButton, EventDialog } from "./event-controls";

export const metadata: Metadata = { title: "Sự kiện" };

export default async function EventsPage() {
  const user = await requireUser();
  const [events, p, categories] = await Promise.all([
    loadEvents(user.id),
    loadPortfolio(user.id),
    loadCategories(user.id),
  ]);
  const names = entryNames(p, categories);

  return (
    <>
      <PageHeader
        title="Thu chi"
        description="Tổng chi theo chuyến đi, sự kiện so với ngân sách"
        actions={<EventDialog />}
      />
      <CashbookTabs active="/admin/cashbook/events" />
      {events.length === 0 && (
        <Card className="text-sm text-subtle">
          Chưa có sự kiện nào. Sau khi thêm, chọn sự kiện khi ghi chép.
        </Card>
      )}
      <section
        aria-label="Danh sách sự kiện"
        className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] gap-4"
      >
        {events.map((ev) => {
          const mine = p.cashRows.entries.filter((e) => e.eventId === ev.id);
          const t = eventTotals(mine, ev.budget);
          const over = t.remaining !== null && t.remaining < 0n;
          const pct = Math.floor((t.ratio ?? 0) * 100);
          return (
            <Card key={ev.id} className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <h2 className="m-0 truncate text-[17px] font-bold">
                    {ev.name}
                  </h2>
                  <span className="text-[13px] text-subtle">
                    {[ev.startOn, ev.endOn]
                      .flatMap((d) => (d ? [formatDate(d)] : []))
                      .join(" – ") || "Chưa đặt ngày"}
                  </span>
                </div>
                {over && <Pill tone="err">Vượt ngân sách</Pill>}
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-2xl font-bold num">
                  {formatVnd(t.expense)}
                </span>
                <span className="text-[13px] text-subtle num">
                  {t.remaining === null
                    ? "Chưa đặt ngân sách"
                    : `${formatPct(t.ratio, { digits: 0 })} của ${formatVnd(ev.budget!)} · ${over ? "vượt" : "còn"} ${formatVnd(over ? -t.remaining : t.remaining)}`}
                  {t.income > 0n && ` · thu ${formatVnd(t.income)}`}
                </span>
              </div>
              {t.ratio !== null && (
                <div
                  role="progressbar"
                  aria-label={`Đã dùng ngân sách ${ev.name}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.min(pct, 100)}
                  className="h-2 overflow-hidden rounded bg-[#EEF0EC]"
                >
                  <div
                    className={cn("h-full", over ? "bg-loss" : "bg-brand")}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
              )}
              {mine.length > 0 && (
                <details>
                  <summary className="flex min-h-11 cursor-pointer items-center text-[13px] font-semibold text-ink-2">
                    {mine.length} ghi chép
                  </summary>
                  {topExpenses(mine, mine.length).map((e) => {
                    const d = describeEntry(e, names);
                    return (
                      <div
                        key={e.id}
                        className="flex justify-between gap-3 border-t border-line-soft py-2 text-[13px]"
                      >
                        <span className="min-w-0 truncate">
                          {d.icon} {d.title}
                          <span className="text-subtle">
                            {" "}
                            · {formatDate(e.occurredOn)}
                          </span>
                        </span>
                        <span className="flex-none font-semibold num">
                          {formatVnd(e.amount)}
                        </span>
                      </div>
                    );
                  })}
                </details>
              )}
              <div className="-mx-2 -mb-2 flex gap-1">
                <EventDialog
                  initial={{
                    id: ev.id,
                    name: ev.name,
                    startOn: ev.startOn ?? "",
                    endOn: ev.endOn ?? "",
                    budget: ev.budget === null ? "" : formatInt(ev.budget),
                  }}
                />
                <DeleteEventButton id={ev.id} name={ev.name} />
              </div>
            </Card>
          );
        })}
      </section>
    </>
  );
}
