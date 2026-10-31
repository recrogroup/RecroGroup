import { afterEach, describe, expect, it, vi } from "vitest";

import { clientIpFrom, isTrustedDarajaIp } from "@/lib/payments/security";

const SAFARICOM_IP = "196.201.214.200";
const FOREIGN_IP = "203.0.113.7";

function enforce(extra: Record<string, string> = {}) {
  vi.stubEnv("MPESA_ENFORCE_IP_ALLOWLIST", "true");
  for (const [key, value] of Object.entries(extra)) {
    vi.stubEnv(key, value);
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("clientIpFrom", () => {
  it("uses the address Vercel observed, not a caller-supplied forwarded hop", () => {
    const headers = new Headers({
      "x-forwarded-for": SAFARICOM_IP,
      "x-vercel-forwarded-for": `${FOREIGN_IP}, 10.0.0.1`,
    });
    expect(clientIpFrom(headers)).toBe(FOREIGN_IP);
  });

  it("trims the Vercel address", () => {
    const headers = new Headers({
      "x-vercel-forwarded-for": `  ${FOREIGN_IP} , 10.0.0.1`,
    });
    expect(clientIpFrom(headers)).toBe(FOREIGN_IP);
  });

  it("falls back to x-real-ip", () => {
    const headers = new Headers({ "x-real-ip": FOREIGN_IP });
    expect(clientIpFrom(headers)).toBe(FOREIGN_IP);
  });

  it("returns null when neither trusted header is present", () => {
    expect(clientIpFrom(new Headers({ "x-forwarded-for": SAFARICOM_IP }))).toBeNull();
  });

  it("prefers the Vercel address over x-real-ip", () => {
    const headers = new Headers({
      "x-vercel-forwarded-for": SAFARICOM_IP,
      "x-real-ip": FOREIGN_IP,
    });
    expect(clientIpFrom(headers)).toBe(SAFARICOM_IP);
  });
});

describe("isTrustedDarajaIp", () => {
  it("allows any address when enforcement is off", () => {
    vi.stubEnv("MPESA_ENFORCE_IP_ALLOWLIST", "false");
    expect(isTrustedDarajaIp(FOREIGN_IP)).toBe(true);
    expect(isTrustedDarajaIp(null)).toBe(true);
  });

  it("treats an unset flag as disabled outside production", () => {
    vi.stubEnv("MPESA_ENFORCE_IP_ALLOWLIST", "");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VERCEL", "");
    expect(isTrustedDarajaIp(FOREIGN_IP)).toBe(true);
  });

  it("enforces the allowlist by default in production", () => {
    vi.stubEnv("MPESA_ENFORCE_IP_ALLOWLIST", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "");
    expect(isTrustedDarajaIp(FOREIGN_IP)).toBe(false);
    expect(isTrustedDarajaIp(SAFARICOM_IP)).toBe(true);
  });

  it("enforces the allowlist by default on Vercel", () => {
    vi.stubEnv("MPESA_ENFORCE_IP_ALLOWLIST", "");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VERCEL", "1");
    expect(isTrustedDarajaIp(FOREIGN_IP)).toBe(false);
    expect(isTrustedDarajaIp(null)).toBe(false);
  });

  it.each([
    "196.201.214.200",
    "196.201.213.44",
    "196.201.212.1",
    "196.201.211.99",
    "196.201.210.7",
    "196.202.183.10",
    "196.202.182.10",
  ])("allows Safaricom address %s when enforcing", (ip) => {
    enforce();
    expect(isTrustedDarajaIp(ip)).toBe(true);
  });

  it("rejects an address outside the Safaricom ranges", () => {
    enforce();
    expect(isTrustedDarajaIp(FOREIGN_IP)).toBe(false);
  });

  it("rejects a null address when enforcing", () => {
    enforce();
    expect(isTrustedDarajaIp(null)).toBe(false);
  });

  it("allows an address named in MPESA_ALLOWED_IPS", () => {
    enforce({ MPESA_ALLOWED_IPS: `10.1.1.1, ${FOREIGN_IP}` });
    expect(isTrustedDarajaIp(FOREIGN_IP)).toBe(true);
  });

  it("still rejects addresses absent from the extra allowlist", () => {
    enforce({ MPESA_ALLOWED_IPS: "10.1.1.1" });
    expect(isTrustedDarajaIp(FOREIGN_IP)).toBe(false);
  });

  it("does not treat a prefix as a suffix match", () => {
    enforce();
    expect(isTrustedDarajaIp("10.0.0.196.201.214.1")).toBe(false);
  });
});
