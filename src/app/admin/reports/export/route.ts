import { toSnapshotsCsv } from "@/lib/csv";
import { todayVN } from "@/lib/format";
import { requireUser } from "@/server/session";
import { loadSnapshots } from "@/server/snapshots";

export async function GET() {
  const user = await requireUser();
  const csv = toSnapshotsCsv(await loadSnapshots(user.id));
  return new Response(`﻿${csv}\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="vaultfolio-tai-san-rong-${todayVN()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
