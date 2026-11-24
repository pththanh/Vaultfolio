"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Segmented } from "@/components/vf/segmented";
import { useFormAction } from "@/components/vf/use-form-action";
import {
  Field,
  inputClass,
  selectClass,
  textareaClass,
} from "@/components/vf/form";
import { buttonClass } from "@/components/vf/ui";
import { mulQty, parseViMoney, parseViNumber } from "@/lib/calc/decimal";
import { tradeCharges, type FeeConfig } from "@/lib/calc/fees";
import type { TxType } from "@/lib/calc/types";
import { formatSignedVnd, formatVnd } from "@/lib/format";
import { deleteTransaction, saveTransaction } from "./actions";

export type FormClass = "stock" | "crypto" | "gold" | "savings";

export interface TxInitial {
  id: string;
  cls: Exclude<FormClass, "savings">;
  type: TxType;
  accountId: string;
  asset: string;
  quantity: string;
  price: string;
  fee: string;
  tax: string;
  tradeDate: string;
  note: string;
}

interface Props {
  accounts: { id: string; name: string; type: string }[];
  symbols: Record<Exclude<FormClass, "savings">, string[]>;
  fees: FeeConfig;
  today: string;
  defaultCls: FormClass;
  initial?: TxInitial;
}

const CLASSES: { value: FormClass; label: string }[] = [
  { value: "stock", label: "Cổ phiếu" },
  { value: "crypto", label: "Crypto" },
  { value: "gold", label: "Vàng" },
  { value: "savings", label: "Tiết kiệm" },
];

const TYPES: Record<
  Exclude<FormClass, "savings">,
  { value: TxType; label: string }[]
> = {
  stock: [
    { value: "buy", label: "Mua" },
    { value: "sell", label: "Bán" },
    { value: "dividend_cash", label: "Cổ tức tiền mặt" },
    { value: "dividend_stock", label: "Cổ tức cổ phiếu" },
    { value: "bonus_share", label: "Cổ phiếu thưởng" },
    { value: "fee", label: "Phí khác" },
  ],
  crypto: [
    { value: "buy", label: "Mua" },
    { value: "sell", label: "Bán" },
    { value: "fee", label: "Phí khác" },
  ],
  gold: [
    { value: "buy", label: "Mua" },
    { value: "sell", label: "Bán" },
  ],
};

const ACCOUNT_TYPES: Record<FormClass, string[]> = {
  stock: ["broker"],
  crypto: ["exchange", "wallet"],
  gold: ["physical"],
  savings: ["bank"],
};

const COPY: Record<
  FormClass,
  {
    asset: string;
    assetPh: string;
    qty: string;
    qtyPh: string;
    price: string;
    pricePh: string;
    hint: string;
  }
> = {
  stock: {
    asset: "Mã cổ phiếu",
    assetPh: "VD: FPT",
    qty: "Số lượng (CP)",
    qtyPh: "1.000",
    price: "Giá khớp (₫)",
    pricePh: "112.300",
    hint: "Phí môi giới và thuế bán được tính tự động theo cấu hình; bạn có thể sửa tay.",
  },
  crypto: {
    asset: "Coin",
    assetPh: "VD: BTC",
    qty: "Số lượng",
    qtyPh: "0,01",
    price: "Giá (₫)",
    pricePh: "2.400.000.000",
    hint: "Nhập giá đã quy đổi sang VND. Số thập phân dùng dấu phẩy (0,25).",
  },
  gold: {
    asset: "Loại vàng & tiệm",
    assetPh: "VD: Miếng SJC · DOJI",
    qty: "Số lượng (chỉ)",
    qtyPh: "10",
    price: "Giá mỗi chỉ (₫)",
    pricePh: "14.650.000",
    hint: "1 lượng = 10 chỉ = 37,5 g. Giá trị danh mục tính theo giá mua vào của tiệm.",
  },
  savings: {
    asset: "Tên sổ",
    assetPh: "VD: Sổ 12 tháng",
    qty: "Số tiền gốc (₫)",
    qtyPh: "300.000.000",
    price: "Lãi suất (%/năm)",
    pricePh: "5,2",
    hint: "Sổ tiết kiệm chi tiết (kỳ hạn, cách trả lãi, tái tục) quản lý ở trang Tiết kiệm.",
  },
};

function tryParse<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

export function TxForm({
  accounts,
  symbols,
  fees,
  today,
  defaultCls,
  initial,
}: Props) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const [cls, setCls] = useState<FormClass>(initial?.cls ?? defaultCls);
  const [type, setType] = useState<TxType>(initial?.type ?? "buy");
  const [accountId, setAccountId] = useState(initial?.accountId ?? "");
  const [qty, setQty] = useState(initial?.quantity ?? "");
  const [price, setPrice] = useState(initial?.price ?? "");
  const [fee, setFee] = useState(initial?.fee ?? "");
  const [tax, setTax] = useState(initial?.tax ?? "");
  const clearAmounts = () => {
    setQty("");
    setPrice("");
    setFee("");
    setTax("");
  };
  const [, action, pending] = useFormAction(saveTransaction, () => {
    if (initial) router.push("/admin/transactions");
    else {
      formRef.current?.reset();
      clearAmounts();
    }
  });
  const [deleting, startDelete] = useTransition();

  const copy = COPY[cls];
  const editing = !!initial;
  const accountOptions = useMemo(() => {
    const matching = accounts.filter((a) =>
      ACCOUNT_TYPES[cls].includes(a.type),
    );
    return matching.length ? matching : accounts;
  }, [accounts, cls]);
  const effectiveAccount =
    accountId &&
    (accountOptions.some((a) => a.id === accountId) || accountId === "__new")
      ? accountId
      : (accountOptions[0]?.id ?? "__new");

  const isSavings = cls === "savings";
  const showQty = isSavings || type !== "fee";
  const showPrice =
    isSavings || type === "buy" || type === "sell" || type === "dividend_cash";
  const showTax =
    !isSavings &&
    cls === "stock" &&
    (type === "sell" || type === "dividend_cash");
  const qtyLabel =
    type === "dividend_cash"
      ? "Số CP hưởng"
      : type === "dividend_stock" || type === "bonus_share"
        ? "Số CP nhận thêm"
        : copy.qty;
  const priceLabel =
    type === "dividend_cash" && !isSavings ? "Cổ tức mỗi CP (₫)" : copy.price;

  // Live preview of the cash flow with suggested fee/tax.
  let preview: string = copy.hint;
  if (!isSavings && type !== "fee") {
    const q = tryParse(() => parseViNumber(qty));
    const p = showPrice ? tryParse(() => parseViMoney(price)) : 0n;
    if (q && q > 0n && p !== null) {
      const gross = mulQty(q, p);
      const auto = tradeCharges(cls, type, gross, fees);
      const f = fee
        ? (tryParse(() => parseViMoney(fee)) ?? auto.fee)
        : auto.fee;
      const t = tax
        ? (tryParse(() => parseViMoney(tax)) ?? auto.tax)
        : showTax
          ? auto.tax
          : 0n;
      const cash =
        type === "buy"
          ? -(gross + f + t)
          : type === "sell" || type === "dividend_cash"
            ? gross - f - t
            : -f;
      if (showPrice) {
        preview = `Thành tiền ${formatVnd(gross)} · phí ${formatVnd(f)}${showTax ? ` · thuế ${formatVnd(t)}` : ""} · dòng tiền ${formatSignedVnd(cash)}`;
      }
    }
  }

  function onDelete() {
    if (!initial || !confirm("Xoá giao dịch này? Danh mục sẽ được tính lại."))
      return;
    startDelete(async () => {
      const res = await deleteTransaction(initial.id);
      if (res.error) toast.error(res.error);
      else {
        toast.success(res.message);
        router.push("/admin/transactions");
      }
    });
  }

  return (
    <section
      aria-labelledby="tx-form-title"
      className="flex min-w-0 flex-[1_1_320px] flex-col gap-4 rounded-card border border-line bg-surface p-[22px]"
    >
      <h2 id="tx-form-title" className="m-0 text-base font-semibold">
        {editing ? "Sửa giao dịch" : "Thêm giao dịch"}
      </h2>
      {!editing && (
        <Segmented
          label="Loại tài sản"
          options={CLASSES}
          value={cls}
          onChange={(v) => {
            setCls(v);
            setType("buy");
          }}
          className="grid grid-cols-4"
          buttonClassName="min-h-10 min-w-0 px-1"
        />
      )}

      <form
        ref={formRef}
        action={action}
        className="flex flex-col gap-4"
        key={initial?.id ?? cls}
      >
        <input type="hidden" name="cls" value={cls} />
        {initial && <input type="hidden" name="id" value={initial.id} />}
        <div className="grid grid-cols-2 gap-3">
          {isSavings ? (
            <Field label="Kỳ hạn">
              <select
                name="termMonths"
                defaultValue="12"
                className={selectClass}
              >
                {[1, 3, 6, 9, 12, 18, 24, 36].map((m) => (
                  <option key={m} value={m}>
                    {m} tháng
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="Loại giao dịch">
              <select
                name="type"
                value={type}
                onChange={(e) => setType(e.target.value as TxType)}
                className={selectClass}
              >
                {TYPES[cls].map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label={isSavings ? "Ngân hàng" : "Tài khoản"}>
            <select
              name="accountId"
              value={effectiveAccount}
              onChange={(e) => setAccountId(e.target.value)}
              className={selectClass}
            >
              {accountOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
              <option value="__new">+ Tài khoản mới…</option>
            </select>
          </Field>
          {effectiveAccount === "__new" && (
            <Field
              label={isSavings ? "Tên ngân hàng" : "Tên tài khoản mới"}
              className="col-span-2"
            >
              <input
                name="newAccount"
                required
                placeholder={isSavings ? "VD: ACB" : "VD: SSI"}
                className={inputClass}
              />
            </Field>
          )}
          <Field label={copy.asset} className="col-span-2">
            <input
              name="asset"
              required
              defaultValue={initial?.asset}
              placeholder={copy.assetPh}
              list={isSavings ? undefined : `symbols-${cls}`}
              autoComplete="off"
              className={inputClass}
            />
            {!isSavings && (
              <datalist id={`symbols-${cls}`}>
                {symbols[cls].map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            )}
          </Field>
          {showQty && (
            <Field
              label={qtyLabel}
              className={showPrice ? undefined : "col-span-2"}
            >
              <input
                name="quantity"
                inputMode="decimal"
                required
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder={copy.qtyPh}
                className={`${inputClass} num`}
              />
            </Field>
          )}
          {showPrice && (
            <Field label={priceLabel}>
              <input
                name="price"
                inputMode="decimal"
                required
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder={type === "dividend_cash" ? "1.000" : copy.pricePh}
                className={`${inputClass} num`}
              />
            </Field>
          )}
          {isSavings ? (
            <>
              <Field label="Trả lãi">
                <select
                  name="interestType"
                  defaultValue="end_of_term"
                  className={selectClass}
                >
                  <option value="end_of_term">Cuối kỳ</option>
                  <option value="monthly">Hằng tháng</option>
                </select>
              </Field>
              <Field label="Khi đáo hạn">
                <select
                  name="rollover"
                  defaultValue="principal_interest"
                  className={selectClass}
                >
                  <option value="principal_interest">Tái tục gốc + lãi</option>
                  <option value="principal">Tái tục gốc</option>
                  <option value="none">Rút về tài khoản</option>
                </select>
              </Field>
            </>
          ) : (
            <Field label="Phí (₫)">
              <input
                name="fee"
                inputMode="numeric"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                placeholder="Tự tính theo cấu hình"
                className={`${inputClass} num`}
              />
            </Field>
          )}
          {showTax && (
            <Field label="Thuế (₫)">
              <input
                name="tax"
                inputMode="numeric"
                value={tax}
                onChange={(e) => setTax(e.target.value)}
                placeholder="Tự tính"
                className={`${inputClass} num`}
              />
            </Field>
          )}
          <Field label={isSavings ? "Ngày gửi" : "Ngày giao dịch"}>
            <input
              type="date"
              name="tradeDate"
              required
              max={isSavings ? undefined : today}
              defaultValue={initial?.tradeDate ?? today}
              className={inputClass}
            />
          </Field>
          <Field label="Ghi chú" className="col-span-2">
            <textarea
              name="note"
              rows={2}
              defaultValue={initial?.note}
              placeholder="Không bắt buộc"
              className={textareaClass}
            />
          </Field>
        </div>

        <div
          aria-live="polite"
          className="flex flex-col gap-1.5 rounded-[10px] bg-well px-4 py-3.5 text-[13px] text-subtle"
        >
          <span className="num">{preview}</span>
        </div>

        <div className="flex flex-wrap gap-2.5">
          <button
            type="submit"
            disabled={pending}
            className={buttonClass("primary", "flex-auto")}
          >
            {pending
              ? "Đang lưu…"
              : isSavings
                ? "Lưu sổ tiết kiệm"
                : "Lưu giao dịch"}
          </button>
          {editing ? (
            <>
              <button
                type="button"
                onClick={onDelete}
                disabled={deleting}
                className={buttonClass("danger")}
              >
                Xoá
              </button>
              <button
                type="button"
                onClick={() => router.push("/admin/transactions")}
                className={buttonClass("outline")}
              >
                Huỷ
              </button>
            </>
          ) : (
            <button
              type="reset"
              onClick={clearAmounts}
              className={buttonClass("outline")}
            >
              Huỷ
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
