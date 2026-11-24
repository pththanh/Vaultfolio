"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ScrollActive } from "./scroll-active";
import { Logo } from "./logo";

const icon = {
  overview: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </>
  ),
  cashbook: (
    <>
      <rect x="3" y="6" width="18" height="14" rx="2" />
      <path d="M3 10h18" />
      <path d="M16 15h2" />
      <path d="M7 6V4h10v2" />
    </>
  ),
  portfolio: (
    <>
      <path d="M3 3v18h18" />
      <path d="M7 15l4-4 3 3 5-6" />
    </>
  ),
  transactions: (
    <>
      <path d="M7 4v16" />
      <path d="M3 8l4-4 4 4" />
      <path d="M17 20V4" />
      <path d="M21 16l-4 4-4-4" />
    </>
  ),
  savings: (
    <>
      <path d="M3 10l9-6 9 6" />
      <path d="M5 10v9h14v-9" />
      <path d="M9 19v-5h6v5" />
    </>
  ),
  reports: (
    <>
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
      <path d="M22 20H2" />
    </>
  ),
  prices: (
    <>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 4v5h-5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
} satisfies Record<string, ReactNode>;

const items: { href: string; label: string; icon: keyof typeof icon }[] = [
  { href: "/admin", label: "Tổng quan", icon: "overview" },
  { href: "/admin/cashbook", label: "Thu chi", icon: "cashbook" },
  { href: "/admin/portfolio", label: "Danh mục", icon: "portfolio" },
  { href: "/admin/transactions", label: "Giao dịch", icon: "transactions" },
  { href: "/admin/savings", label: "Tiết kiệm", icon: "savings" },
  { href: "/admin/reports", label: "Báo cáo", icon: "reports" },
  { href: "/admin/prices", label: "Giá & dữ liệu", icon: "prices" },
  { href: "/admin/settings", label: "Cài đặt", icon: "settings" },
];

export function Sidebar({ footer }: { footer: ReactNode }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Điều hướng chính"
      className="flex w-full flex-col gap-1 border-b border-line bg-surface px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-3 md:sticky md:top-0 md:h-screen md:w-[240px] md:flex-none md:border-r md:border-b-0 md:py-6"
    >
      <div className="px-3 pt-1 pb-3 md:pb-6">
        <Logo />
      </div>
      <ScrollActive className="-mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:flex-col md:overflow-visible md:px-0">
        {items.map((item) => {
          const active =
            item.href === "/admin"
              ? pathname === "/admin"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-11 flex-none items-center gap-3 rounded-lg px-3 text-sm whitespace-nowrap no-underline",
                active
                  ? "bg-brand-soft font-semibold text-brand-ink hover:text-brand-ink"
                  : "font-medium text-ink-2 hover:bg-chip hover:text-ink",
              )}
            >
              <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {icon[item.icon]}
              </svg>
              {item.label}
            </Link>
          );
        })}
      </ScrollActive>
      <div className="hidden md:mt-auto md:block">{footer}</div>
    </nav>
  );
}
