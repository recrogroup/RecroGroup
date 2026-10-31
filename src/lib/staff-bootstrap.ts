// Grants Director (stored role "admin") and Admin (stored role "receptionist")
// on sign-in, only after the inbox is verified. Production uses a different
// database from a laptop, so this list is what makes info@recrogroup.org a
// Director there. carolinehawi91@gmail.com is the receptionist and is never
// left as Director. An existing Director is not demoted, except that
// receptionist address and the retired address minanicalm@gmail.com.
// See HANDOVER.md.
import { prisma } from "@/lib/prisma";
import {
  parseAppRole,
  type AppRole,
} from "@/features/portal/lib/roles";

/** Staff granted locally; production is a separate DB so these must be reapplied. */
const DEFAULT_ADMIN_EMAILS = ["info@recrogroup.org"];
/** Shown as Admin. A stored Director role on this address is corrected. */
const RECEPTIONIST_NEVER_DIRECTOR = "carolinehawi91@gmail.com";
const PREVIOUS_SUPER_ADMIN = "minanicalm@gmail.com";
const SUPER_ADMIN_RETIRED_KEY = "previous_super_admin_retired";
const DEFAULT_RECEPTIONIST_EMAILS = ["carolinehawi91@gmail.com"];

export function parseEmailList(value: string | undefined) {
  return (value ?? "")
    .split(/[,;\s]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function emailsFromEnvOrDefault(
  envValue: string | undefined,
  fallback: string[],
) {
  const fromEnv = parseEmailList(envValue);
  if (fromEnv.length > 0) return fromEnv;
  return fallback.map((email) => email.trim().toLowerCase());
}

export function bootstrapAdminEmails() {
  return emailsFromEnvOrDefault(
    process.env.BOOTSTRAP_ADMIN_EMAILS,
    DEFAULT_ADMIN_EMAILS,
  );
}

export function bootstrapReceptionistEmails() {
  return emailsFromEnvOrDefault(
    process.env.BOOTSTRAP_RECEPTIONIST_EMAILS,
    DEFAULT_RECEPTIONIST_EMAILS,
  );
}

export function bootstrapRoleForEmail(email: string): AppRole | null {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  if (bootstrapAdminEmails().includes(normalized)) return "admin";
  if (bootstrapReceptionistEmails().includes(normalized)) return "receptionist";
  return null;
}

const REVOKED_STAFF_KEY = "revoked_staff_emails";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function listRevokedStaffEmails(): Promise<string[]> {
  const row = await prisma.siteSetting.findUnique({
    where: { key: REVOKED_STAFF_KEY },
    select: { value: true },
  });
  if (!row?.value) return [];

  try {
    const parsed = JSON.parse(row.value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map(normalizeEmail)
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Remember an explicit removal so sign-in does not restore a staff role. */
export async function setStaffRoleRevoked(email: string, revoked: boolean) {
  const normalized = normalizeEmail(email);
  if (!normalized) return;

  const emails = new Set(await listRevokedStaffEmails());
  if (revoked) emails.add(normalized);
  else emails.delete(normalized);

  const value = JSON.stringify([...emails]);
  await prisma.siteSetting.upsert({
    where: { key: REVOKED_STAFF_KEY },
    create: { key: REVOKED_STAFF_KEY, value },
    update: { value },
  });
}

export async function syncBootstrapStaffRole(user: {
  id: string;
  email: string;
  role?: string | null;
  emailVerified?: boolean;
}): Promise<AppRole> {
  const retired = await retirePreviousSuperAdmin(user);
  if (retired) return retired;

  const current = parseAppRole(user.role);
  const normalized = normalizeEmail(user.email);
  const verified = user.emailVerified === true;

  if (normalized === RECEPTIONIST_NEVER_DIRECTOR && current === "admin") {
    const revoked = (await listRevokedStaffEmails()).includes(normalized);
    const next: AppRole = revoked || !verified ? "customer" : "receptionist";
    await prisma.user.update({
      where: { id: user.id },
      data: { role: next },
    });
    return next;
  }

  const desired = bootstrapRoleForEmail(user.email);

  if (desired && !verified) {
    if (current === "admin" || current === "receptionist") {
      await prisma.user.update({
        where: { id: user.id },
        data: { role: "customer" },
      });
      return "customer";
    }
    return current;
  }

  if (!desired || current === desired) return current;
  if (current === "admin") return current;
  if ((await listRevokedStaffEmails()).includes(normalized)) return current;

  await prisma.user.update({
    where: { id: user.id },
    data: { role: desired },
  });

  return desired;
}

/** The previous super admin loses Director access once, the next time they sign in. */
async function retirePreviousSuperAdmin(user: {
  id: string;
  email: string;
  role?: string | null;
}): Promise<AppRole | null> {
  if (normalizeEmail(user.email) !== PREVIOUS_SUPER_ADMIN) return null;
  if (parseAppRole(user.role) !== "admin") return null;

  const marker = await prisma.siteSetting.findUnique({
    where: { key: SUPER_ADMIN_RETIRED_KEY },
    select: { value: true },
  });
  if (marker?.value === "1") return null;

  await prisma.user.update({
    where: { id: user.id },
    data: { role: "customer" },
  });
  await setStaffRoleRevoked(PREVIOUS_SUPER_ADMIN, true);
  await prisma.siteSetting.upsert({
    where: { key: SUPER_ADMIN_RETIRED_KEY },
    create: { key: SUPER_ADMIN_RETIRED_KEY, value: "1" },
    update: { value: "1" },
  });

  return "customer";
}
