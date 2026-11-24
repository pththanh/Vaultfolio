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
import { parseDecimal } from "@/lib/calc/decimal";
import { formatDate, formatQty, formatVnd } from "@/lib/format";
import type { FundImportPreview } from "@/server/fund-import";
import { importFundAction, previewFundAction } from "./actions";

export function FundImportDialog({ funds }: { funds: string[] }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<FundImportPreview | null>(null);
  const [map, setMap] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const reset = () => {
    setFile(null);
    setPreview(null);
    setMap({});
  };
  const choose = (f: File) =>
    start(async () => {
      const fd = new FormData();
      fd.set("file", f);
      const res = await previewFundAction(fd);
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
      fd.set("options", JSON.stringify({ funds: map }));
      const res = await importFundAction(fd);
      if (res.error) {
        toast.error(res.error, { duration: 8_000 });
        return;
      }
      toast.success(res.message);
      setOpen(false);
      reset();
    });

  const unknown = preview?.funds.filter((f) => !f.known) ?? [];
  const complete = unknown.every((f) => map[f.fund]);
  const toImport = preview ? preview.total - preview.duplicates : 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonClass("outline")}
      >
        Import Fmarket
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
              Import lịch sử Fmarket
            </DialogTitle>
            <DialogDescription>
              Cột: order_date, match_date, fund, type, units, nav, value, fee,
              tax, program. Chưa có gì được lưu cho tới khi bạn xác nhận.
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
                <dt className="text-subtle">Số lệnh đọc được</dt>
                <dd className="m-0 text-right font-semibold num">
                  {preview.total}
                </dd>
                {preview.from && preview.to && (
                  <>
                    <dt className="text-subtle">Ngày khớp</dt>
                    <dd className="m-0 text-right num">
                      {formatDate(preview.from)} – {formatDate(preview.to)}
                    </dd>
                  </>
                )}
                <dt className="text-subtle">Trùng với sổ hiện có</dt>
                <dd className="m-0 text-right num">{preview.duplicates}</dd>
                {preview.funds.map((f) => (
                  <div key={f.fund} className="contents">
                    <dt className="text-subtle">
                      {f.fund} · {f.buys} mua, {f.sells} bán mới
                    </dt>
                    <dd className="m-0 text-right num">
                      {formatQty(parseDecimal(f.units))} CCQ ·{" "}
                      {formatVnd(BigInt(f.value))}
                    </dd>
                  </div>
                ))}
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
                  {unknown.map((f) => (
                    <Field key={f.fund} label={`Quỹ chưa có: ${f.fund}`}>
                      <select
                        value={map[f.fund] ?? ""}
                        onChange={(e) =>
                          setMap((m) => ({ ...m, [f.fund]: e.target.value }))
                        }
                        className={selectClass}
                      >
                        <option value="">Chọn…</option>
                        <option value="__new">+ Tạo quỹ mới</option>
                        {funds.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ))}
                  <button
                    type="button"
                    disabled={pending || !complete || toImport === 0}
                    onClick={confirmImport}
                    className={buttonClass("primary")}
                  >
                    {pending
                      ? "Đang nhập…"
                      : toImport === 0
                        ? "Không có lệnh mới"
                        : !complete
                          ? "Chọn đủ các mục ở trên"
                          : `Nhập ${toImport} lệnh`}
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
