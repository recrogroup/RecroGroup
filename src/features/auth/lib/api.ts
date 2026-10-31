import { authClient } from "@/lib/auth-client";
import { AuthApiError } from "@/features/auth/lib/errors";
import { continueUrl } from "@/features/auth/lib/redirect";
import type {
  ForgotPasswordInput,
  SignInInput,
  SignUpInput,
} from "@/features/auth/lib/schemas";
import { signInWithPassword, signUpWithPassword } from "@/server/actions/auth";

type AuthClientResult<T> = {
  data: T | null;
  error: { message?: string } | null;
};

function assertNoAuthError(result: AuthClientResult<unknown>) {
  if (result.error) {
    throw new AuthApiError(
      result.error.message ?? "Something went wrong. Please try again.",
    );
  }
}

export async function getSession() {
  const result = await authClient.getSession();

  if (result.error) {
    throw new AuthApiError(
      result.error.message ?? "Failed to load session.",
    );
  }

  return { user: result.data?.user ?? null };
}

export async function signIn(input: SignInInput) {
  const result = await signInWithPassword({
    ...input,
    email: input.email.trim().toLowerCase(),
  });

  if (!result.ok) {
    throw new AuthApiError(result.error, result.fieldErrors);
  }

  return result.data;
}

export async function signUp(input: SignUpInput) {
  const result = await signUpWithPassword({
    ...input,
    email: input.email.trim().toLowerCase(),
  });

  if (!result.ok) {
    throw new AuthApiError(result.error, result.fieldErrors);
  }

  return result.data;
}

export async function signInWithGoogle(callbackURL = "/") {
  const result = await authClient.signIn.social({
    provider: "google",
    callbackURL: continueUrl(callbackURL),
    errorCallbackURL: "/login",
  });
  assertNoAuthError(result);
}

export async function signOut() {
  assertNoAuthError(await authClient.signOut());
}

export async function requestPasswordReset(input: ForgotPasswordInput) {
  assertNoAuthError(
    await authClient.requestPasswordReset({
      email: input.email,
      redirectTo: `${window.location.origin}/reset-password`,
    }),
  );
}

export async function resetPassword(input: { token: string; password: string }) {
  assertNoAuthError(
    await authClient.resetPassword({
      token: input.token,
      newPassword: input.password,
    }),
  );
}
