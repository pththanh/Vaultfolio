import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeRedirect } from "@/lib/safe-redirect";
import { currentUser } from "@/server/session";
import { Logo } from "@/components/vf/logo";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Đăng nhập" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { callbackUrl } = await searchParams;
  const next = safeRedirect(
    Array.isArray(callbackUrl) ? callbackUrl[0] : callbackUrl,
  );
  // A stale session (password/2FA changed) is treated as signed out here, otherwise /admin ↔ /login would loop.
  if (await currentUser()) redirect(next);

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-card border border-line bg-surface p-7">
        <Logo />
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 text-2xl font-bold tracking-tight">Đăng nhập</h1>
          <p className="m-0 text-sm text-subtle">
            Dữ liệu tài sản chỉ hiển thị sau khi đăng nhập.
          </p>
        </div>
        <LoginForm next={next} />
        {process.env.NODE_ENV === "development" &&
          process.env.SEED_OWNER_EMAIL &&
          process.env.SEED_OWNER_PASSWORD && (
            <p className="m-0 rounded-lg bg-well px-3 py-2.5 text-[13px] text-subtle">
              Dev · tài khoản mẫu:{" "}
              <span className="font-semibold text-ink">
                {process.env.SEED_OWNER_EMAIL}
              </span>{" "}
              /{" "}
              <span className="font-semibold text-ink">
                {process.env.SEED_OWNER_PASSWORD}
              </span>
            </p>
          )}
      </div>
    </main>
  );
}
