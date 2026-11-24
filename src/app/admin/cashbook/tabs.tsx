import Link from "next/link";
import { ScrollActive } from "@/components/vf/scroll-active";
import { cn } from "@/lib/utils";

const TABS = [
  ["/admin/cashbook", "Sổ ghi chép"],
  ["/admin/cashbook/wallets", "Ví"],
  ["/admin/cashbook/budgets", "Hạn mức"],
  ["/admin/cashbook/reports", "Báo cáo"],
  ["/admin/cashbook/debts", "Vay nợ"],
  ["/admin/cashbook/recurring", "Định kỳ"],
  ["/admin/cashbook/events", "Sự kiện"],
] as const;

export function CashbookTabs({ active }: { active: (typeof TABS)[number][0] }) {
  return (
    <nav aria-label="Thu chi">
      <ScrollActive className="flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            aria-current={href === active ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-semibold whitespace-nowrap no-underline",
              href === active
                ? "border-brand text-brand-ink"
                : "border-transparent text-subtle hover:text-ink",
            )}
          >
            {label}
          </Link>
        ))}
      </ScrollActive>
    </nav>
  );
}
