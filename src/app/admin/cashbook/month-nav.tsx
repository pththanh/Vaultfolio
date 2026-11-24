import Link from "next/link";
import { buttonClass } from "@/components/vf/ui";

export function PeriodNav({
  label,
  prev,
  next,
  unit = "Tháng",
}: {
  label: string;
  prev: string;
  /** null = disabled. */
  next: string | null;
  unit?: string;
}) {
  const cls = "min-w-11 px-0";
  return (
    <div className="flex items-center justify-between gap-2 sm:justify-start">
      <Link
        href={prev}
        aria-label={`${unit} trước`}
        className={buttonClass("outline", cls)}
      >
        ‹
      </Link>
      <span className="min-w-36 text-center text-base font-semibold num">
        {label}
      </span>
      {next ? (
        <Link
          href={next}
          aria-label={`${unit} sau`}
          className={buttonClass("outline", cls)}
        >
          ›
        </Link>
      ) : (
        <span
          aria-hidden="true"
          className={buttonClass("outline", `${cls} opacity-40`)}
        >
          ›
        </span>
      )}
    </div>
  );
}

export const monthLabel = (month: string) =>
  `Tháng ${Number(month.slice(5))}/${month.slice(0, 4)}`;

export const isMonth = (v: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
