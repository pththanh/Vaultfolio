"use client";

import { useActionState, useState } from "react";
import { login, type LoginState } from "./actions";
import { Field, inputClass } from "@/components/vf/form";
import { buttonClass } from "@/components/vf/ui";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {
    step: "password",
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const totp = state.step === "totp";

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Email">
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          readOnly={totp}
          className={inputClass}
        />
      </Field>
      <Field label="Mật khẩu">
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          readOnly={totp}
          className={inputClass}
        />
      </Field>
      {totp && (
        <Field label="Mã xác thực 2 bước (6 số)">
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            autoFocus
            className={`${inputClass} tracking-[0.3em] num`}
          />
        </Field>
      )}
      {state.error && (
        <p
          role="alert"
          className="rounded-lg bg-err-bg px-3 py-2 text-sm font-semibold text-err-ink"
        >
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className={buttonClass("primary", "w-full")}
      >
        {pending ? "Đang kiểm tra…" : totp ? "Xác nhận" : "Đăng nhập"}
      </button>
    </form>
  );
}
