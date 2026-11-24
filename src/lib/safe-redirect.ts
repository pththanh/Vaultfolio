const HOME = "/admin";

/** Where to go after login: only pages under /admin of this site, else the overview. */
export function safeRedirect(target: string | null | undefined): string {
  if (!target) return HOME;
  const base = "http://internal.invalid";
  let path = target;
  try {
    // Auth.js passes an absolute URL; keep only its path and query.
    const url = new URL(target, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return HOME;
    path = url.pathname + url.search;
  } catch {
    return HOME;
  }
  return path === HOME ||
    path.startsWith(`${HOME}/`) ||
    path.startsWith(`${HOME}?`)
    ? path
    : HOME;
}
