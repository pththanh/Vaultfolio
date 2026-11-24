import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { clientIp, isLockedOut, recordAttempt } from "@/server/login-guard";
import { verifyTotp } from "@/server/totp";

declare module "next-auth" {
  interface Session {
    user: { id: string; email: string; sv: number };
  }
  interface User {
    sv?: number;
  }
}

export class TotpRequired extends CredentialsSignin {
  code = "totp_required";
}
export class TotpInvalid extends CredentialsSignin {
  code = "totp_invalid";
}
export class LockedOut extends CredentialsSignin {
  code = "locked";
}

const DUMMY_HASH =
  "$2b$12$FCUTDK6X08bl8TAVoANqBONos4IvlXQDgPJtO7zPv7WKihqSJtHWW";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
  code: z.string().optional(),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {}, code: {} },
      async authorize(raw, request) {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password, code } = parsed.data;
        const ip = clientIp(request);
        if (await isLockedOut(email, ip)) throw new LockedOut();

        const user = await db.query.users.findFirst({
          where: eq(users.email, email),
        });
        // Compare against a dummy hash when the user is unknown to keep timing uniform.
        const ok = await bcrypt.compare(
          password,
          user?.passwordHash ?? DUMMY_HASH,
        );
        if (!user || !ok) {
          await recordAttempt(email, ip, false);
          return null;
        }

        if (user.totpEnabled && user.totpSecret) {
          // Correct password, code not sent yet: ask for it without counting a failure.
          if (!code) throw new TotpRequired();
          const step = verifyTotp(user.totpSecret, code, user.email);
          if (
            step === null ||
            (user.totpLastStep !== null && step <= user.totpLastStep)
          ) {
            await recordAttempt(email, ip, false);
            throw new TotpInvalid();
          }
          await db
            .update(users)
            .set({ totpLastStep: step })
            .where(eq(users.id, user.id));
        }
        await recordAttempt(email, ip, true);
        return { id: user.id, email: user.email, sv: user.sessionVersion };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) {
        token.uid = user.id;
        token.sv = user.sv ?? 0;
      }
      return token;
    },
    session({ session, token }) {
      if (typeof token.uid === "string") session.user.id = token.uid;
      session.user.sv = typeof token.sv === "number" ? token.sv : -1;
      return session;
    },
    authorized({ auth: session }) {
      return !!session?.user;
    },
  },
});
