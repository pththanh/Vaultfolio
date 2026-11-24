/**
 * Create the owner account (or reset its password) without touching other data.
 * Use this in production instead of the seed, which wipes the database.
 *
 *   NEW_PASSWORD='…' npm run user:create -- you@example.com
 *   NEW_PASSWORD='…' npm run user:create -- you@example.com --reset-password
 *   npm run user:create -- you@example.com --seed-categories   # existing user, safe to repeat
 *
 * --reset-password also turns off 2FA and signs out every session (account recovery).
 */
import { config } from "dotenv";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "../src/db/schema";
import { DEFAULT_FEE_CONFIG } from "../src/lib/calc/fees";
import { ensureDefaultCategories } from "../src/server/default-categories";

config({ path: process.env.ENV_FILE ?? ".env.local" });

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const reset = process.argv.includes("--reset-password");
  const password = process.env.NEW_PASSWORD ?? "";
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email))
    throw new Error(
      "Usage: NEW_PASSWORD=… npm run user:create -- <email> [--reset-password]",
    );
  const seedOnly = process.argv.includes("--seed-categories");
  if (!seedOnly && password.length < 10)
    throw new Error("NEW_PASSWORD must be at least 10 characters");

  const client = postgres(process.env.DATABASE_URL!, {
    max: 1,
    prepare: false,
  });
  const db = drizzle(client, { schema: s, casing: "snake_case" });
  try {
    const existing = await db.query.users.findFirst({
      where: eq(s.users.email, email),
    });
    if (seedOnly) {
      if (!existing) throw new Error(`${email} does not exist.`);
      await ensureDefaultCategories(db, existing.id);
      console.log(`Default categories are in place for ${email}.`);
      return;
    }
    const passwordHash = await bcrypt.hash(password, 12);
    if (existing) {
      if (!reset)
        throw new Error(
          `${email} already exists. Pass --reset-password to reset it.`,
        );
      await db
        .update(s.users)
        .set({
          passwordHash,
          totpEnabled: false,
          totpSecret: null,
          totpLastStep: null,
          sessionVersion: sql`${s.users.sessionVersion} + 1`,
        })
        .where(eq(s.users.id, existing.id));
      console.log(
        `Password reset for ${email}; 2FA turned off, all sessions signed out.`,
      );
      return;
    }
    const [user] = await db
      .insert(s.users)
      .values({ email, passwordHash })
      .returning();
    await db
      .insert(s.userSettings)
      .values({ userId: user.id, fees: DEFAULT_FEE_CONFIG });
    await ensureDefaultCategories(db, user.id);
    console.log(`Created ${email}. Sign in and enable 2FA under Cài đặt.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
