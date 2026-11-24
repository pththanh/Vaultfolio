"use client";

import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatPct, formatShortVnd, formatVnd } from "@/lib/format";

export interface Slice {
  id: string;
  name: string;
  icon: string;
  color: string;
  value: number;
  children: { id: string; name: string; value: number }[];
}

const MAX = 6;
const OTHER = "#B4B8B0";

export function CategoryDonut({ slices }: { slices: Slice[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const parent = slices.find((s) => s.id === openId);

  const top = slices.length > MAX + 1 ? slices.slice(0, MAX) : slices;
  const rest = slices.slice(top.length);
  const items = parent
    ? parent.children.map((c, i) => ({
        ...c,
        icon: "",
        color: parent.color,
        // One hue, light to dark, inside one category.
        opacity: Math.max(1 - i * 0.16, 0.25),
        drill: false,
      }))
    : [
        ...top.map((s) => ({
          ...s,
          opacity: 1,
          drill: s.children.length > 1 || s.children[0]?.id !== s.id,
        })),
        ...(rest.length
          ? [
              {
                id: "__rest",
                name: `${rest.length} hạng mục khác`,
                icon: "",
                color: OTHER,
                value: rest.reduce((sum, s) => sum + s.value, 0),
                opacity: 1,
                drill: false,
              },
            ]
          : []),
      ];
  const total = items.reduce((s, x) => s + x.value, 0);
  const open = (id: string) => {
    const item = items.find((x) => x.id === id);
    if (item?.drill) setOpenId(id);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <h2 className="m-0 text-base font-semibold">
          {parent ? `${parent.icon} ${parent.name}` : "Cơ cấu chi"}
        </h2>
        {parent && (
          <button
            type="button"
            onClick={() => setOpenId(null)}
            className="min-h-11 px-2 text-[13px] font-semibold text-brand"
          >
            ← Tất cả
          </button>
        )}
      </div>
      <div
        role="img"
        aria-label={`Cơ cấu chi: ${items.map((x) => `${x.name} ${formatPct(x.value / total, { digits: 0 })}`).join(", ")}`}
        className="relative h-[220px] w-full"
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={items}
              dataKey="value"
              nameKey="name"
              innerRadius={68}
              outerRadius={98}
              startAngle={90}
              endAngle={-270}
              stroke="#FFFFFF"
              strokeWidth={2}
              isAnimationActive={false}
              onClick={(_, i) => open(items[i].id)}
            >
              {items.map((x) => (
                <Cell
                  key={x.id}
                  fill={x.color}
                  fillOpacity={x.opacity}
                  cursor={x.drill ? "pointer" : "default"}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(v, name) => [
                `${formatVnd(Number(v))} (${formatPct(Number(v) / total, { digits: 1 })})`,
                name,
              ]}
              contentStyle={{
                borderRadius: 8,
                borderColor: "#E3E5E0",
                fontSize: 13,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs text-subtle">Tổng</span>
          <span className="text-lg font-bold num">
            {formatShortVnd(BigInt(Math.round(total)))}
          </span>
        </div>
      </div>
      <ul className="m-0 flex list-none flex-col p-0">
        {items.map((x) => {
          const row = (
            <>
              <span
                aria-hidden="true"
                className="size-2.5 flex-none rounded-[3px]"
                style={{ background: x.color, opacity: x.opacity }}
              />
              <span className="min-w-0 flex-auto truncate text-left">
                {x.icon} {x.name}
                {x.drill && <span className="text-subtle"> ›</span>}
              </span>
              <span className="text-subtle num">
                {formatPct(x.value / total, { digits: 1 })}
              </span>
              <span className="min-w-24 text-right font-semibold num">
                {formatShortVnd(BigInt(Math.round(x.value)))}
              </span>
            </>
          );
          const cls = "flex min-h-11 w-full items-center gap-2.5 text-sm";
          return (
            <li key={x.id}>
              {x.drill ? (
                <button
                  type="button"
                  onClick={() => open(x.id)}
                  className={`${cls} rounded-lg hover:bg-chip`}
                >
                  {row}
                </button>
              ) : (
                <div className={cls}>{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
