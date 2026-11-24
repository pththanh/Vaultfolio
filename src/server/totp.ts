import "server-only";
import { Secret, TOTP } from "otpauth";
import { decrypt, encrypt } from "./crypto";

const ISSUER = "Vaultfolio";

function totp(secretBase32: string, label: string) {
  return new TOTP({
    issuer: ISSUER,
    label,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  });
}

export function newTotpSecret(label: string) {
  const secret = new Secret({ size: 20 }).base32;
  return {
    encrypted: encrypt(secret),
    uri: totp(secret, label).toString(),
    secret,
  };
}

/**
 * Accepts the current code and one step either side (clock drift).
 * Returns the matched time step so callers can reject reuse, or null.
 */
export function verifyTotp(
  encryptedSecret: string,
  code: string,
  label = "",
): number | null {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const delta = totp(decrypt(encryptedSecret), label).validate({
    token: clean,
    window: 1,
  });
  return delta === null ? null : Math.floor(Date.now() / 30_000) + delta;
}
