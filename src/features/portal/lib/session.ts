import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { syncBootstrapStaffRole } from "@/lib/staff-bootstrap";

import type { AppRole } from "./roles";
import { APP_ROLES } from "./roles";

export type PortalSession = {
  userId: string;
  email: string;
  name: string | null;
  image: string | null;
  role: AppRole;
};

export async function getPortalSession(): Promise<PortalSession | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return null;
  }

  const role = await syncBootstrapStaffRole({
    id: session.user.id,
    email: session.user.email,
    role: session.user.role,
    emailVerified: session.user.emailVerified,
  });

  return {
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    image: session.user.image ?? null,
    role,
  };
}

/** Dev helper when no session cookie is present */
export function getDevPortalSession(role?: AppRole): PortalSession {
  const devRole =
    role ??
    (process.env.DEV_PORTAL_ROLE as AppRole | undefined) ??
    "admin";

  return {
    userId: "dev-user",
    email: "dev@recrogroup.org",
    name: "Dev User",
    image: null,
    role: APP_ROLES.includes(devRole) ? devRole : "admin",
  };
}
