"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Field, inputClass, selectClass } from "@/components/vf/form";
import { Pill, buttonClass } from "@/components/vf/ui";
import { useFormAction } from "@/components/vf/use-form-action";
import type { FormState } from "../transactions/actions";
import {
  changePassword,
  confirmTotp,
  deleteAccount,
  disableTotp,
  saveAccount,
  saveFees,
  saveInstrument,
  startTotpSetup,
} from "./actions";

function useToastState(
  fn: (prev: FormState, fd: FormData) => Promise<FormState>,
  onOk?: () => void,
) {
  const [, action, pending] = useFormAction(fn, onOk);
  return [action, pending] as const;
}

const codeInput = `${inputClass} num max-w-40 tracking-[0.3em]`;

export function TwoFactor({ enabled }: { enabled: boolean }) {
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(
    null,
  );
  const [starting, start] = useTransition();
  const [confirmAction, confirming] = useToastState(confirmTotp, () =>
    setSetup(null),
  );
  const [disableAction, disabling] = useToastState(disableTotp);

  if (enabled) {
    return (
      <div className="flex flex-col gap-3">
        <p className="m-0 flex items-center gap-2 text-sm">
          <Pill tone="ok">Đang bật</Pill> Đăng nhập cần mã 6 số từ ứng dụng xác
          thực.
        </p>
        <form
          action={disableAction}
          className="flex flex-wrap items-end gap-2.5"
        >
          <Field label="Nhập mã hiện tại để tắt">
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              className={codeInput}
            />
          </Field>
          <button
            type="submit"
            disabled={disabling}
            className={buttonClass("danger")}
          >
            Tắt 2FA
          </button>
        </form>
      </div>
    );
  }

  if (setup) {
    return (
      <div className="flex flex-col gap-3">
        <p className="m-0 text-sm text-ink-2">
          Quét mã QR bằng Google Authenticator, 1Password, Authy… rồi nhập mã 6
          số để xác nhận. Sau đó bạn sẽ được đăng xuất để đăng nhập lại bằng mã
          2FA.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={setup.qr}
            alt="Mã QR thiết lập xác thực 2 bước"
            width={160}
            height={160}
            className="rounded-lg border border-line"
          />
          <div className="flex min-w-0 flex-col gap-1 text-[13px] text-subtle">
            <span>Không quét được? Nhập khoá thủ công:</span>
            <code className="rounded bg-chip px-2 py-1 font-mono text-xs break-all text-ink">
              {setup.secret}
            </code>
          </div>
        </div>
        <form
          action={confirmAction}
          className="flex flex-wrap items-end gap-2.5"
        >
          <Field label="Mã xác thực">
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              autoFocus
              className={codeInput}
            />
          </Field>
          <button
            type="submit"
            disabled={confirming}
            className={buttonClass("primary")}
          >
            Xác nhận & bật
          </button>
          <button
            type="button"
            onClick={() => setSetup(null)}
            className={buttonClass("outline")}
          >
            Huỷ
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 flex items-center gap-2 text-sm">
        <Pill tone="warn">Chưa bật</Pill> Nên bật để bảo vệ dữ liệu tài sản.
      </p>
      <div>
        <button
          type="button"
          disabled={starting}
          onClick={() =>
            start(async () => {
              const res = await startTotpSetup();
              if ("error" in res) toast.error(res.error);
              else setSetup(res);
            })
          }
          className={buttonClass("primary")}
        >
          Bật xác thực 2 bước
        </button>
      </div>
    </div>
  );
}

export function PasswordForm() {
  const [action, pending] = useToastState(changePassword);
  return (
    <form
      action={action}
      className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] items-end gap-3"
    >
      <Field label="Mật khẩu hiện tại">
        <input
          type="password"
          name="current"
          autoComplete="current-password"
          required
          className={inputClass}
        />
      </Field>
      <Field label="Mật khẩu mới">
        <input
          type="password"
          name="next"
          autoComplete="new-password"
          minLength={10}
          required
          className={inputClass}
        />
      </Field>
      <Field label="Nhập lại">
        <input
          type="password"
          name="confirm"
          autoComplete="new-password"
          required
          className={inputClass}
        />
      </Field>
      <button
        type="submit"
        disabled={pending}
        className={buttonClass("outline")}
      >
        Đổi mật khẩu
      </button>
    </form>
  );
}

const FEE_FIELDS: { name: string; label: string; hint: string }[] = [
  {
    name: "stockFeeBps",
    label: "Phí môi giới cổ phiếu (%)",
    hint: "Áp dụng cho mua và bán",
  },
  {
    name: "sellTaxBps",
    label: "Thuế bán cổ phiếu (%)",
    hint: "Thuế TNCN trên giá trị bán",
  },
  {
    name: "dividendTaxBps",
    label: "Thuế cổ tức tiền mặt (%)",
    hint: "Khấu trừ tại nguồn",
  },
  { name: "cryptoFeeBps", label: "Phí giao dịch crypto (%)", hint: "Phí sàn" },
  {
    name: "goldFeeBps",
    label: "Phí giao dịch vàng (%)",
    hint: "Thường bằng 0",
  },
  {
    name: "demandRateBps",
    label: "Lãi không kỳ hạn (%/năm)",
    hint: "Dùng khi rút tiết kiệm trước hạn",
  },
];

export function FeesForm({ values }: { values: Record<string, string> }) {
  const [action, pending] = useToastState(saveFees);
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
        {FEE_FIELDS.map((f) => (
          <Field key={f.name} label={f.label} hint={f.hint}>
            <input
              name={f.name}
              inputMode="decimal"
              defaultValue={values[f.name]}
              required
              className={`${inputClass} num`}
            />
          </Field>
        ))}
      </div>
      <div>
        <button
          type="submit"
          disabled={pending}
          className={buttonClass("primary")}
        >
          Lưu cấu hình
        </button>
      </div>
    </form>
  );
}

const ACCOUNT_TYPES = [
  ["broker", "Công ty chứng khoán"],
  ["exchange", "Sàn crypto"],
  ["wallet", "Ví crypto"],
  ["bank", "Ngân hàng"],
  ["physical", "Tiệm vàng / cất giữ"],
] as const;

export function AccountRow({
  account,
}: {
  account?: { id: string; name: string; type: string };
}) {
  const [action, pending] = useToastState(saveAccount);
  const [deleting, startDelete] = useTransition();
  return (
    <form
      action={action}
      className="flex flex-wrap items-end gap-2.5 border-t border-line-soft pt-3 first:border-t-0 first:pt-0"
    >
      {account && <input type="hidden" name="id" value={account.id} />}
      <Field
        label={account ? "Tên" : "Tài khoản mới"}
        className="flex-[2_1_180px]"
      >
        <input
          name="name"
          required
          defaultValue={account?.name}
          placeholder="VD: SSI"
          className={inputClass}
        />
      </Field>
      <Field label="Loại" className="flex-[1_1_160px]">
        <select
          name="type"
          defaultValue={account?.type ?? "broker"}
          className={selectClass}
        >
          {ACCOUNT_TYPES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      <button
        type="submit"
        disabled={pending}
        className={buttonClass(account ? "outline" : "primary")}
      >
        {account ? "Lưu" : "Thêm"}
      </button>
      {account && (
        <button
          type="button"
          disabled={deleting}
          onClick={() =>
            confirm(`Xoá tài khoản "${account.name}"?`) &&
            startDelete(async () => {
              const res = await deleteAccount(account.id);
              if (res.error) toast.error(res.error);
              else toast.success(res.message);
            })
          }
          className={buttonClass("danger")}
        >
          Xoá
        </button>
      )}
    </form>
  );
}

export function InstrumentRow({
  instrument,
}: {
  instrument: {
    id: string;
    assetClass: string;
    symbol: string;
    name: string;
    exchange: string | null;
    unit: string;
    providerRef: string | null;
  };
}) {
  const [action, pending] = useToastState(saveInstrument);
  const refHint =
    instrument.assetClass === "crypto"
      ? "CoinGecko id (VD: bitcoin)"
      : instrument.assetClass === "gold"
        ? "Mã vàng@tiệm (VD: SJC_BAR@DOJI)"
        : "Mã trên DNSE";
  return (
    <form
      action={action}
      className="flex flex-wrap items-end gap-2.5 border-t border-line-soft pt-3 first:border-t-0 first:pt-0"
    >
      <input type="hidden" name="id" value={instrument.id} />
      <div className="flex min-h-11 flex-[0_0_140px] flex-col justify-center">
        <span className="font-bold">{instrument.symbol}</span>
        <span className="text-xs text-subtle">{instrument.assetClass}</span>
      </div>
      <Field label="Tên" className="flex-[2_1_180px]">
        <input
          name="name"
          required
          defaultValue={instrument.name}
          className={inputClass}
        />
      </Field>
      {instrument.assetClass === "stock" && (
        <Field label="Sàn" className="flex-[0_1_100px]">
          <input
            name="exchange"
            defaultValue={instrument.exchange ?? ""}
            placeholder="HOSE"
            className={inputClass}
          />
        </Field>
      )}
      {instrument.assetClass === "gold" ? (
        <Field label="Hiển thị theo" className="flex-[0_1_120px]">
          <select
            name="unit"
            defaultValue={instrument.unit}
            className={selectClass}
          >
            <option value="luong">Lượng</option>
            <option value="chi">Chỉ</option>
          </select>
        </Field>
      ) : (
        <input type="hidden" name="unit" value={instrument.unit} />
      )}
      <Field label="Mã nguồn giá" hint={refHint} className="flex-[1_1_180px]">
        <input
          name="providerRef"
          defaultValue={instrument.providerRef ?? ""}
          className={inputClass}
        />
      </Field>
      <button
        type="submit"
        disabled={pending}
        className={buttonClass("outline", "mb-5")}
      >
        Lưu
      </button>
    </form>
  );
}
