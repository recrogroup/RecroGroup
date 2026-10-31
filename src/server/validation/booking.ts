import { z } from "zod";

import { isValidKenyanPhone } from "@/lib/payments/utils";

/** Programs that use their own form, not the session checkout. */
export const PROGRAM_SERVICE_SLUGS = [
  "children",
  "corporate",
  "consortium",
  "supervision",
] as const;

const startOfToday = () => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
};

function parseLocalDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

export const bookingSchema = z.object({
  serviceSlug: z.string().min(1, "Select a service"),
  clientName: z.string().trim().min(2, "Enter your full name"),
  clientEmail: z.email("Enter a valid email address"),
  clientPhone: z
    .string()
    .trim()
    .refine(isValidKenyanPhone, "Enter a valid Kenyan phone number"),
  preferredDate: z
    .string()
    .trim()
    .min(1, "Choose a preferred date")
    .transform((value, ctx) => {
      const date = parseLocalDate(value);
      if (!date) {
        ctx.addIssue({
          code: "custom",
          message: "Choose a preferred date",
        });
        return z.NEVER;
      }
      return date;
    })
    .refine((date) => date >= startOfToday(), "Preferred date cannot be in the past"),
  preferredTime: z.string().trim().min(1, "Choose a preferred time"),
  sessionMode: z.enum(["IN_PERSON", "ONLINE", "PHONE"]),
  notes: z.string().trim().max(2000).optional(),
  therapistId: z.string().trim().min(1).optional(),
});

export type BookingInput = z.input<typeof bookingSchema>;
export type BookingValues = z.output<typeof bookingSchema>;

export const staffCalendarBookingSchema = z.object({
  date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a clinic date"),
  time: z.string().trim().min(1, "Choose a clinic time"),
  serviceSlug: z.string().trim().min(1, "Select a session type"),
  clientName: z.string().trim().min(2, "Enter the candidate's name"),
  clientEmail: z
    .string()
    .trim()
    .optional()
    .transform((value) => value ?? "")
    .refine(
      (value) => value === "" || z.email().safeParse(value).success,
      "Enter a valid email address",
    ),
  clientPhone: z
    .string()
    .trim()
    .optional()
    .transform((value) => value ?? "")
    .refine(
      (value) => value === "" || isValidKenyanPhone(value),
      "Enter a valid Kenyan phone number",
    ),
  sessionMode: z.enum(["IN_PERSON", "ONLINE", "PHONE"]).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export type StaffCalendarBookingInput = z.input<typeof staffCalendarBookingSchema>;
