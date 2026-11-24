"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { buttonClass } from "@/components/vf/ui";
import { rebuildSnapshots } from "./actions";

export function RebuildButton({ primary }: { primary?: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await rebuildSnapshots();
          if (res.error) toast.error(res.error);
          else toast.success(res.message);
        })
      }
      className={buttonClass(primary ? "primary" : "outline")}
      title="Tính lại toàn bộ snapshot từ giao dịch và giá hiện có"
    >
      {pending
        ? "Đang tính…"
        : primary
          ? "Tạo snapshot từ lịch sử"
          : "Tính lại snapshot"}
    </button>
  );
}
