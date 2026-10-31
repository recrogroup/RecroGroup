"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { paymentAccessMatches } from "@/lib/payments/access-token";
import { resolveServicePrice } from "@/lib/payments/pricing";
import { generateReference, normalizePhone } from "@/lib/payments/utils";
import { getOptionalSession } from "@/server/authz";
import {
  SlotUnavailableError,
  assertSlotFree,
  getSlotAvailability,
  reconcileBookingSlots,
  withSlotLock,
} from "@/server/booking-slots";
import { isTimeSlot } from "@/features/public/booking/lib/schedule";
import {
  SLOT_UNAVAILABLE_MESSAGE,
  nairobiDate,
  sessionMinutes,
} from "@/features/public/booking/lib/slots";
import type { ActionResult } from "@/server/result";
import { fail, failure, invalid, ok } from "@/server/result";
import type { BookingInput } from "@/server/validation/booking";
import { PROGRAM_SERVICE_SLUGS, bookingSchema } from "@/server/validation/booking";

export type CreateBookingResult = {
  bookingId: string;
  reference: string;
  totalKes: number;
  depositKes: number;
  balanceKes: number;
};

export async function createBooking(
  input: BookingInput,
): Promise<ActionResult<CreateBookingResult>> {
  const parsed = bookingSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const values = parsed.data;

  try {
    if (
      PROGRAM_SERVICE_SLUGS.includes(
        values.serviceSlug as (typeof PROGRAM_SERVICE_SLUGS)[number],
      )
    ) {
      return fail("That service is booked through a different form", {
        serviceSlug: ["Choose a therapy session"],
      });
    }

    const price = await resolveServicePrice(values.serviceSlug);
    const service = price.serviceId
      ? await prisma.service.findUnique({
          where: { id: price.serviceId },
          select: { durationMin: true },
        })
      : null;
    const durationMin = sessionMinutes(null, service?.durationMin);
    if (!isTimeSlot(values.preferredTime)) {
      return fail("Choose a clinic time", { preferredTime: ["Choose a different time"] });
    }

    const session = await getOptionalSession();

    const therapist = values.therapistId
      ? await prisma.therapist.findFirst({
          where: { id: values.therapistId, isActive: true },
          select: { id: true },
        })
      : null;

    const booking = await withSlotLock(async (tx) => {
      await assertSlotFree(tx, {
        date: values.preferredDate,
        time: values.preferredTime,
        durationMin,
      });

      return tx.booking.create({
        data: {
          reference: generateReference("RB"),
          userId: session?.userId ?? null,
          serviceId: price.serviceId,
          therapistId: therapist?.id ?? null,
          clientName: values.clientName,
          clientEmail: values.clientEmail,
          clientPhone: normalizePhone(values.clientPhone),
          preferredDate: values.preferredDate,
          preferredTime: values.preferredTime,
          durationMin,
          sessionMode: values.sessionMode,
          notes: values.notes ?? null,
          amountKes: price.totalKes,
          depositKes: price.depositKes,
          amountPaidKes: 0,
        },
        select: { id: true, reference: true },
      });
    });

    revalidatePath("/dashboard/bookings");
    revalidatePath("/dashboard/notifications");
    revalidatePath("/dashboard");

    return ok({
      bookingId: booking.id,
      reference: booking.reference,
      totalKes: price.totalKes,
      depositKes: price.depositKes,
      balanceKes: price.balanceKes,
    });
  } catch (error) {
    if (error instanceof SlotUnavailableError) {
      return fail(SLOT_UNAVAILABLE_MESSAGE, {
        preferredTime: ["Choose a different time"],
      });
    }
    return failure("createBooking", error);
  }
}

export async function listSlotAvailability(date: string, durationMin: number) {
  return getSlotAvailability(date, Math.round(durationMin));
}

export async function reschedulePaidBooking(input: {
  reference: string;
  date: string;
  time: string;
  accessToken: string;
}): Promise<ActionResult<{ time: string }>> {
  try {
    const booking = await prisma.booking.findUnique({
      where: { reference: input.reference },
      select: {
        id: true,
        rescheduleReason: true,
        durationMin: true,
        service: { select: { durationMin: true } },
        payments: {
          where: { status: "PAID", method: "MPESA" },
          select: { providerMeta: true },
        },
      },
    });

    const authorised = booking?.payments.some((payment) =>
      paymentAccessMatches(payment.providerMeta, input.accessToken),
    );

    if (!booking || !authorised) {
      return fail("That paid booking could not be found");
    }
    if (!booking.rescheduleReason) {
      return fail("This booking already holds its day and time");
    }

    const date = nairobiDate(input.date);
    if (!date || !isTimeSlot(input.time)) {
      return fail("Choose a date and time");
    }

    const durationMin = sessionMinutes(booking.durationMin, booking.service?.durationMin);

    await withSlotLock(async (tx) => {
      await assertSlotFree(tx, {
        date,
        time: input.time,
        durationMin,
        ignoreBookingId: booking.id,
      });

      await tx.booking.update({
        where: { id: booking.id },
        data: {
          preferredDate: date,
          preferredTime: input.time,
          durationMin,
          rescheduleReason: null,
        },
      });

      await reconcileBookingSlots(tx);
    });
    const fresh = await prisma.booking.findUnique({
      where: { id: booking.id },
      select: { rescheduleReason: true },
    });
    if (fresh?.rescheduleReason) {
      return fail(fresh.rescheduleReason);
    }

    revalidatePath("/dashboard/bookings");
    revalidatePath("/admin/bookings");
    revalidatePath("/booking");

    return ok({ time: input.time });
  } catch (error) {
    if (error instanceof SlotUnavailableError) {
      return fail(SLOT_UNAVAILABLE_MESSAGE);
    }
    return failure("reschedulePaidBooking", error);
  }
}
