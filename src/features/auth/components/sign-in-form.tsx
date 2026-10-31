"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { GoogleAuthButton } from "@/features/auth/components/google-auth-button";
import {
  applyServerFieldErrors,
  getFormErrorMessage,
} from "@/features/auth/lib/form-errors";
import { useSignIn } from "@/features/auth/lib/queries";
import { continueUrl, joinUsUrl } from "@/features/auth/lib/redirect";
import { signInSchema, type SignInInput } from "@/features/auth/lib/schemas";

export function SignInForm({
  googleEnabled,
  callbackUrl,
}: {
  googleEnabled: boolean;
  callbackUrl?: string | null;
}) {
  const router = useRouter();
  const signIn = useSignIn();
  const afterAuth = continueUrl(callbackUrl);

  const form = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: {
      email: "",
      password: "",
      rememberMe: true,
    },
  });

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = form;

  const onSubmit = handleSubmit(async (data) => {
    try {
      await signIn.mutateAsync(data);
      router.push(afterAuth);
      router.refresh();
    } catch (error) {
      if (!applyServerFieldErrors(error, setError)) {
        toast.error(getFormErrorMessage(error));
      }
    }
  });

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to continue.</h1>
        <p className="text-sm text-muted-foreground">
          Sign in to manage bookings, sessions, and your Recro account.
        </p>
      </div>

      {/* Google Sign In */}
      <GoogleAuthButton enabled={googleEnabled} callbackUrl={callbackUrl ?? "/"} />

      <form onSubmit={onSubmit} className="space-y-6" noValidate>
        <FieldGroup>
          <Field data-invalid={!!errors.email}>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              aria-invalid={!!errors.email}
              {...register("email")}
            />
            <FieldError errors={[errors.email]} />
          </Field>

          <Field data-invalid={!!errors.password}>
            <div className="flex items-center justify-between gap-3">
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Link
                href="/forgot-password"
                className="text-xs text-primary hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              aria-invalid={!!errors.password}
              {...register("password")}
            />
            <FieldError errors={[errors.password]} />
          </Field>

          <Controller
            name="rememberMe"
            control={control}
            render={({ field }) => (
              <Field orientation="horizontal">
                <Checkbox
                  id="rememberMe"
                  checked={field.value}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                />
                <FieldLabel htmlFor="rememberMe" className="font-normal">
                  Keep me signed in
                </FieldLabel>
              </Field>
            )}
          />
        </FieldGroup>

        <Button
          type="submit"
          className="w-full rounded-full"
          size="lg"
          disabled={isSubmitting || signIn.isPending}
        >
          {isSubmitting || signIn.isPending ? <Spinner /> : null}
          Sign in
        </Button>
      </form>

      <FieldDescription className="text-center">
        New to Recro?{" "}
        <Link href={joinUsUrl(afterAuth)} className="font-medium text-primary">
          Create an account
        </Link>
      </FieldDescription>
    </div>
  );
}
