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
import type { ChartPoint, RangeKey } from "@/server/portfolio";

const RANGES: { value: RangeKey; label: string }[] = [
  { value: "1T", label: "1T" },
  { value: "3T", label: "3T" },
  { value: "1N", label: "1N" },
  { value: "all", label: "Tất cả" },
];

const nf = (digits: number) =>
  new Intl.NumberFormat("vi-VN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

function axisValue(v: number) {
  if (Math.abs(v) >= 1e9) return `${nf(2).format(v / 1e9)} tỷ`;
  if (Math.abs(v) >= 1e6) return `${nf(0).format(v / 1e6)} tr`;
  return nf(0).format(v);
}

function axisDate(iso: string, range: RangeKey) {
  const [y, m, d] = iso.split("-");
  return range === "1T" || range === "3T" ? `${d}/${m}` : `${m}/${y.slice(2)}`;
}

export function NetWorthChart({
  series,
}: {
  series: Record<RangeKey, ChartPoint[]>;
}) {
  const [range, setRange] = useState<RangeKey>("1N");
  const data = series[range];
  const first = data.find((p) => p.value > 0);
  const last = data[data.length - 1];
  const summary =
    first && last
      ? `Biểu đồ tài sản ròng, từ ${axisValue(first.value)} lên ${axisValue(last.value)} đồng`
      : "Chưa có dữ liệu";

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-base font-semibold">
          Tài sản ròng theo thời gian
        </h2>
        <Segmented
          label="Khoảng thời gian"
          options={RANGES}
          value={range}
          onChange={setRange}
        />
      </div>
      <div className="flex flex-wrap gap-5 text-[13px] text-ink-2">
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-[3px] w-[18px] rounded-sm bg-brand"
          />
          Tài sản ròng
        </span>
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            className="w-[18px] border-t-2 border-dashed border-faint"
          />
          VN-Index (quy đổi cùng mốc)
        </span>
      </div>
      <div role="img" aria-label={summary} className="h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid stroke="#ECEDEA" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(v: string) => axisDate(v, range)}
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
              domain={["auto", "auto"]}
            />
            <Tooltip
              formatter={(v, name) => [
                `${nf(0).format(Number(v))} ₫`,
                name === "value" ? "Tài sản ròng" : "VN-Index (quy đổi)",
              ]}
              labelFormatter={(label) =>
                String(label).split("-").reverse().join("/")
              }
              contentStyle={{
                borderRadius: 8,
                borderColor: "#E3E5E0",
                fontSize: 13,
              }}
            />
            <Area
              type="linear"
              dataKey="value"
              stroke="#2547B8"
              strokeWidth={2.5}
              fill="#2547B8"
              fillOpacity={0.08}
              isAnimationActive={false}
              dot={false}
              activeDot={{ r: 4.5 }}
            />
            <Line
              type="linear"
              dataKey="index"
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
