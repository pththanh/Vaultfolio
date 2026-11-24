"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatShortVnd, formatVnd } from "@/lib/format";

export interface FlowPoint {
  month: string;
  income: number;
  expense: number;
  net: number;
}

const LABEL = { income: "Thu", expense: "Chi", net: "Chênh lệch" } as const;

export function FlowChart({ points }: { points: FlowPoint[] }) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
        <h2 className="m-0 text-base font-semibold">Thu chi 12 tháng</h2>
        <div className="flex flex-wrap gap-4 text-[13px] text-ink-2">
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-[3px] bg-gain"
            />
            Thu
          </span>
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-[3px] bg-loss"
            />
            Chi
          </span>
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden="true"
              className="w-[18px] border-t-2 border-ink"
            />
            Chênh lệch
          </span>
        </div>
      </div>
      <div
        role="img"
        aria-label={`Thu, chi và chênh lệch theo tháng từ ${points[0]?.month} đến ${points.at(-1)?.month}`}
        className="h-[280px] w-full"
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={points}
            barGap={2}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid stroke="#ECEDEA" vertical={false} />
            <XAxis
              dataKey="month"
              tickFormatter={(v: string) => `${v.slice(5)}/${v.slice(2, 4)}`}
              tick={{ fill: "#5B6270", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              minTickGap={12}
            />
            <YAxis
              tickFormatter={(v: number) =>
                v === 0 ? "0" : formatShortVnd(BigInt(Math.round(v)))
              }
              tick={{ fill: "#5B6270", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={64}
            />
            <ReferenceLine y={0} stroke="#8A909B" />
            <Tooltip
              cursor={{ fill: "#16181D", fillOpacity: 0.05 }}
              formatter={(v, name) => [
                formatVnd(Number(v)),
                LABEL[name as keyof typeof LABEL],
              ]}
              labelFormatter={(l) => {
                const [y, m] = String(l).split("-");
                return `Tháng ${Number(m)}/${y}`;
              }}
              contentStyle={{
                borderRadius: 8,
                borderColor: "#E3E5E0",
                fontSize: 13,
              }}
            />
            <Bar
              dataKey="income"
              fill="#0B7A47"
              maxBarSize={16}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
            <Bar
              dataKey="expense"
              fill="#C0352B"
              maxBarSize={16}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
            <Line
              type="linear"
              dataKey="net"
              stroke="#16181D"
              strokeWidth={2}
              dot={{ r: 3, fill: "#16181D", stroke: "#FFFFFF" }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
