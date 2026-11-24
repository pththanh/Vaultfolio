import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// 16px on phones: iOS zooms into smaller inputs.
export const inputClass =
  "min-h-11 w-full rounded-lg border border-field bg-surface px-3 text-base font-normal text-ink outline-none sm:text-sm focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/20 read-only:bg-well";

export const selectClass = cn(inputClass, "px-2.5");

export const textareaClass = cn(inputClass, "min-h-0 resize-y py-2.5");

export function Field({
  label,
  children,
  className,
  hint,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
  hint?: ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex flex-col gap-1.5 text-[13px] font-semibold text-ink-2",
        className,
      )}
    >
      {label}
      {children}
      {hint && <span className="text-xs font-normal text-subtle">{hint}</span>}
    </label>
  );
}
