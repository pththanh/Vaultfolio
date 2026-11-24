import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { dnseDateHeader, dnseHeaders, dnseSignature } from "./dnse-sign";

describe("DNSE signing", () => {
  const now = new Date("2026-11-22T08:30:05Z");

  it("formats the Date header in RFC 1123 style with +0000", () => {
    expect(dnseDateHeader(now)).toBe("Sun, 22 Nov 2026 08:30:05 +0000");
    expect(dnseDateHeader(new Date("2026-01-03T00:00:00Z"))).toBe(
      "Sat, 03 Jan 2026 00:00:00 +0000",
    );
  });

  it("signs request-target, date and nonce with HMAC-SHA256, base64, URL-encoded", () => {
    const date = dnseDateHeader(now);
    const expected = encodeURIComponent(
      createHmac("sha256", "test-secret")
        .update(
          `(request-target): get /price/ohlc\ndate: ${date}\nnonce: abc123`,
        )
        .digest("base64"),
    );
    expect(
      dnseSignature("test-secret", "GET", "/price/ohlc", date, "abc123"),
    ).toBe(expected);
    expect(expected).not.toMatch(/[+/=]/);
  });

  it("omits the nonce line when no nonce is used", () => {
    const date = dnseDateHeader(now);
    const expected = encodeURIComponent(
      createHmac("sha256", "s")
        .update(`(request-target): get /price/HPG/secdef\ndate: ${date}`)
        .digest("base64"),
    );
    expect(dnseSignature("s", "GET", "/price/HPG/secdef", date, null)).toBe(
      expected,
    );
  });

  it("builds the header set", () => {
    const h = dnseHeaders("key", "secret", "GET", "/price/ohlc", now, "n1");
    expect(h.Date).toBe("Sun, 22 Nov 2026 08:30:05 +0000");
    expect(h["x-api-key"]).toBe("key");
    expect(h["X-Signature"]).toMatch(
      /^Signature keyId="key",algorithm="hmac-sha256",headers="\(request-target\) date",signature="[^"]+",nonce="n1"$/,
    );
  });
});
