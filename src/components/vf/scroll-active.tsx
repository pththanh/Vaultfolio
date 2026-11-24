"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

/** Horizontal strip that keeps its current item in view on narrow screens. */
export function ScrollActive({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    const strip = ref.current;
    const item = strip?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!strip || !item || strip.scrollWidth <= strip.clientWidth) return;
    const s = strip.getBoundingClientRect();
    const i = item.getBoundingClientRect();
    strip.scrollLeft += i.left - s.left - (s.width - i.width) / 2;
  }, [pathname]);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
