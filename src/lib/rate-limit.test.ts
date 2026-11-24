import { describe, expect, it } from "vitest";
import { LOCKOUT, loginLockout } from "./rate-limit";

const now = new Date("2026-11-23T10:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);
const fail = (min: number, ip = "1.1.1.1") => ({
  success: false,
  createdAt: ago(min),
  ip,
});
const ok = (min: number, ip = "1.1.1.1") => ({
  success: true,
  createdAt: ago(min),
  ip,
});

describe("loginLockout", () => {
  it("allows a few failures", () => {
    const attempts = Array.from({ length: LOCKOUT.maxPerEmail - 1 }, (_, i) =>
      fail(i),
    );
    expect(loginLockout(attempts, [], now)).toEqual({ locked: false });
  });

  it(`locks the email after ${LOCKOUT.maxPerEmail} failures in the window`, () => {
    const attempts = Array.from({ length: LOCKOUT.maxPerEmail }, (_, i) =>
      fail(i + 1),
    );
    const r = loginLockout(attempts, [], now);
    expect(r.locked).toBe(true);
    // Unlocks one window after the most recent failure.
    expect(r.locked && r.until).toEqual(
      new Date(ago(1).getTime() + LOCKOUT.windowMs),
    );
  });

  it("ignores failures outside the window or before the last success", () => {
    const old = Array.from({ length: LOCKOUT.maxPerEmail }, () =>
      fail(LOCKOUT.windowMs / 60_000 + 1),
    );
    expect(loginLockout(old, [], now).locked).toBe(false);
    const beforeSuccess = [
      ...Array.from({ length: LOCKOUT.maxPerEmail }, () => fail(5)),
      ok(2),
    ];
    expect(loginLockout(beforeSuccess, [], now).locked).toBe(false);
  });

  it("locks an IP that sprays many emails", () => {
    const ipAttempts = Array.from({ length: LOCKOUT.maxPerIp }, (_, i) =>
      fail(i % 10),
    );
    expect(loginLockout([], ipAttempts, now).locked).toBe(true);
  });
});
