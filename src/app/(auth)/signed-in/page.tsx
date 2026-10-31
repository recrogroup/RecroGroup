import { redirect } from "next/navigation";

import { postAuthPath } from "@/features/auth/lib/redirect";
import { getOptionalSession } from "@/server/authz";

export const dynamic = "force-dynamic";

export default async function SignedInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  const session = await getOptionalSession();
  if (!session) redirect("/login");
  redirect(postAuthPath(session.role, callbackUrl));
}
