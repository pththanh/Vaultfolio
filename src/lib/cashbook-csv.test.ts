import { describe, expect, it } from "vitest";
import {
  CASH_CSV_HEADER,
  markDuplicates,
  parseCashCsv,
  toCashCsv,
  type CashCsvRow,
} from "./cashbook-csv";

const row = (p: Partial<CashCsvRow> = {}): CashCsvRow => ({
  date: "2026-11-01",
  type: "expense",
  direction: "",
  amount: 45_000n,
  wallet: "Tiền mặt",
  toWallet: "",
  toAccount: "",
  savings: "",
  categoryParent: "Ăn uống",
  category: "Cà phê/đồ uống",
  fee: null,
  note: "",
  exclude: false,
  event: "",
  ...p,
});
const csv = (line: string) => `${CASH_CSV_HEADER.join(",")}\n${line}`;

describe("cash entries CSV", () => {
  it("round-trips every importable type and neutralises formulas", () => {
    const rows = [
      row({
        note: "=HYPERLINK(1)",
        wallet: "@ví",
        exclude: true,
        event: "Đà Lạt",
      }),
      row({
        type: "income",
        categoryParent: "",
        category: "Lương",
        note: 'a, "b"',
      }),
      row({
        type: "transfer",
        categoryParent: "",
        category: "",
        toWallet: "VCB",
        fee: 11_000n,
      }),
      row({
        type: "transfer",
        categoryParent: "",
        category: "",
        toAccount: "DNSE",
        direction: "in",
      }),
      row({
        type: "adjustment",
        categoryParent: "",
        category: "",
        direction: "out",
        exclude: true,
      }),
    ];
    const text = toCashCsv(rows);
    expect(text).toContain("'=HYPERLINK");
    const parsed = parseCashCsv(`﻿${text}`);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual(rows.map((r, i) => ({ ...r, line: i + 2 })));
  });
  it("accepts dd/mm/yyyy and formatted amounts", () => {
    const { rows, errors } = parseCashCsv(
      csv("05/11/2026,expense,,45.000,A,,,,,X,,,"),
    );
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ date: "2026-11-05", amount: 45_000n });
  });
  it("skips savings and debt rows that belong to other screens", () => {
    const r = parseCashCsv(
      csv(
        "2026-11-01,transfer,out,5,A,,,Sổ 6T,,,,,\n2026-11-01,lend,,5,A,,,,,,,,",
      ),
    );
    expect(r).toMatchObject({ rows: [], errors: [], skipped: 2 });
  });
  it.each([
    ["2026-02-31,expense,,1,A,,,,,X,,,", /Ngày/],
    ["2026-02-01,foo,,1,A,,,,,X,,,", /Loại/],
    ["2026-02-01,expense,,-5,A,,,,,X,,,", /Số tiền/],
    ["2026-02-01,expense,,1,,,,,,X,,,", /ví/],
    ["2026-02-01,expense,,1,A,,,,,,,,", /hạng mục/],
    ["2026-02-01,transfer,,1,A,B,C,,,,,,", /to_wallet/],
    ["2026-02-01,transfer,,1,A,A,,,,,,,", /khác nhau/],
    ["2026-02-01,transfer,,1,A,,DNSE,,,,,,", /direction/],
    ["2026-02-01,transfer,in,1,A,,DNSE,,,,5,,", /Phí/],
    ["2026-02-01,adjustment,,1,A,,,,,,,,", /direction/],
  ])("reports %s", (line, message) => {
    const r = parseCashCsv(csv(line));
    expect(r.rows).toEqual([]);
    expect(r.errors[0]).toMatchObject({ line: 2 });
    expect(r.errors[0].message).toMatch(message);
  });
  it("requires the header", () => {
    expect(parseCashCsv("a,b\n1,2").errors[0].message).toMatch(/Thiếu cột/);
  });
  it("marks only as many duplicates as already exist", () => {
    const rows = [row(), row(), row({ note: "x" })];
    expect(markDuplicates(rows, [row()])).toEqual([true, false, false]);
  });
});
