import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/format";
import type { PortfolioClass } from "@/lib/calc/types";

type ButtonVariant = "primary" | "outline" | "ghost" | "danger";

/** Design buttons: 8px radius, ≥44px tall, 14px semibold. */
export function buttonClass(
  variant: ButtonVariant = "outline",
  extra?: string,
) {
  return cn(
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold no-underline transition-colors disabled:cursor-not-allowed disabled:opacity-60",
    variant === "primary" &&
      "bg-ink px-[18px] text-white hover:bg-ink/85 hover:text-white",
    variant === "outline" &&
      "border border-field bg-surface text-ink hover:bg-chip hover:text-ink",
    variant === "ghost" && "text-ink-2 hover:bg-chip hover:text-ink",
    variant === "danger" &&
      "border border-field bg-surface text-err-ink hover:bg-err-bg hover:text-err-ink",
    extra,
  );
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-card border border-line bg-surface p-[22px]",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<"h2">) {
  return (
    <h2 className={cn("m-0 text-base font-semibold", className)} {...props} />
  );
}

export function PageHeader({
  title,
  description,
  actions,
  badge,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2.5">
          <h1 className="m-0 text-[28px] font-bold tracking-[-0.01em]">
            {title}
          </h1>
          {badge}
        </div>
        {description && (
          <p className="m-0 text-sm text-subtle">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
    </header>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone,
  size = "md",
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-card border border-line bg-surface",
        size === "lg" ? "gap-2.5 px-[22px] py-5" : "gap-2 px-5 py-[18px]",
        className,
      )}
    >
      <span className="text-[13px] font-medium text-subtle">{label}</span>
      <span
        className={cn(
          "font-bold num",
          size === "lg" ? "text-[28px] tracking-[-0.01em]" : "text-2xl",
          tone === "gain" && "text-gain",
          tone === "loss" && "text-loss",
        )}
      >
        {value}
      </span>
      {hint && <span className="text-[13px] text-subtle num">{hint}</span>}
    </div>
  );
}

export type PillTone = "ok" | "warn" | "err" | "idle" | "brand" | "gain";

export function Pill({
  tone = "idle",
  className,
  ...props
}: ComponentProps<"span"> & { tone?: PillTone }) {
  return (
    <span
      className={cn(
        "inline-block rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap",
        tone === "ok" && "bg-ok-bg text-ok-ink",
        tone === "gain" && "bg-ok-bg text-ok-ink",
        tone === "warn" && "bg-warn-bg text-warn-ink",
        tone === "err" && "bg-err-bg text-err-ink",
        tone === "idle" && "bg-chip text-ink-2",
        tone === "brand" && "bg-brand-soft text-brand-ink",
        className,
      )}
      {...props}
    />
  );
}

export const toneText: Record<Tone, string> = {
  gain: "text-gain",
  loss: "text-loss",
  flat: "text-subtle",
};

/** Portfolio classes plus cash, for net worth breakdowns. */
export type AllocationClass = PortfolioClass | "cash";

export const classColor: Record<AllocationClass, string> = {
  stock: "#2547B8",
  savings: "#6FA8DC",
  gold: "#D4A017",
  crypto: "#9A4D0E",
  cash: "#1B8A8F",
};

export const classLabel: Record<AllocationClass, string> = {
  stock: "Cổ phiếu",
  savings: "Tiết kiệm",
  gold: "Vàng",
  crypto: "Crypto",
  cash: "Tiền & tài khoản",
};

export function Swatch({ cls }: { cls: AllocationClass }) {
  return (
    <span
      aria-hidden="true"
      className="size-2.5 flex-none rounded-[3px]"
      style={{ background: classColor[cls] }}
    />
  );
}

export const table = {
  wrap: "overflow-x-auto",
  table: "w-full border-collapse text-sm",
  headRow: "text-left text-xs tracking-[0.04em] text-subtle uppercase",
  th: "border-b border-line px-2 py-2.5 font-semibold",
  td: "border-b border-line-soft px-2 py-3.5",
};
