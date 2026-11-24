"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { safeRedirect } from "@/lib/safe-redirect";

export interface LoginState {
  step: "password" | "totp";
  error?: string;
}

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const code = String(formData.get("code") ?? "");
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      code,
      redirectTo: safeRedirect(String(formData.get("next") ?? "")),
    });
    return { step: "password" };
  } catch (err) {
    if (err instanceof AuthError) {
      const kind = "code" in err ? (err as { code?: string }).code : undefined;
      if (kind === "locked") {
        return {
          step: "password",
          error: "Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút.",
        };
      }
      if (kind === "totp_required") return { step: "totp" };
      if (kind === "totp_invalid")
        return {
          step: "totp",
          error: "Mã xác thực không đúng hoặc đã hết hạn.",
        };
      return { step: "password", error: "Email hoặc mật khẩu không đúng." };
    }
    throw err; // redirect after success
  }
}
