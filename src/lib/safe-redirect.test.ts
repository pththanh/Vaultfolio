import { describe, expect, it } from "vitest";
import { safeRedirect } from "./safe-redirect";

describe("safeRedirect", () => {
  it.each([
    ["/admin/cashbook?month=2026-11", "/admin/cashbook?month=2026-11"],
    ["https://app.example/admin/cashbook", "/admin/cashbook"],
    ["https://evil.example/admin/x", "/admin/x"],
    ["/admin", "/admin"],
    ["", "/admin"],
    [null, "/admin"],
    ["//evil.example", "/admin"],
    ["/admin/../login", "/admin"],
    ["/\\evil.example", "/admin"],
    ["javascript:alert(1)", "/admin"],
    ["/administrator", "/admin"],
    ["https://evil.example", "/admin"],
  ])("%s → %s", (input, want) => expect(safeRedirect(input)).toBe(want));
});
