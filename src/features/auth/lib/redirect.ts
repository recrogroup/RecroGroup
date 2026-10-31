export const DEFAULT_AFTER_AUTH = "/";
export const STAFF_AFTER_AUTH = "/dashboard";
export const SIGNED_IN_PATH = "/signed-in";

const AUTH_PREFIXES = [
  "/login",
  "/join-us",
  "/forgot-password",
  "/reset-password",
  SIGNED_IN_PATH,
];

export function safeCallbackUrl(
  value: string | null | undefined,
  fallback = DEFAULT_AFTER_AUTH,
): string {
  if (!value) return fallback;

  let decoded = value.trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    return fallback;
  }

  if (!decoded.startsWith("/")) return fallback;
  if (decoded.startsWith("//") || decoded.startsWith("/\\")) return fallback;
  if (decoded.includes("://")) return fallback;

  const pathOnly = decoded.split("?")[0] ?? decoded;
  if (AUTH_PREFIXES.some((prefix) => pathOnly === prefix || pathOnly.startsWith(`${prefix}/`))) {
    return fallback;
  }

  return decoded;
}

export function loginUrl(returnTo?: string | null) {
  const callbackUrl = safeCallbackUrl(returnTo);
  if (callbackUrl === DEFAULT_AFTER_AUTH) return "/login";
  return `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`;
}

export function continueUrl(returnTo?: string | null) {
  const callbackUrl = safeCallbackUrl(returnTo);
  if (callbackUrl === DEFAULT_AFTER_AUTH) return SIGNED_IN_PATH;
  return `${SIGNED_IN_PATH}?callbackUrl=${encodeURIComponent(callbackUrl)}`;
}

export function postAuthPath(
  role: string | null | undefined,
  returnTo?: string | null,
) {
  const requested = safeCallbackUrl(returnTo);
  const staff = role === "admin" || role === "receptionist";

  if (requested.startsWith("/admin") || requested.startsWith("/dashboard")) {
    return staff ? requested : DEFAULT_AFTER_AUTH;
  }

  if (requested !== DEFAULT_AFTER_AUTH) return requested;
  return staff ? STAFF_AFTER_AUTH : DEFAULT_AFTER_AUTH;
}

export function joinUsUrl(returnTo?: string | null) {
  const callbackUrl = safeCallbackUrl(returnTo);
  if (callbackUrl === DEFAULT_AFTER_AUTH) return "/join-us";
  return `/join-us?callbackUrl=${encodeURIComponent(callbackUrl)}`;
}
