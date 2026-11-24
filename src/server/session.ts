import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";

export interface CurrentUser {
  id: string;
  email: string;
}

/**
 * The signed-in user, or null. The user must still exist and the session must
 * not predate a password / 2FA change (sessionVersion).
 */
export const currentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const user = await db.query.users.findFirst({
    where: eq(users.id, id),
    columns: { id: true, email: true, sessionVersion: true },
  });
  if (!user || user.sessionVersion !== session.user.sv) return null;
  return { id: user.id, email: user.email };
});

/**
 * Data Access Layer entry point: every page, server action and route handler
 * calls this before touching user data.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}
