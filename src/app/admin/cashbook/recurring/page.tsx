import type { Metadata } from "next";
import { Card, CardTitle, PageHeader, Pill } from "@/components/vf/ui";
import { formatDate, formatInt, todayVN } from "@/lib/format";
import { cn } from "@/lib/utils";
import { loadQuickEntry } from "@/server/cashbook";
import {
  loadRules,
  waitingRules,
  type RecurringRule,
} from "@/server/recurring";
import { requireUser } from "@/server/session";
import { CashbookTabs } from "../tabs";
import {
  PendingRun,
  RuleActions,
  RuleDialog,
  type RuleOptions,
} from "./rule-controls";

export const metadata: Metadata = { title: "Ghi chép định kỳ" };

const WEEKDAY = [
  "",
  "Thứ Hai",
  "Thứ Ba",
  "Thứ Tư",
  "Thứ Năm",
  "Thứ Sáu",
  "Thứ Bảy",
  "Chủ Nhật",
];

function schedule(r: RecurringRule): string {
  if (r.freq === "weekly") return `${WEEKDAY[r.day]} hằng tuần`;
  if (r.freq === "monthly") return `Ngày ${r.day} hằng tháng`;
  return `Hằng năm, ngày ${formatDate(r.nextRunOn).slice(0, 5)}`;
}

export default async function RecurringPage() {
  const user = await requireUser();
  const today = todayVN();
  const [rules, data] = await Promise.all([
    loadRules(user.id),
    loadQuickEntry(user.id),
  ]);
  const byId = new Map(data.categories.map((c) => [c.id, c]));
  const options: RuleOptions = {
    wallets: data.wallets.map((w) => ({ id: w.id, name: w.name })),
    categories: data.categories.map((c) => ({
      id: c.id,
      kind: c.kind,
      name: c.parentId ? `${byId.get(c.parentId)?.name} › ${c.name}` : c.name,
    })),
  };
  const walletName = new Map(data.wallets.map((w) => [w.id, w.name]));
  const titleOf = (r: RecurringRule) =>
    r.template.note ||
    byId.get(r.template.categoryId)?.name ||
    "Hạng mục đã ẩn";
  const waiting = waitingRules(rules, today);

  const broken = (r: RecurringRule) =>
    !walletName.has(r.template.walletId) || !byId.has(r.template.categoryId);

  return (
    <>
      <PageHeader
        title="Thu chi"
        description="Tiền nhà, điện nước, lương… lặp lại theo lịch"
        actions={
          data.wallets.length > 0 && (
            <RuleDialog
              options={options}
              today={today}
              trigger="Thêm định kỳ"
            />
          )
        }
      />
      <CashbookTabs active="/admin/cashbook/recurring" />

      {waiting.length > 0 && (
        <Card className="flex flex-col gap-2">
          <CardTitle>Chờ xác nhận</CardTitle>
          {waiting.map(({ rule, count }) => (
            <div
              key={`${rule.id}-${rule.nextRunOn}`}
              className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft py-2.5"
            >
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold">{titleOf(rule)}</span>
                <span className="text-[13px] text-subtle">
                  {formatDate(rule.nextRunOn)} ·{" "}
                  {rule.template.type === "income" ? "Thu" : "Chi"}
                  {count > 1 && ` · còn ${count} kỳ`}
                </span>
                {broken(rule) && (
                  <span className="text-[13px] text-loss">
                    Ví hoặc hạng mục không còn dùng, hãy sửa lại trước
                  </span>
                )}
              </span>
              <PendingRun
                id={rule.id}
                date={rule.nextRunOn}
                amount={formatInt(BigInt(rule.template.amount))}
                label={titleOf(rule)}
              />
            </div>
          ))}
        </Card>
      )}

      {rules.length === 0 ? (
        <Card className="text-sm text-subtle">
          {data.wallets.length === 0
            ? "Hãy thêm ví trước."
            : "Chưa có ghi chép định kỳ. Thêm ở đây, hoặc bấm vào một dòng trong Sổ ghi chép rồi chọn Lặp lại."}
        </Card>
      ) : (
        <section
          aria-label="Danh sách định kỳ"
          className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-4"
        >
          {rules.map((r) => {
            const c = byId.get(r.template.categoryId);
            const income = r.template.type === "income";
            return (
              <article
                key={r.id}
                className={cn(
                  "flex flex-col gap-2 rounded-card border border-line bg-surface p-[22px]",
                  !r.active && "opacity-70",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="m-0 min-w-0 truncate text-base font-semibold">
                    <span aria-hidden="true">{c?.icon}</span> {titleOf(r)}
                  </h2>
                  {!r.active ? (
                    <Pill>Tạm dừng</Pill>
                  ) : (
                    <Pill tone={r.autoPost ? "brand" : "idle"}>
                      {r.autoPost ? "Tự ghi" : "Chờ xác nhận"}
                    </Pill>
                  )}
                </div>
                <span
                  className={cn(
                    "text-xl font-bold num",
                    income ? "text-gain" : "text-loss",
                  )}
                >
                  {income ? "▲ +" : "▼ −"}
                  {formatInt(BigInt(r.template.amount))}
                </span>
                <span className="text-[13px] text-subtle">
                  {schedule(r)} · {c?.name ?? "hạng mục đã ẩn"} ·{" "}
                  {walletName.get(r.template.walletId) ?? "ví đã lưu trữ"}
                </span>
                {r.active && (
                  <span className="text-[13px] text-subtle">
                    Lần tới {formatDate(r.nextRunOn)}
                  </span>
                )}
                <div className="-mx-2 -mb-2 flex flex-wrap gap-1">
                  <RuleDialog
                    options={options}
                    today={today}
                    trigger="Sửa"
                    initial={{
                      id: r.id,
                      type: r.template.type,
                      amount: formatInt(BigInt(r.template.amount)),
                      walletId: r.template.walletId,
                      categoryId: r.template.categoryId,
                      note: r.template.note,
                      freq: r.freq,
                      day: r.day,
                      startOn: r.nextRunOn,
                      autoPost: r.autoPost,
                    }}
                  />
                  <RuleActions id={r.id} active={r.active} />
                </div>
              </article>
            );
          })}
        </section>
      )}
    </>
  );
}
