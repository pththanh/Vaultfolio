import "server-only";
import { and, desc, eq, gt, lt } from "drizzle-orm";
import { db } from "@/db";
import { loginAttempts } from "@/db/schema";
import { LOCKOUT, loginLockout } from "@/lib/rate-limit";

export function clientIp(request: Request | undefined): string {
  const forwarded = request?.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  return forwarded || request?.headers.get("x-real-ip") || "unknown";
}

export async function isLockedOut(email: string, ip: string): Promise<boolean> {
  const since = new Date(Date.now() - LOCKOUT.windowMs);
  const [byEmail, byIp] = await Promise.all([
    db
      .select({
        success: loginAttempts.success,
        createdAt: loginAttempts.createdAt,
      })
      .from(loginAttempts)
      .where(
        and(eq(loginAttempts.email, email), gt(loginAttempts.createdAt, since)),
      )
      .orderBy(desc(loginAttempts.createdAt))
      .limit(50),
    db
      .select({
        success: loginAttempts.success,
        createdAt: loginAttempts.createdAt,
      })
      .from(loginAttempts)
      .where(and(eq(loginAttempts.ip, ip), gt(loginAttempts.createdAt, since)))
      .orderBy(desc(loginAttempts.createdAt))
      .limit(100),
  ]);
  return loginLockout(byEmail, byIp, new Date()).locked;
}

export async function recordAttempt(
  email: string,
  ip: string,
  success: boolean,
): Promise<void> {
  await db.insert(loginAttempts).values({ email, ip, success });
  // Keep the table small: drop attempts older than a day.
  if (Math.random() < 0.05) {
    await db
      .delete(loginAttempts)
      .where(lt(loginAttempts.createdAt, new Date(Date.now() - 86_400_000)));
  }
}
