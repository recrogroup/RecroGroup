"use server";

// Staff changes to bookings, messages, and grief-camp applications:
// status, free a slot, delete one booking (Director only), clear old
// bookings, and delete an inquiry. See HANDOVER.md.

import { revalidatePath } from "next/cache";

import { Prisma } from "@prisma/client";
import type {
  AppointmentStatus,
  BookingStatus,
  GriefApplicationStatus,
  InquiryStatus,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { ensurePaymentsSchema } from "@/lib/payments/ensure-schema";
import { isTimeSlot } from "@/features/public/booking/lib/schedule";
import { permanentSlotLabel, sessionMinutes } from "@/features/public/booking/lib/slots";
import {
  SlotUnavailableError,
  assertSlotFree,
  createBlockedSlot,
  deleteBlockedSlot,
  reconcileBookingSlots,
  withSlotLock,
} from "@/server/booking-slots";
import { AuthorizationError, requireAdmin, requireStaff } from "@/server/authz";
import type { ActionResult } from "@/server/result";
import { fail, failure, ok } from "@/server/result";

const GRIEF_STATUSES: GriefApplicationStatus[] = [
  "PENDING",
  "REVIEWING",
  "ACCEPTED",
  "REJECTED",
  "WAITLISTED",
];

const INQUIRY_STATUSES: InquiryStatus[] = [
  "NEW",
  "IN_PROGRESS",
  "RESOLVED",
  "CLOSED",
];

const BOOKING_STATUSES: BookingStatus[] = [
  "REQUESTED",
  "CONFIRMED",
  "COMPLETED",
  "CANCELLED",
];

export async function setGriefApplicationStatus(
  applicationId: string,
  status: GriefApplicationStatus,
): Promise<ActionResult<{ id: string; status: GriefApplicationStatus }>> {
  try {
    await requireStaff();

    if (!GRIEF_STATUSES.includes(status)) {
      return fail("Unknown application status");
    }

    const application = await prisma.griefApplication.update({
      where: { id: applicationId },
      data: { status },
      select: { id: true, status: true },
    });

    revalidatePath("/dashboard/programs");
    revalidatePath("/admin/grief-camp");

    return ok(application);
  } catch (error) {
    if (error instanceof AuthorizationError) return fail(error.message);
    return failure("setGriefApplicationStatus", error);
  }
}

export async function setInquiryStatus(
  inquiryId: string,
  status: InquiryStatus,
): Promise<ActionResult<{ id: string; status: InquiryStatus }>> {
  try {
    await requireStaff();

    if (!INQUIRY_STATUSES.includes(status)) {
      return fail("Unknown inquiry status");
    }

    const inquiry = await prisma.inquiry.update({
      where: { id: inquiryId },
      data: { status },
      select: { id: true, status: true },
    });

    revalidateInquiryPaths();

    return ok(inquiry);
  } catch (error) {
    if (error instanceof AuthorizationError) return fail(error.message);
    return failure("setInquiryStatus", error);
  }
}

export async function deleteInquiry(
  inquiryId: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    await requireStaff();

    await prisma.inquiry.delete({ where: { id: inquiryId } });
    revalidateInquiryPaths();

    return ok({ id: inquiryId });
  } catch (error) {
    if (error instanceof AuthorizationError) return fail(error.message);
    return failure("deleteInquiry", error);
  }
}

function revalidateInquiryPaths() {
  revalidatePath("/dashboard/inquiries");
  revalidatePath("/dashboard/programs/consortium");
  revalidatePath("/dashboard/programs/corporate");
  revalidatePath("/dashboard/programs/team-building");
  revalidatePath("/dashboard/programs/therapist-applications");
  revalidatePath("/admin/messages");
  revalidatePath("/admin/grief-camp/team-building");
  revalidatePath("/admin/grief-camp/therapist-applications");
}

export async function setBookingStatus(
  bookingId: string,
  status: BookingStatus,
): Promise<ActionResult<{ id: string; status: BookingStatus }>> {
  try {
    await requireStaff();

    if (!BOOKING_STATUSES.includes(status)) {
      return fail("Unknown booking status");
    }

    const current = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        preferredDate: true,
        preferredTime: true,
        durationMin: true,
        service: { select: { durationMin: true } },
      },
    });
    if (!current) return fail("Booking not found");

    const restoring =
      (status === "REQUESTED" || status === "CONFIRMED") &&
      (current.status === "CANCELLED" || current.status === "COMPLETED");

    if (restoring && current.preferredDate && current.preferredTime) {
      try {
        await withSlotLock(async (tx) => {
          await assertSlotFree(tx, {
            date: current.preferredDate!,
            time: current.preferredTime!,
            durationMin: sessionMinutes(current.durationMin, current.service?.durationMin),
            ignoreBookingId: bookingId,
          });
          await tx.booking.update({
            where: { id: bookingId },
            data: { status },
          });
          await reconcileBookingSlots(tx);
        });
      } catch (error) {
        if (error instanceof SlotUnavailableError) {
          return fail("That day and time is already booked. Free it or choose another slot first.");
        }
        throw error;
      }
    } else {
      await prisma.booking.update({
        where: { id: bookingId },
        data: { status },
      });
      await reconcileBookingSlots();
    }

    const booking = { id: bookingId, status };

    revalidatePath("/dashboard/bookings");
    revalidatePath(`/dashboard/bookings/${bookingId}`);
    revalidatePath("/admin/bookings");

    return ok(booking);
  } catch (error) {
    if (error instanceof AuthorizationError) return fail(error.message);
    return failure("setBookingStatus", error);
  }
}

/** Ends a client's recurring hold so that weekday and time can be booked again. */
export async function releaseBookingSlot(
  bookingId: string,
): Promise<ActionResult<{ id: string; slotLabel: string }>> {
  try {
    await requireStaff();

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        preferredDate: true,
        preferredTime: true,
      },
    });

    if (!booking) return fail("Booking not found");
    if (booking.status === "COMPLETED" || booking.status === "CANCELLED") {
      return fail("This time is already free");
    }
    if (!booking.preferredTime) return fail("This booking has no reserved time");

    await prisma.booking.update({
      where: { id: bookingId },
      data: { status: "COMPLETED" },
    });
    await reconcileBookingSlots();

    revalidatePath("/dashboard/bookings");
    revalidatePath(`/dashboard/bookings/${bookingId}`);
    revalidatePath("/admin/bookings");
    revalidatePath("/booking");

    const slotLabel = booking.preferredDate
      ? permanentSlotLabel(booking.preferredDate, booking.preferredTime)
      : booking.preferredTime;

    return ok({ id: booking.id, slotLabel });
  } catch (error) {
    if (error instanceof AuthorizationError) return fail(error.message);
    return failure("releaseBookingSlot", error);
  }
}

function revalidateSlotPaths() {
  revalidatePath("/dashboard/bookings");
  revalidatePath("/admin/bookings");
  revalidatePath("/booking");
}

export async function blockCalendarSlot(input: {
  weekday: number;
  time: string;
}): Promise<ActionResult<{ id: string; weekday: number; time: string }>> {
  try {
    const session = await requireStaff();
    if (!isTimeSlot(input.time)) return fail("Choose a clinic time");
    if (input.weekday < 1 || input.weekday > 6) {
      return fail("Choose a weekday from Monday to Saturday");
    }

    const blocked = await createBlockedSlot({
      weekday: input.weekday,
      time: input.time,
      createdById: session.userId,
    });

    revalidateSlotPaths();
    return ok(blocked);
  } catch (error) {
    if (error instanceof AuthorizationError) return fail(error.message);
    if (error instanceof SlotUnavailableError) {
      return fail("That day and time is already booked or blocked");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return fail("That day and time is already blocked");
    }
    return failure("blockCalendarSlot", error);
  }
}

export async function unblockCalendarSlot(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    await requireStaff();
    const blocked = await deleteBlockedSlot(id);
    revalidateSlotPaths();
    return ok(blocked);
  } catch (error) {
    if (error instanceof AuthorizationError) return fail(error.message);
    return failure("unblockCalendarSlot", error);
  }
}

export async function assignTherapist(
  bookingId: string,
  therapistId: string | null,
): Promise<ActionResult<{ id: string; therapistId: string | null }>> {
  try {
    await requireStaff();

    if (therapistId) {
      const therapist = await prisma.therapist.findUnique({
        where: { id: therapistId },
        select: { id: true, isActive: true },
      });

      if (!therapist) return fail("Therapist not found");
      if (!therapist.isActive) return fail("That therapist is no longer active");
    }

    const booking = await prisma.booking.update({
      where: { id: bookingId },
      data: { therapistId },
      select: { id: true, therapistId: true },
    });

    revalidatePath("/dashboard/bookings");
    revalidatePath(`/dashboard/bookings/${bookingId}`);
    revalidatePath("/admin/bookings");

    return ok(booking);
  } catch (error) {
    if (error instanceof AuthorizationError) return fail(error.message);
    return failure("assignTherapist", error);
  }
}

export async function linkPaymentToBooking(
  paymentId: string,
  bookingId: string | null,
): Promise<ActionResult<{ id: string; bookingId: string | null }>> {
  try {
    await requireStaff();

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: { id: true, status: true, bookingId: true },
    });

    if (!payment) return fail("Payment not found");

    if (payment.status === "PAID" && payment.bookingId && bookingId !== payment.bookingId) {
      return fail(
        "This payment is already settled against another booking. Refund it instead of relinking.",
      );
    }

    if (bookingId) {
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { id: true },
      });
      if (!booking) return fail("Booking not found");
    }

    const updated = await prisma.payment.update({
      where: { id: paymentId },
      data: { bookingId },
      select: { id: true, bookingId: true },
    });

    revalidatePath("/dashboard/payments");
    revalidatePath("/admin/payments");

    return ok(updated);
  } catch (error) {
    if (error instanceof AuthorizationError) return fail(error.message);
    return failure("linkPaymentToBooking", error);
  }
}

export async function setAppointmentStatus(
  appointmentId: string,
  status: AppointmentStatus,
): Promise<ActionResult<{ id: string; status: AppointmentStatus }>> {
  try {
    await requireStaff();

    const appointment = await prisma.appointment.update({
      where: { id: appointmentId },
      data: { status },
      select: { id: true, status: true },
    });

    revalidatePath("/dashboard/bookings");

    return ok(appointment);
  } catch (error) {
    if (error instanceof AuthorizationError) return fail(error.message);
    return failure("setAppointmentStatus", error);
  }
}

const BOOKING_PAYMENT_PURPOSES = [
  "BOOKING_DEPOSIT",
  "BOOKING_BALANCE",
  "BOOKING_FULL",
] as const;

const CLEAR_WINDOW_MS = {
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
} as const;

export type BookingClearWindow = keyof typeof CLEAR_WINDOW_MS;

function revalidateBookingSurfaces() {
  revalidatePath("/admin/bookings");
  revalidatePath("/admin/payments");
  revalidatePath("/admin");
  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/payments");
  revalidatePath("/dashboard");
}

export async function clearAllBookings(): Promise<
  ActionResult<{ bookings: number; payments: number }>
> {
  try {
    await requireAdmin();

    const payments = await prisma.payment.deleteMany();
    const bookings = await prisma.booking.deleteMany();

    revalidateBookingSurfaces();

    return ok({ bookings: bookings.count, payments: payments.count });
  } catch (error) {
    if (error instanceof AuthorizationError) return fail(error.message);
    return failure("clearAllBookings", error);
  }
}

function agedBookingWhere(cutoff: Date) {
  return {
    OR: [
      { createdAt: { lt: cutoff } },
      {
        payments: {
          some: {
            createdAt: { lt: cutoff },
            purpose: { in: [...BOOKING_PAYMENT_PURPOSES] },
          },
        },
      },
    ],
  };
}

function agedPaymentWhere(cutoff: Date) {
  return {
    OR: [
      {
        purpose: { in: [...BOOKING_PAYMENT_PURPOSES] },
        createdAt: { lt: cutoff },
      },
      { booking: { createdAt: { lt: cutoff } } },
    ],
  };
}

/** Deletes old bookings, their payments, and the rows those deletes depend on. */
export async function clearOldBookings(
  window: BookingClearWindow,
): Promise<ActionResult<{ bookings: number; payments: number }>> {
  try {
    await requireAdmin();

    const span = CLEAR_WINDOW_MS[window];
    if (!span) return fail("Choose the last 1 week or the last 1 month");

    const cutoff = new Date(Date.now() - span);
    const bookingsWhere = agedBookingWhere(cutoff);
    const paymentsWhere = agedPaymentWhere(cutoff);

    await ensurePaymentsSchema();
    await prisma.paymentEvent.deleteMany({
      where: { payment: paymentsWhere },
    });
    await prisma.appointment.deleteMany({
      where: { booking: bookingsWhere },
    });
    const payments = await prisma.payment.deleteMany({ where: paymentsWhere });
    const bookings = await prisma.booking.deleteMany({ where: bookingsWhere });

    revalidateBookingSurfaces();

    return ok({ bookings: bookings.count, payments: payments.count });
  } catch (error) {
    if (error instanceof AuthorizationError) return fail(error.message);
    return failure("clearOldBookings", error);
  }
}

/** Removes one booking, its payments, and the rows those deletes depend on. */
export async function deleteBooking(
  bookingId: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    await requireAdmin();

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true },
    });
    if (!booking) return fail("Booking not found");

    await ensurePaymentsSchema();
    await prisma.paymentEvent.deleteMany({
      where: { payment: { bookingId } },
    });
    await prisma.appointment.deleteMany({ where: { bookingId } });
    await prisma.payment.deleteMany({ where: { bookingId } });
    await prisma.booking.delete({ where: { id: bookingId } });
    await reconcileBookingSlots();

    revalidateBookingSurfaces();
    revalidatePath(`/dashboard/bookings/${bookingId}`);
    revalidatePath("/booking");

    return ok({ id: bookingId });
  } catch (error) {
    if (error instanceof AuthorizationError) return fail(error.message);
    return failure("deleteBooking", error);
  }
}
