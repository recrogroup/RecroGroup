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
import { useSignUp } from "@/features/auth/lib/queries";
import { continueUrl, loginUrl } from "@/features/auth/lib/redirect";
import { signUpSchema, type SignUpInput } from "@/features/auth/lib/schemas";

export function SignUpForm({
  googleEnabled,
  callbackUrl,
}: {
  googleEnabled: boolean;
  callbackUrl?: string | null;
}) {
  const router = useRouter();
  const signUp = useSignUp();
  const afterAuth = continueUrl(callbackUrl);

  const form = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
      phone: "",
      commsEmail: true,
      commsSms: false,
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
      await signUp.mutateAsync(data);
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
        <h1 className="text-2xl font-semibold tracking-tight">Sign up to continue.</h1>
        <p className="text-sm text-muted-foreground">
          Create your account to book sessions, track appointments, and access
          your care journey.
        </p>
      </div>

      {/* Google Sign Up */}
      <GoogleAuthButton enabled={googleEnabled} callbackUrl={callbackUrl ?? "/"} />

      <form onSubmit={onSubmit} className="space-y-6" noValidate>
        <FieldGroup>
          <Field data-invalid={!!errors.name}>
            <FieldLabel htmlFor="name">Full name</FieldLabel>
            <Input
              id="name"
              autoComplete="name"
              placeholder="Jane Doe"
              aria-invalid={!!errors.name}
              {...register("name")}
            />
            <FieldError errors={[errors.name]} />
          </Field>

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

          <Field data-invalid={!!errors.phone}>
            <FieldLabel htmlFor="phone">Phone (optional)</FieldLabel>
            <Input
              id="phone"
              type="tel"
              autoComplete="tel"
              placeholder="+254 7XX XXX XXX"
              aria-invalid={!!errors.phone}
              {...register("phone")}
            />
            <FieldError errors={[errors.phone]} />
          </Field>

          <Field data-invalid={!!errors.password}>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              aria-invalid={!!errors.password}
              {...register("password")}
            />
            <FieldDescription>
              At least 8 characters with a letter and a number.
            </FieldDescription>
            <FieldError errors={[errors.password]} />
          </Field>

          <Field data-invalid={!!errors.confirmPassword}>
            <FieldLabel htmlFor="confirmPassword">Confirm password</FieldLabel>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              aria-invalid={!!errors.confirmPassword}
              {...register("confirmPassword")}
            />
            <FieldError errors={[errors.confirmPassword]} />
          </Field>

          <Controller
            name="commsEmail"
            control={control}
            render={({ field }) => (
              <Field orientation="horizontal">
                <Checkbox
                  id="commsEmail"
                  checked={field.value}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                />
                <FieldLabel htmlFor="commsEmail" className="font-normal">
                  Email me appointment reminders and updates
                </FieldLabel>
              </Field>
            )}
          />

          <Controller
            name="commsSms"
            control={control}
            render={({ field }) => (
              <Field orientation="horizontal">
                <Checkbox
                  id="commsSms"
                  checked={field.value}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                />
                <FieldLabel htmlFor="commsSms" className="font-normal">
                  Send SMS reminders when available
                </FieldLabel>
              </Field>
            )}
          />
        </FieldGroup>

        <Button
          type="submit"
          className="w-full rounded-full"
          size="lg"
          disabled={isSubmitting || signUp.isPending}
        >
          {isSubmitting || signUp.isPending ? <Spinner /> : null}
          Create account
        </Button>
      </form>

      <FieldDescription className="text-center">
        Already have an account?{" "}
        <Link href={loginUrl(afterAuth)} className="font-medium text-primary">
          Sign in
        </Link>
      </FieldDescription>
    </div>
  );
}
