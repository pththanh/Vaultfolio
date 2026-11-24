import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

// Reuse the connection across hot reloads in development.
const globalForDb = globalThis as unknown as {
  pg?: ReturnType<typeof postgres>;
};
// prepare: false keeps it compatible with Neon's pooled (PgBouncer, transaction mode) URL.
const client = globalForDb.pg ?? postgres(url, { max: 5, prepare: false });
if (process.env.NODE_ENV !== "production") globalForDb.pg = client;

export const db = drizzle(client, { schema, casing: "snake_case" });
export { schema };
