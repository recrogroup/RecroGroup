import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthSplitLayout } from "@/features/auth/components/auth-split-layout";
import { SignInForm } from "@/features/auth/components/sign-in-form";
import { postAuthPath } from "@/features/auth/lib/redirect";
import { isGoogleSignInAvailable } from "@/features/auth/lib/social";
import { getOptionalSession } from "@/server/authz";

export const metadata: Metadata = {
  title: "Sign in",
};

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  const session = await getOptionalSession();
  if (session) redirect(postAuthPath(session.role, callbackUrl));

  return (
    <AuthSplitLayout
      imageSrc="/assets/bg.png"
      imageAlt="Recro Group therapy background"
      quote={{
        text: "I left lighter than I came in.",
        author: "A Recro client",
      }}
    >
      <SignInForm
        googleEnabled={isGoogleSignInAvailable()}
        callbackUrl={callbackUrl}
      />
    </AuthSplitLayout>
  );
}
