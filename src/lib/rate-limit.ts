/**
 * Login brute-force protection. Attempts are stored in login_attempts (works
 * across serverless instances); this pure function decides from them.
 */
export const LOCKOUT = {
  windowMs: 15 * 60_000,
  /** Failed attempts for one email (password or 2FA code) before locking it. */
  maxPerEmail: 5,
  /** Failed attempts from one IP across all emails. */
  maxPerIp: 20,
};

interface Attempt {
  success: boolean;
  createdAt: Date;
}

export function loginLockout(
  byEmail: readonly Attempt[],
  byIp: readonly Attempt[],
  now: Date,
): { locked: false } | { locked: true; until: Date } {
  const since = now.getTime() - LOCKOUT.windowMs;
  const lastSuccess = Math.max(
    0,
    ...byEmail.filter((a) => a.success).map((a) => a.createdAt.getTime()),
  );

  const check = (attempts: readonly Attempt[], max: number, after: number) => {
    const failures = attempts
      .filter((a) => !a.success && a.createdAt.getTime() > after)
      .map((a) => a.createdAt.getTime())
      .sort((a, b) => b - a);
    return failures.length >= max
      ? new Date(failures[0] + LOCKOUT.windowMs)
      : null;
  };

  const until =
    check(byEmail, LOCKOUT.maxPerEmail, Math.max(since, lastSuccess)) ??
    check(byIp, LOCKOUT.maxPerIp, since);
  return until ? { locked: true, until } : { locked: false };
}
