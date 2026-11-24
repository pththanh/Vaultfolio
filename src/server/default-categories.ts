import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/db/schema";
import { categories } from "@/db/schema";
import { DEFAULT_CATEGORIES } from "@/lib/calc/cashbook/default-categories";

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Give a user the default categories. Safe to repeat: a user who already has
 * categories keeps them as they are (also used by scripts, so no server-only).
 */
export async function ensureDefaultCategories(
  db: Db,
  userId: string,
): Promise<void> {
  const existing = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.userId, userId))
    .limit(1);
  if (existing.length) return;
  await db.transaction(async (tx) => {
    for (const [i, c] of DEFAULT_CATEGORIES.entries()) {
      await tx
        .insert(categories)
        .values({
          userId,
          kind: c.kind,
          name: c.name,
          icon: c.icon,
          color: c.color,
          sortOrder: i,
          isSystem: c.isSystem ?? false,
        })
        .onConflictDoNothing();
      if (!c.children?.length) continue;
      const parent = (
        await tx
          .select()
          .from(categories)
          .where(
            and(
              eq(categories.userId, userId),
              eq(categories.kind, c.kind),
              eq(categories.name, c.name),
            ),
          )
      ).find((row) => row.parentId === null)!;
      await tx
        .insert(categories)
        .values(
          c.children.map((child, j) => ({
            userId,
            kind: c.kind,
            parentId: parent.id,
            name: child.name,
            sortOrder: j,
            isSystem: child.isSystem ?? false,
          })),
        )
        .onConflictDoNothing();
    }
  });
}
