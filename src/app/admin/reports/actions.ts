"use server";

import { revalidatePath } from "next/cache";
import { todayVN } from "@/lib/format";
import { requireUser } from "@/server/session";
import { snapshotUser } from "@/server/snapshots";
import type { FormState } from "../transactions/actions";

/** Recompute this user's snapshots for the whole history from transactions + current prices. */
export async function rebuildSnapshots(): Promise<FormState> {
  const user = await requireUser();
  const days = await snapshotUser(user.id, {
    from: "2000-01-01",
    to: todayVN(),
  });
  revalidatePath("/admin/reports");
  if (days === 0)
    return { error: "Chưa có giao dịch hay sổ tiết kiệm nào để tạo snapshot" };
  return {
    ok: true,
    message: `Đã tính lại ${days} ngày snapshot`,
    nonce: Date.now(),
  };
}
