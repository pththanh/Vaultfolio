import type { Metadata } from "next";
import { PageHeader, Pill, StatCard, buttonClass } from "@/components/vf/ui";
import { earlyWithdrawalValue } from "@/lib/calc/savings";
import {
  formatDate,
  formatInt,
  formatPct,
  formatSignedVnd,
  formatVnd,
  todayVN,
} from "@/lib/format";
import {
  loadPortfolio,
  savingsSummary,
  savingsViews,
  type SavingsView,
} from "@/server/portfolio";
import { savingsSourceWallets } from "@/server/cashbook";
import { requireUser } from "@/server/session";
import { CardActions } from "./card-actions";
import { SavingsDialog, type SavingsInitial } from "./savings-dialog";

export const metadata: Metadata = { title: "Tiết kiệm" };

const PAYOUT = { end_of_term: "Cuối kỳ", monthly: "Hằng tháng" } as const;
const ROLLOVER = {
  principal_interest: "Tái tục gốc + lãi",
  principal: "Tái tục gốc",
  none: "Rút về tài khoản",
} as const;
const SOON_DAYS = 30;

const rate = (bps: number) =>
  `${formatPct(bps / 10_000, { digits: bps % 10 === 0 ? 1 : 2 })}/năm`;

export default async function SavingsPage() {
  const user = await requireUser();
  const today = todayVN();
  const p = await loadPortfolio(user.id);
  const views = savingsViews(p, today);
  const sum = savingsSummary(views);
  const banks = p.accounts
    .filter((a) => a.type === "bank")
    .map((a) => ({ id: a.id, name: a.name }));
  const sources = savingsSourceWallets(p.cashRows.entries);
  // Cards cannot fund a deposit; archived wallets stay selectable only where already used.
  const walletOptions = (keep?: string) =>
    p.cashRows.wallets
      .filter(
        (w) => w.id === keep || (!w.archivedAt && w.type !== "credit_card"),
      )
      .map((w) => ({ id: w.id, name: w.name }));
  const active = views.filter((v) => v.row.status === "active");
  const closed = views.filter((v) => v.row.status === "withdrawn");

  const initialOf = (v: SavingsView): SavingsInitial => ({
    id: v.row.id,
    accountId: v.row.accountId,
    name: v.row.name,
    principal: formatInt(v.row.principal),
    rate: (v.row.rateBps / 100).toString().replace(".", ","),
    termMonths: v.row.termMonths,
    startDate: v.row.startDate,
    interestType: v.row.interestType,
    rollover: v.row.rollover,
    note: v.row.note ?? "",
    sourceWalletId: sources.get(v.row.id) ?? "",
  });

  const card = (v: SavingsView) => {
    const { snap, row } = v;
    const withdrawn = row.status === "withdrawn";
    const soon = !withdrawn && snap.started && snap.daysToMaturity <= SOON_DAYS;
    const pct = snap.termDays
      ? Math.round((snap.daysElapsed / snap.termDays) * 100)
      : 0;
    const badge = withdrawn
      ? {
          text: `Đã tất toán ${formatDate(row.closedDate!)}`,
          tone: "idle" as const,
        }
      : !snap.started
        ? {
            text: `Bắt đầu ${formatDate(row.startDate)}`,
            tone: "idle" as const,
          }
        : snap.matured
          ? { text: "Đã đáo hạn", tone: "warn" as const }
          : soon
            ? {
                text: `Đáo hạn sau ${snap.daysToMaturity} ngày`,
                tone: "warn" as const,
              }
            : {
                text: `Còn ${snap.daysToMaturity} ngày`,
                tone: "idle" as const,
              };

    return (
      <article
        key={row.id}
        id={row.id}
        className="flex scroll-mt-6 flex-col gap-4 rounded-card border border-line bg-surface p-[22px] target:ring-2 target:ring-brand"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="m-0 text-[17px] font-bold">{row.bank}</h2>
            <span className="text-[13px] text-subtle">
              {row.name} · kỳ hạn {row.termMonths} tháng
              {snap.cyclesRolled > 0 &&
                ` · đã tái tục ${snap.cyclesRolled} lần`}
            </span>
          </div>
          <Pill tone={badge.tone}>{badge.text}</Pill>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[13px] text-subtle">Gốc + lãi tạm tính</span>
          <span className="text-2xl font-bold num">
            {formatVnd(withdrawn ? 0n : snap.principal + snap.accruedInterest)}
          </span>
          <span className="text-[13px] font-semibold text-gain num">
            {snap.accruedInterest > 0n
              ? `▲ ${formatSignedVnd(snap.accruedInterest)} lãi tạm tính`
              : "Chưa phát sinh lãi"}
          </span>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex justify-between text-[13px] text-subtle num">
            <span>Gửi {formatDate(snap.cycleStart)}</span>
            <span>Đáo hạn {formatDate(snap.maturity)}</span>
          </div>
          <div
            role="progressbar"
            aria-label="Thời gian đã gửi"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            className="h-2 overflow-hidden rounded bg-[#EEF0EC]"
          >
            <div
              className="h-2 rounded"
              style={{
                width: `${pct}%`,
                background: soon ? "#D97B1E" : "#6FA8DC",
              }}
            />
          </div>
          <span className="text-[13px] text-ink-2 num">
            {snap.daysElapsed} / {snap.termDays} ngày ({pct}%)
          </span>
        </div>
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-line-soft pt-3.5 text-[13px]">
          <div>
            <dt className="text-subtle">Tiền gốc</dt>
            <dd className="mx-0 mt-0.5 mb-0 font-semibold num">
              {formatVnd(snap.principal)}
            </dd>
          </div>
          <div>
            <dt className="text-subtle">Lãi suất</dt>
            <dd className="mx-0 mt-0.5 mb-0 font-semibold num">
              {rate(row.rateBps)}
            </dd>
          </div>
          <div>
            <dt className="text-subtle">Trả lãi</dt>
            <dd className="mx-0 mt-0.5 mb-0 font-semibold">
              {PAYOUT[row.interestType]}
            </dd>
          </div>
          <div>
            <dt className="text-subtle">Khi đáo hạn</dt>
            <dd className="mx-0 mt-0.5 mb-0 font-semibold">
              {ROLLOVER[row.rollover]}
            </dd>
          </div>
        </dl>
        <CardActions
          id={row.id}
          withdrawn={withdrawn}
          today={today}
          earlyValue={formatVnd(
            earlyWithdrawalValue(v.input, today, p.fees.demandRateBps),
          )}
          wallets={walletOptions()}
          edit={
            <SavingsDialog
              wallets={walletOptions(sources.get(row.id))}
              banks={banks}
              today={today}
              initial={initialOf(v)}
              trigger="Sửa"
              triggerClassName="inline-flex min-h-11 items-center rounded-lg px-2 text-[13px] font-semibold text-brand hover:bg-chip hover:text-brand-ink"
            />
          }
        />
      </article>
    );
  };

  return (
    <>
      <PageHeader
        title="Tiết kiệm"
        description="Lãi tạm tính được cập nhật mỗi ngày theo số ngày đã gửi"
        actions={
          <SavingsDialog
            banks={banks}
            wallets={walletOptions()}
            today={today}
            triggerClassName={buttonClass("primary")}
            trigger={
              <>
                <svg
                  aria-hidden="true"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Thêm sổ tiết kiệm
              </>
            }
          />
        }
      />

      <section
        aria-label="Tóm tắt"
        className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4"
      >
        <StatCard
          label="Tổng tiền gốc"
          value={formatVnd(sum.principal)}
          hint={`${sum.active.length} sổ đang hoạt động`}
        />
        <StatCard
          label="Lãi tạm tính đến hôm nay"
          tone={sum.accrued > 0n ? "gain" : undefined}
          value={formatSignedVnd(sum.accrued)}
          hint="Nếu rút trước hạn chỉ hưởng lãi không kỳ hạn"
        />
        <StatCard
          label="Lãi dự kiến khi đáo hạn"
          value={formatVnd(sum.atMaturity)}
          hint={`Cộng dồn cả ${sum.active.length} sổ`}
        />
        <StatCard
          label="Lãi suất bình quân"
          value={
            sum.avgRateBps === null
              ? "—"
              : `${formatPct(sum.avgRateBps / 10_000)}/năm`
          }
          hint="Gia quyền theo tiền gốc"
        />
      </section>

      {active.length === 0 ? (
        <p className="m-0 rounded-card border border-dashed border-field bg-surface p-8 text-center text-sm text-subtle">
          Chưa có sổ tiết kiệm nào đang hoạt động.
        </p>
      ) : (
        <section
          aria-label="Danh sách sổ"
          className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4"
        >
          {active.map(card)}
        </section>
      )}

      {closed.length > 0 && (
        <section aria-labelledby="closed-title" className="flex flex-col gap-3">
          <h2
            id="closed-title"
            className="m-0 text-base font-semibold text-ink-2"
          >
            Đã tất toán
          </h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4 opacity-80">
            {closed.map(card)}
          </div>
        </section>
      )}
    </>
  );
}
