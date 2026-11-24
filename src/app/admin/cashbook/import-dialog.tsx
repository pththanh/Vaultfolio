"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, selectClass } from "@/components/vf/form";
import { buttonClass } from "@/components/vf/ui";
import { formatDate, formatVnd } from "@/lib/format";
import type { ImportPreview, Unmatched } from "@/server/cashbook-import";
import { importCashAction, previewCashAction } from "./actions";

interface Option {
  id: string;
  name: string;
}

export function ImportDialog({
  wallets,
  accounts,
  categories,
}: {
  wallets: Option[];
  accounts: Option[];
  categories: (Option & { kind: "expense" | "income" })[];
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [maps, setMaps] = useState<
    Record<"wallets" | "accounts" | "categories", Record<string, string>>
  >({ wallets: {}, accounts: {}, categories: {} });
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [pending, start] = useTransition();

  const reset = () => {
    setFile(null);
    setPreview(null);
    setMaps({ wallets: {}, accounts: {}, categories: {} });
    setIncludeDuplicates(false);
  };
  const choose = (f: File) =>
    start(async () => {
      const fd = new FormData();
      fd.set("file", f);
      const res = await previewCashAction(fd);
      if ("error" in res) {
        toast.error(res.error, { duration: 8_000 });
        return;
      }
      reset();
      setFile(f);
      setPreview(res.preview);
    });
  const confirmImport = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("file", file!);
      fd.set("options", JSON.stringify({ ...maps, includeDuplicates }));
      const res = await importCashAction(fd);
      if (res.error) {
        toast.error(res.error, { duration: 8_000 });
        return;
      }
      toast.success(res.message);
      setOpen(false);
      reset();
    });

  const complete =
    preview !== null &&
    (["wallets", "accounts", "categories"] as const).every((g) =>
      preview[g].every((u) => maps[g][u.key]),
    );
  const toImport = preview
    ? preview.total - (includeDuplicates ? 0 : preview.duplicates)
    : 0;

  const mapper = (
    group: keyof typeof maps,
    title: string,
    items: Unmatched[],
    options: (u: Unmatched) => Option[],
    newLabel?: string,
  ) =>
    items.length > 0 && (
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="pb-1 text-sm font-semibold">{title}</legend>
        {newLabel && (
          <button
            type="button"
            onClick={() =>
              setMaps((m) => ({
                ...m,
                [group]: {
                  ...Object.fromEntries(items.map((u) => [u.key, "__new"])),
                  ...Object.fromEntries(
                    Object.entries(m[group]).filter(([, v]) => v),
                  ),
                },
              }))
            }
            className="min-h-11 self-start text-[13px] font-semibold text-brand"
          >
            Tạo mới cho các dòng chưa chọn
          </button>
        )}
        {items.map((u) => (
          <Field key={u.key} label={`${u.label} (${u.count} dòng)`}>
            <select
              value={maps[group][u.key] ?? ""}
              onChange={(e) =>
                setMaps((m) => ({
                  ...m,
                  [group]: { ...m[group], [u.key]: e.target.value },
                }))
              }
              className={selectClass}
            >
              <option value="">Chọn…</option>
              {newLabel && <option value="__new">{newLabel}</option>}
              {options(u).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
        ))}
      </fieldset>
    );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonClass("outline")}
      >
        Import CSV
      </button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto p-6 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              Import ghi chép
            </DialogTitle>
            <DialogDescription>
              Dùng cùng định dạng với file Export. Chưa có gì được lưu cho tới
              khi bạn xác nhận.
            </DialogDescription>
          </DialogHeader>
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="File CSV"
            disabled={pending}
            onChange={(e) => {
              const f = e.target.files?.[0];
              // Lets the same file be picked again after it was fixed.
              e.target.value = "";
              if (f) choose(f);
            }}
            className="min-h-11 text-sm"
          />
          {pending && !preview && (
            <p className="m-0 text-sm text-subtle">Đang đọc file…</p>
          )}
          {preview && (
            <div className="flex flex-col gap-4">
              <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg bg-well p-3 text-sm">
                <dt className="text-subtle">File</dt>
                <dd className="m-0 truncate text-right">{file?.name}</dd>
                <dt className="text-subtle">Số dòng đọc được</dt>
                <dd className="m-0 text-right font-semibold num">
                  {preview.total}
                </dd>
                {preview.from && (
                  <>
                    <dt className="text-subtle">Khoảng ngày</dt>
                    <dd className="m-0 text-right num">
                      {formatDate(preview.from)} – {formatDate(preview.to)}
                    </dd>
                  </>
                )}
                <dt className="text-subtle">Thu</dt>
                <dd className="m-0 text-right num">
                  {formatVnd(BigInt(preview.income))}
                </dd>
                <dt className="text-subtle">Chi</dt>
                <dd className="m-0 text-right num">
                  {formatVnd(BigInt(preview.expense))}
                </dd>
                <dt className="text-subtle">Trùng với sổ hiện có</dt>
                <dd className="m-0 text-right num">{preview.duplicates}</dd>
                {preview.skipped > 0 && (
                  <>
                    <dt className="text-subtle">Bỏ qua (tiết kiệm, vay nợ)</dt>
                    <dd className="m-0 text-right num">{preview.skipped}</dd>
                  </>
                )}
              </dl>
              {preview.errorCount > 0 ? (
                <div
                  role="alert"
                  className="rounded-lg bg-err-bg p-3 text-[13px] text-err-ink"
                >
                  <strong>{preview.errorCount} lỗi — hãy sửa file:</strong>
                  <ul className="m-0 pl-5">
                    {preview.errors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <>
                  {mapper(
                    "wallets",
                    "Ví chưa có",
                    preview.wallets,
                    () => wallets,
                    "+ Tạo ví mới",
                  )}
                  {mapper(
                    "accounts",
                    "Tài khoản đầu tư chưa có",
                    preview.accounts,
                    () => accounts,
                  )}
                  {mapper(
                    "categories",
                    "Hạng mục chưa có",
                    preview.categories,
                    (u) => categories.filter((c) => c.kind === u.kind),
                    "+ Tạo hạng mục mới",
                  )}
                  {preview.duplicates > 0 && (
                    <label className="flex min-h-11 items-center gap-2.5 text-sm text-ink-2">
                      <input
                        type="checkbox"
                        checked={includeDuplicates}
                        onChange={(e) => setIncludeDuplicates(e.target.checked)}
                        className="size-5 accent-brand"
                      />
                      Nhập cả các dòng trùng
                    </label>
                  )}
                  <button
                    type="button"
                    disabled={pending || !complete || toImport === 0}
                    onClick={confirmImport}
                    className={buttonClass("primary")}
                  >
                    {pending
                      ? "Đang nhập…"
                      : toImport === 0
                        ? "Không có dòng mới"
                        : !complete
                          ? "Chọn đủ các mục ở trên"
                          : `Nhập ${toImport} dòng`}
                  </button>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
