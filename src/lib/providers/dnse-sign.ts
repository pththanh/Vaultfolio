import { createHmac, randomUUID } from "node:crypto";

/**
 * DNSE OpenAPI request signing, ported from the official SDK
 * (github.com/dnse-tech/openapi-sdk, javascript/dnse/common.js + client.js).
 * Signs "(request-target): <method> <path>\ndate: <date>[\nnonce: <nonce>]"
 * with HMAC-SHA256, base64 then URL-encoded. The path excludes the query string.
 */

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const pad = (n: number) => String(n).padStart(2, "0");

/** "Sun, 22 Nov 2026 08:30:00 +0000" */
export function dnseDateHeader(d: Date): string {
  return `${DAYS[d.getUTCDay()]}, ${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;
}

export function dnseSignature(
  secret: string,
  method: string,
  path: string,
  date: string,
  nonce: string | null,
): string {
  let payload = `(request-target): ${method.toLowerCase()} ${path}\ndate: ${date}`;
  if (nonce) payload += `\nnonce: ${nonce}`;
  return encodeURIComponent(
    createHmac("sha256", Buffer.from(secret, "utf8"))
      .update(payload, "utf8")
      .digest("base64"),
  );
}

export function dnseHeaders(
  apiKey: string,
  secret: string,
  method: string,
  path: string,
  now = new Date(),
  nonce: string | null = randomUUID().replace(/-/g, ""),
): Record<string, string> {
  const date = dnseDateHeader(now);
  const signature = dnseSignature(secret, method, path, date, nonce);
  let header = `Signature keyId="${apiKey}",algorithm="hmac-sha256",headers="(request-target) date",signature="${signature}"`;
  if (nonce) header += `,nonce="${nonce}"`;
  return { Date: date, "X-Signature": header, "x-api-key": apiKey };
}
