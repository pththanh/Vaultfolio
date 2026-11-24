import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { events } from "@/db/schema";
import { getOwnedEvent, isoDate, optionalAmount, optionalId } from "./cashbook";
import { LedgerError } from "./ledger";

const optionalDate = isoDate.or(z.literal("").transform(() => null));

export const eventFormSchema = z.object({
  id: optionalId,
  name: z.string().trim().min(1, "Nhập tên sự kiện").max(80),
  startOn: optionalDate,
  endOn: optionalDate,
  budget: optionalAmount,
});

export async function saveEvent(
  userId: string,
  { id, ...values }: z.infer<typeof eventFormSchema>,
): Promise<void> {
  if (values.startOn && values.endOn && values.endOn < values.startOn)
    throw new LedgerError("Ngày kết thúc phải sau ngày bắt đầu");
  await db.transaction(async (tx) => {
    if (id) await getOwnedEvent(tx, userId, id);
    const clash = await tx.query.events.findFirst({
      where: and(eq(events.userId, userId), eq(events.name, values.name)),
    });
    if (clash && clash.id !== id)
      throw new LedgerError("Đã có sự kiện cùng tên");
    if (id) await tx.update(events).set(values).where(eq(events.id, id));
    else await tx.insert(events).values({ userId, ...values });
  });
}

/** Entries stay, without the event. */
export async function deleteEvent(userId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await getOwnedEvent(tx, userId, id);
    await tx.delete(events).where(eq(events.id, id));
  });
}
