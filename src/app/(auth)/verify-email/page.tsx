import { redirect } from "next/navigation";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; callbackURL?: string }>;
}) {
  const { token, callbackURL } = await searchParams;
  if (!token) redirect("/login");

  const params = new URLSearchParams({ token });
  if (callbackURL) params.set("callbackURL", callbackURL);
  redirect(`/api/auth/verify-email?${params.toString()}`);
}
