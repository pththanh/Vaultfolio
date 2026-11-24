"use client";

import { useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Segmented } from "@/components/vf/segmented";
import { classColor, classLabel } from "@/components/vf/ui";

export interface HistoryPoint {
  date: string;
  stock: number;
  savings: number;
  gold: number;
  crypto: number;
  fund: number;
  cash: number;
  /** Negative. */
  liability: number;
  total: number;
  cost: number;
  /** VN-Index in hundredths of a point. */
  index: number | null;
}

type Range = "3T" | "1N" | "all";
const RANGES: { value: Range; label: string }[] = [
  { value: "3T", label: "3T" },
  { value: "1N", label: "1N" },
  { value: "all", label: "Tất cả" },
];
const CLASSES = ["stock", "savings", "fund", "gold", "crypto", "cash"] as const;

const nf = (d: number) =>
  new Intl.NumberFormat("vi-VN", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
function axisValue(v: number) {
  if (Math.abs(v) >= 1e9) return `${nf(2).format(v / 1e9)} tỷ`;
  if (Math.abs(v) >= 1e6) return `${nf(0).format(v / 1e6)} tr`;
  return nf(0).format(v);
}

function cutoff(range: Range, last: string): string {
  if (range === "all") return "";
  const d = new Date(`${last}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - (range === "3T" ? 3 : 12));
  return d.toISOString().slice(0, 10);
}

export function HistoryChart({ points }: { points: HistoryPoint[] }) {
  const [range, setRange] = useState<Range>("1N");
  const last = points.at(-1)?.date ?? "";
  const from = cutoff(range, last);
  const visible = points.filter((p) => p.date >= from);
  // Scale VN-Index to the portfolio value at the first point with both values.
  const base = visible.find((p) => p.total > 0 && p.index);
  const hasCash = visible.some((p) => p.cash !== 0);
  const hasDebt = visible.some((p) => p.liability !== 0);
  const classes = CLASSES.filter((c) => c !== "cash" || hasCash);
  const data = visible.map((p) => ({
    ...p,
    indexScaled: base && p.index ? (p.index / base.index!) * base.total : null,
  }));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-base font-semibold">Tài sản ròng theo loại</h2>
        <Segmented
          label="Khoảng thời gian"
          options={RANGES}
          value={range}
          onChange={setRange}
        />
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-ink-2">
        {classes.map((c) => (
          <span key={c} className="inline-flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-[3px]"
              style={{ background: classColor[c] }}
            />
            {classLabel[c]}
          </span>
        ))}
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            className="w-[18px] border-t-2 border-dashed border-faint"
          />
          VN-Index (quy đổi cùng mốc)
        </span>
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            className="w-[18px] border-t-2 border-dotted border-ink"
          />
          Giá vốn
        </span>
        {hasDebt && (
          <>
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2.5 rounded-[3px] bg-loss"
              />
              Nợ
            </span>
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden="true"
                className="w-[18px] border-t-2 border-ink"
              />
              Tài sản ròng
            </span>
          </>
        )}
      </div>
      <div
        role="img"
        aria-label={`Biểu đồ tài sản ròng theo loại tài sản từ ${data[0]?.date ?? ""} đến ${last}`}
        className="h-[320px] w-full"
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid stroke="#ECEDEA" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(v: string) => {
                const [y, m, d] = v.split("-");
                return range === "3T" ? `${d}/${m}` : `${m}/${y.slice(2)}`;
              }}
              tick={{ fill: "#5B6270", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              minTickGap={36}
            />
            <YAxis
              tickFormatter={axisValue}
              tick={{ fill: "#5B6270", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={64}
            />
            <Tooltip
              formatter={(v, name) => {
                const label =
                  name === "indexScaled"
                    ? "VN-Index (quy đổi)"
                    : name === "cost"
                      ? "Giá vốn (5 loại đầu tư)"
                      : name === "liability"
                        ? "Nợ"
                        : name === "total"
                          ? "Tài sản ròng"
                          : classLabel[name as (typeof CLASSES)[number]];
                return [`${nf(0).format(Number(v))} ₫`, label];
              }}
              labelFormatter={(label) =>
                String(label).split("-").reverse().join("/")
              }
              contentStyle={{
                borderRadius: 8,
                borderColor: "#E3E5E0",
                fontSize: 13,
              }}
            />
            {classes.map((c) => (
              <Area
                key={c}
                type="linear"
                dataKey={c}
                stackId="nw"
                stroke={classColor[c]}
                fill={classColor[c]}
                fillOpacity={0.55}
                strokeWidth={1}
                isAnimationActive={false}
                dot={false}
              />
            ))}
            {hasDebt && (
              <Area
                type="linear"
                dataKey="liability"
                stroke="#C0352B"
                fill="#C0352B"
                fillOpacity={0.4}
                strokeWidth={1}
                isAnimationActive={false}
                dot={false}
              />
            )}
            {hasDebt && (
              <Line
                type="linear"
                dataKey="total"
                stroke="#16181D"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            )}
            <Line
              type="linear"
              dataKey="cost"
              stroke="#16181D"
              strokeWidth={1.5}
              strokeDasharray="2 3"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="linear"
              dataKey="indexScaled"
              stroke="#8A909B"
              strokeWidth={2}
              strokeDasharray="6 5"
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
