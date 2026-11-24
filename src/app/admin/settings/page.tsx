import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { signOut } from "@/auth";
import { Card, CardTitle, PageHeader, buttonClass } from "@/components/vf/ui";
import { db } from "@/db";
import { users } from "@/db/schema";
import type { FeeConfig } from "@/lib/calc/fees";
import { getDefaultWalletId, loadCategories } from "@/server/cashbook";
import { formatInt, todayVN } from "@/lib/format";
import { loadPortfolio } from "@/server/portfolio";
import { loadFeeSchedules } from "@/server/funds";
import { requireUser } from "@/server/session";
import {
  AccountCashRow,
  CategoryManager,
  DefaultWalletForm,
} from "./cashbook-settings";
import {
  AccountRow,
  FeesForm,
  FundFeesForm,
  InstrumentRow,
  PasswordForm,
  TwoFactor,
} from "./settings-forms";

export const metadata: Metadata = { title: "Cài đặt" };

const bpsToPct = (bps: number) => (bps / 100).toString().replace(".", ",");

export default async function SettingsPage() {
  const user = await requireUser();
  const [row, p, categories, defaultWalletId] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, user.id),
      columns: { totpEnabled: true },
    }),
    loadPortfolio(user.id),
    loadCategories(user.id),
    getDefaultWalletId(user.id),
  ]);
  const feeValues = Object.fromEntries(
    Object.entries(p.fees).map(([k, v]) => [
      k,
      k === "fundTaxFreeMonths" ? String(v) : bpsToPct(v as number),
    ]),
  ) as Record<keyof FeeConfig, string>;
  const instrumentList = [...p.instruments.values()].sort((a, b) =>
    a.assetClass === b.assetClass
      ? a.symbol.localeCompare(b.symbol, "vi")
      : a.assetClass.localeCompare(b.assetClass),
  );

  const funds = instrumentList.filter((i) => i.assetClass === "fund");
  const schedules = await loadFeeSchedules(funds.map((f) => f.id));
  const latestTiers = (id: string, side: "buy" | "sell") => {
    const own = schedules.filter(
      (s) => s.instrumentId === id && s.side === side,
    );
    const from = own.at(-1)?.effectiveFrom ?? "";
    return {
      effectiveFrom: from,
      tiers: own
        .filter((s) => s.effectiveFrom === from)
        .map((s) => ({
          fromMonths: String(s.fromMonths),
          op: s.fromInclusive ? ("gte" as const) : ("gt" as const),
          fee: bpsToPct(s.feeBps),
        })),
    };
  };

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <>
      <PageHeader
        title="Cài đặt"
        description={`Đăng nhập: ${user.email}`}
        actions={
          <form action={logout}>
            <button type="submit" className={buttonClass("outline")}>
              Đăng xuất
            </button>
          </form>
        }
      />

      <Card className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <CardTitle>Xác thực 2 bước (TOTP)</CardTitle>
          <TwoFactor enabled={!!row?.totpEnabled} />
        </div>
        <div className="flex flex-col gap-3 border-t border-line-soft pt-5">
          <CardTitle>Đổi mật khẩu</CardTitle>
          <p className="m-0 text-[13px] text-subtle">
            Đổi mật khẩu hoặc bật/tắt 2FA sẽ đăng xuất mọi phiên đăng nhập.
          </p>
          <PasswordForm />
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>Phí &amp; thuế</CardTitle>
          <span className="text-[13px] text-subtle">
            Dùng để gợi ý phí/thuế khi thêm giao dịch. Giao dịch đã lưu giữ
            nguyên số tiền đã nhập.
          </span>
        </div>
        <FeesForm values={feeValues} />
      </Card>

      {funds.length > 0 && (
        <Card className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <CardTitle>Biểu phí quỹ mở</CardTitle>
            <span className="text-[13px] text-subtle">
              Phí theo số tháng nắm giữ, tính từ ngày khớp. Đổi ngày hiệu lực để
              thêm biểu phí mới và giữ biểu phí cũ.
            </span>
          </div>
          {funds.flatMap((f) =>
            (["sell", "buy"] as const).map((side) => {
              const cur = latestTiers(f.id, side);
              return (
                <FundFeesForm
                  key={`${f.id}:${side}:${JSON.stringify(cur)}`}
                  instrumentId={f.id}
                  symbol={f.symbol}
                  side={side}
                  effectiveFrom={cur.effectiveFrom || todayVN()}
                  initial={cur.tiers}
                />
              );
            }),
          )}
        </Card>
      )}

      <Card className="flex flex-col gap-3">
        <CardTitle>Tài khoản &amp; nơi lưu giữ</CardTitle>
        <div className="flex flex-col gap-3">
          {p.accounts.map((a) => (
            <AccountRow
              key={a.id}
              account={{ id: a.id, name: a.name, type: a.type }}
            />
          ))}
          <AccountRow key={`new-${p.accounts.length}`} />
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>Tiền trong tài khoản đầu tư</CardTitle>
          <span className="text-[13px] text-subtle">
            Từ ngày đã chọn, tiền chưa đầu tư được tính từ số dư đầu, các khoản
            nạp/rút từ ví và mọi giao dịch mua, bán, cổ tức. Để trống ngày nếu
            không theo dõi.
          </span>
        </div>
        <div className="flex flex-col gap-3">
          {p.accounts
            .filter((a) => a.type !== "bank")
            .map((a) => (
              <AccountCashRow
                key={a.id}
                today={todayVN()}
                account={{
                  id: a.id,
                  name: a.name,
                  cashFrom: a.cashFrom ?? "",
                  cashOpening:
                    a.cashOpening === null ? "" : formatInt(a.cashOpening),
                }}
              />
            ))}
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <CardTitle>Thu chi</CardTitle>
          <span className="text-[13px] text-subtle">
            Ví mặc định và hạng mục thu chi. Hạng mục đã dùng thì ẩn hoặc gộp,
            không xoá.
          </span>
        </div>
        <DefaultWalletForm
          wallets={p.cashRows.wallets
            .filter((w) => !w.archivedAt)
            .map((w) => ({ id: w.id, name: w.name }))}
          value={defaultWalletId ?? ""}
        />
        <CategoryManager
          categories={categories.map((c) => ({
            id: c.id,
            kind: c.kind,
            parentId: c.parentId,
            name: c.name,
            icon: c.icon ?? "",
            color: c.color ?? "",
            isSystem: c.isSystem,
            archived: c.archivedAt !== null,
          }))}
        />
      </Card>

      <Card className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>Mã tài sản</CardTitle>
          <span className="text-[13px] text-subtle">
            Mã nguồn giá dùng cho job tự động (giai đoạn P2): DNSE symbol,
            CoinGecko id, mã vàng + tiệm.
          </span>
        </div>
        <div className="flex flex-col gap-3">
          {instrumentList.length === 0 && (
            <p className="m-0 text-sm text-subtle">Chưa có mã nào.</p>
          )}
          {instrumentList.map((i) => (
            <InstrumentRow key={i.id} instrument={i} />
          ))}
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <CardTitle>Sao lưu</CardTitle>
        <p className="m-0 text-sm text-ink-2">
          Xuất toàn bộ giao dịch ra CSV (có thể import lại). Cơ sở dữ liệu nên
          bật backup tự động ở nhà cung cấp (Neon: point-in-time restore).
        </p>
        <div>
          <a
            href="/admin/transactions/export"
            download
            className={buttonClass("outline")}
          >
            Tải CSV giao dịch
          </a>
        </div>
      </Card>
    </>
  );
}
