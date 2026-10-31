import "server-only";

const SAFARICOM_RANGES = [
  "196.201.214.",
  "196.201.213.",
  "196.201.212.",
  "196.201.211.",
  "196.201.210.",
  "196.202.183.",
  "196.202.182.",
];

function extraAllowlist() {
  const raw = process.env.MPESA_ALLOWED_IPS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function clientIpFrom(headers: Headers) {
  // x-forwarded-for can be set by the caller. Vercel overwrites
  // x-vercel-forwarded-for with the address it actually saw.
  const vercel = headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  if (vercel) return vercel;
  const real = headers.get("x-real-ip")?.trim();
  return real || null;
}

export function isTrustedDarajaIp(ip: string | null) {
  const flag = process.env.MPESA_ENFORCE_IP_ALLOWLIST?.trim().toLowerCase();
  const enforce =
    flag === "true" ||
    (flag !== "false" &&
      (process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL)));

  if (!enforce) return true;
  if (!ip) return false;

  const allowlist = extraAllowlist();
  if (allowlist.includes(ip)) return true;

  return SAFARICOM_RANGES.some((prefix) => ip.startsWith(prefix));
}
