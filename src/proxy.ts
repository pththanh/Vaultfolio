// Optimistic redirect for signed-out visitors. Every page and action still
// re-checks the session through requireUser() (src/server/session.ts).
export { auth as proxy } from "@/auth";

export const config = {
  matcher: ["/admin/:path*"],
};
