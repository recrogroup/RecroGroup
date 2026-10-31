import "server-only";

import type { BookingStatus, PaymentStatus, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { ensureSlotColumns } from "@/server/booking-slots";

export type BookingFilters = {
  status?: BookingStatus;
  paymentStatus?: PaymentStatus;
  /** Booking has at least one successful M-Pesa payment. */
  hasSuccessfulPayment?: boolean;
  /** Include confirmed call-in bookings that have no M-Pesa payment yet. */
  includeUnpaidConfirmed?: boolean;
  serviceId?: string;
  therapistId?: string;
  search?: string;
  take?: number;
  skip?: number;
};

function bookingWhere(filters: BookingFilters): Prisma.BookingWhereInput {
  const where: Prisma.BookingWhereInput = {};
  const clauses: Prisma.BookingWhereInput[] = [];

  if (filters.status) where.status = filters.status;
  if (filters.paymentStatus) where.paymentStatus = filters.paymentStatus;
  if (filters.hasSuccessfulPayment && filters.includeUnpaidConfirmed) {
    clauses.push({
      OR: [
        { payments: { some: { status: "PAID", method: "MPESA" } } },
        { status: "CONFIRMED" },
      ],
    });
  } else if (filters.hasSuccessfulPayment) {
    where.payments = { some: { status: "PAID", method: "MPESA" } };
  }
  if (filters.serviceId) where.serviceId = filters.serviceId;
  if (filters.therapistId) where.therapistId = filters.therapistId;

  const search = filters.search?.trim();
  if (search) {
    clauses.push({
      OR: [
        { reference: { contains: search, mode: "insensitive" } },
        { clientName: { contains: search, mode: "insensitive" } },
        { clientEmail: { contains: search, mode: "insensitive" } },
        { clientPhone: { contains: search, mode: "insensitive" } },
      ],
    });
  }

  if (clauses.length === 1) Object.assign(where, clauses[0]);
  else if (clauses.length > 1) where.AND = clauses;

  return where;
}

export async function listBookings(filters: BookingFilters = {}) {
  await ensureSlotColumns();
  const where = bookingWhere(filters);

  const [items, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      include: {
        service: { select: { id: true, title: true, slug: true, priceKes: true } },
        therapist: { select: { id: true, fullName: true } },
        payments: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            reference: true,
            status: true,
            failureReason: true,
            amountKes: true,
            mpesaReceipt: true,
            phone: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: filters.take ?? 50,
      skip: filters.skip ?? 0,
    }),
    prisma.booking.count({ where }),
  ]);

  return { items, total };
}

export async function getBookingById(id: string) {
  await ensureSlotColumns();
  return prisma.booking.findUnique({
    where: { id },
    include: {
      service: true,
      therapist: true,
      payments: { orderBy: { createdAt: "desc" } },
      appointments: { orderBy: { scheduledAt: "asc" } },
      user: { select: { id: true, name: true, email: true } },
    },
  });
}

export async function getBookingByReference(reference: string) {
  await ensureSlotColumns();
  return prisma.booking.findUnique({
    where: { reference },
    include: { service: true, payments: { orderBy: { createdAt: "desc" } } },
  });
}
