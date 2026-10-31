import "server-only";

import { Prisma } from "@prisma/client";
import type {
  Currency,
  PaymentMethod,
  PaymentPurpose,
  PaymentStatus,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { ensureSlotColumns, reconcileBookingSlots } from "@/server/booking-slots";

import { createPaymentAccessToken, readPaymentAccessToken } from "./access-token";
import { ensurePaymentsSchema } from "./ensure-schema";
import type { NormalizedEvent, PaymentTarget, VerifyResult } from "./types";
import { generateReference } from "./utils";

const SETTLED: PaymentStatus[] = ["PAID", "REFUNDED"];
const TERMINAL: PaymentStatus[] = ["PAID", "FAILED", "CANCELLED", "REFUNDED"];

function isTerminal(status: PaymentStatus) {
  return TERMINAL.includes(status);
}

function targetLink(target: PaymentTarget) {
  switch (target.kind) {
    case "booking":
      return { bookingId: target.bookingId };
    case "griefApplication":
      return { griefApplicationId: target.griefApplicationId };
    case "donation":
      return { donationId: target.donationId };
  }
}

export type CreatePaymentInput = {
  target: PaymentTarget;
  userId?: string | null;
  method: PaymentMethod;
  provider: "MPESA_DARAJA" | "PAYSTACK" | "MANUAL";
  purpose: PaymentPurpose;
  amountKes: number;
  currency?: Currency;
  phone?: string | null;
  idempotencyKey?: string | null;
  notes?: string | null;
  bankReference?: string | null;
  proofUrl?: string | null;
};

async function ensurePaymentAccessToken<T extends { id: string; providerMeta: Prisma.JsonValue }>(
  payment: T,
) {
  if (readPaymentAccessToken(payment.providerMeta)) return payment;

  return prisma.payment.update({
    where: { id: payment.id },
    data: {
      providerMeta: {
        ...asJsonObject(payment.providerMeta),
        accessToken: createPaymentAccessToken(),
      },
    },
  });
}

export async function createPendingPayment(input: CreatePaymentInput) {
  await ensurePaymentsSchema();

  if (input.idempotencyKey) {
    const existing = await prisma.payment.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) return ensurePaymentAccessToken(existing);
  }

  const data: Prisma.PaymentUncheckedCreateInput = {
    reference: generateReference("RP"),
    method: input.method,
    provider: input.provider,
    purpose: input.purpose,
    currency: input.currency ?? "KES",
    amountKes: input.amountKes,
    status: "PENDING",
    phone: input.phone ?? null,
    userId: input.userId ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    notes: input.notes ?? null,
    providerMeta: { accessToken: createPaymentAccessToken() },
    ...targetLink(input.target),
    ...(input.bankReference ? { bankReference: input.bankReference } : {}),
    ...(input.proofUrl ? { proofUrl: input.proofUrl } : {}),
  };

  try {
    return await prisma.payment.create({ data });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      input.idempotencyKey
    ) {
      const existing = await prisma.payment.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) return ensurePaymentAccessToken(existing);
    }
    throw error;
  }
}

function asJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function markPaymentProcessing(
  paymentId: string,
  patch: {
    providerRef?: string | null;
    expiresAt?: Date | null;
    providerMeta?: Prisma.InputJsonValue | null;
  },
) {
  const current = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { providerMeta: true },
  });

  const updated = await prisma.payment.update({
    where: { id: paymentId },
    data: {
      status: "PROCESSING",
      providerRef: patch.providerRef ?? undefined,
      mpesaCheckoutId: patch.providerRef ?? undefined,
      expiresAt: patch.expiresAt ?? undefined,
      ...(patch.providerMeta != null
        ? {
            providerMeta: {
              ...asJsonObject(current?.providerMeta),
              ...asJsonObject(patch.providerMeta),
            } as Prisma.InputJsonValue,
          }
        : {}),
    },
  });

  if (updated.bookingId) {
    await prisma.booking.updateMany({
      where: {
        id: updated.bookingId,
        paymentStatus: { in: ["PENDING", "FAILED", "CANCELLED"] },
      },
      data: { paymentStatus: "PROCESSING" },
    });
  }

  return updated;
}

export async function recordEvent(event: NormalizedEvent, paymentId?: string | null) {
  try {
    return await prisma.paymentEvent.create({
      data: {
        paymentId: paymentId ?? null,
        provider: event.provider,
        eventType: event.eventType,
        dedupeKey: event.dedupeKey,
        payload: event.payload as Prisma.InputJsonValue,
        processed: false,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return null;
    }
    throw error;
  }
}

async function resolvePayment(event: NormalizedEvent) {
  if (event.reference) {
    const byReference = await prisma.payment.findUnique({
      where: { reference: event.reference },
    });
    if (byReference) return byReference;
  }

  if (event.providerRef) {
    return prisma.payment.findFirst({
      where: { provider: event.provider, providerRef: event.providerRef },
    });
  }

  return null;
}

export async function settlePayment(paymentId: string, result: VerifyResult) {
  await ensureSlotColumns();
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment) return { applied: false as const, reason: "not_found" as const };

    // A provider confirming money never loses to an earlier non-money status.
    // A status poll can race ahead of the callback and fail a payment the
    // customer went on to authorise, so PAID is allowed to correct it.
    const settledAlready = payment.status === "PAID" || payment.status === "REFUNDED";
    const correctingToPaid = result.status === "PAID" && !settledAlready;

    if (isTerminal(payment.status) && !correctingToPaid) {
      return { applied: false as const, reason: "already_final" as const, payment };
    }

    if (result.status === "PAID") {
      const reported = result.settledAmountKes;
      if (reported == null || reported < payment.amountKes) {
        return { applied: false as const, reason: "amount_mismatch" as const, payment };
      }
    }

    const settledAmount = result.settledAmountKes ?? payment.amountKes;
    const paidAt = result.status === "PAID" ? (result.paidAt ?? new Date()) : null;

    const updated = await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: result.status,
        settledAmountKes: result.status === "PAID" ? settledAmount : null,
        providerRef: result.providerRef ?? payment.providerRef,
        mpesaReceipt: result.mpesaReceipt ?? payment.mpesaReceipt,
        mpesaCheckoutId: payment.mpesaCheckoutId ?? result.providerRef ?? null,
        phone: result.phone ?? payment.phone,
        failureReason: result.failureReason ?? null,
        paidAt,
        providerMeta: {
          ...asJsonObject(payment.providerMeta),
          result: result.raw ?? null,
        } as Prisma.InputJsonValue,
      },
    });

    if (result.status === "PAID") {
      await applySettlementToTarget(tx, updated.id);
    } else if (result.status === "FAILED" || result.status === "CANCELLED") {
      await applyFailureToTarget(tx, updated);
    }

    return { applied: true as const, payment: updated };
  });
}

type TxClient = Prisma.TransactionClient;

async function applySettlementToTarget(tx: TxClient, paymentId: string) {
  const payment = await tx.payment.findUnique({ where: { id: paymentId } });
  if (!payment) return;

  const amount = payment.settledAmountKes ?? payment.amountKes;

  if (payment.bookingId) {
    const booking = await tx.booking.findUnique({
      where: { id: payment.bookingId },
    });
    if (!booking) return;

    const paidTotal = await sumSettled(tx, { bookingId: payment.bookingId });
    const total = booking.amountKes ?? amount;

    await tx.booking.update({
      where: { id: booking.id },
      data: {
        amountPaidKes: paidTotal,
        paymentStatus: paidTotal >= total ? "PAID" : "PROCESSING",
        status: booking.status === "REQUESTED" ? "CONFIRMED" : booking.status,
      },
    });
    await reconcileBookingSlots(tx);
    return;
  }

  if (payment.griefApplicationId) {
    const application = await tx.griefApplication.findUnique({
      where: { id: payment.griefApplicationId },
    });
    if (!application) return;

    const paidTotal = await sumSettled(tx, {
      griefApplicationId: payment.griefApplicationId,
    });
    const total = application.amountKes ?? amount;

    await tx.griefApplication.update({
      where: { id: application.id },
      data: { paymentStatus: paidTotal >= total ? "PAID" : "PROCESSING" },
    });
    return;
  }

  if (payment.donationId) {
    await tx.donation.update({
      where: { id: payment.donationId },
      data: { paymentStatus: "PAID" },
    });
  }
}

async function applyFailureToTarget(
  tx: TxClient,
  payment: { bookingId: string | null; status: PaymentStatus },
) {
  if (!payment.bookingId) return;

  const booking = await tx.booking.findUnique({
    where: { id: payment.bookingId },
  });
  if (!booking) return;

  const paidTotal = await sumSettled(tx, { bookingId: payment.bookingId });
  const total = booking.amountKes ?? paidTotal;

  if (paidTotal > 0) {
    await tx.booking.update({
      where: { id: booking.id },
      data: {
        amountPaidKes: paidTotal,
        paymentStatus: total > 0 && paidTotal >= total ? "PAID" : "PROCESSING",
      },
    });
    return;
  }

  const inflight = await tx.payment.count({
    where: {
      bookingId: payment.bookingId,
      status: { in: ["PENDING", "PROCESSING"] },
    },
  });

  if (inflight > 0) {
    await tx.booking.update({
      where: { id: booking.id },
      data: { paymentStatus: "PROCESSING" },
    });
    return;
  }

  // Nothing was collected. Drop the booking so only a successful payment is recorded.
  await tx.booking.delete({ where: { id: booking.id } });
}

async function sumSettled(tx: TxClient, where: Prisma.PaymentWhereInput) {
  const rows = await tx.payment.findMany({
    where: { ...where, status: { in: SETTLED } },
    select: { settledAmountKes: true, amountKes: true },
  });
  return rows.reduce(
    (total, row) => total + (row.settledAmountKes ?? row.amountKes),
    0,
  );
}

export async function processEvent(event: NormalizedEvent) {
  const payment = await resolvePayment(event);
  const stored = await recordEvent(event, payment?.id ?? null);

  if (!stored) {
    return { duplicate: true as const };
  }

  if (!payment) {
    await prisma.paymentEvent.update({
      where: { id: stored.id },
      data: { error: "No matching payment for this event" },
    });
    return { duplicate: false as const, matched: false as const };
  }

  try {
    const outcome = await settlePayment(payment.id, event.result);
    await prisma.paymentEvent.update({
      where: { id: stored.id },
      data: { processed: true },
    });

    if (outcome.applied) {
      const { sendPaymentFailureNotice, sendPaymentReceipt } = await import(
        "./receipts"
      );
      if (event.result.status === "PAID") {
        await sendPaymentReceipt(payment.id);
      } else if (event.result.status === "FAILED") {
        await sendPaymentFailureNotice(payment.id);
      }
    }

    return { duplicate: false as const, matched: true as const, outcome };
  } catch (error) {
    await prisma.paymentEvent.update({
      where: { id: stored.id },
      data: { error: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}

export async function expireStalePayments(now = new Date()) {
  const stale = await prisma.payment.findMany({
    where: {
      status: { in: ["PENDING", "PROCESSING"] },
      expiresAt: { lt: now },
    },
    select: { id: true, bookingId: true },
  });

  if (stale.length === 0) return 0;

  const { count } = await prisma.payment.updateMany({
    where: { id: { in: stale.map((payment) => payment.id) } },
    data: { status: "FAILED", failureReason: "Payment request timed out" },
  });

  const bookingIds = [
    ...new Set(
      stale
        .map((payment) => payment.bookingId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  for (const bookingId of bookingIds) {
    await prisma.$transaction(async (tx) => {
      await applyFailureToTarget(tx, { bookingId, status: "FAILED" });
    });
  }

  return count;
}

export async function failPayment(paymentId: string, reason: string) {
  const result = await prisma.payment.updateMany({
    where: { id: paymentId, status: { in: ["PENDING", "PROCESSING"] } },
    data: { status: "FAILED", failureReason: reason },
  });

  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (payment?.bookingId) {
    await prisma.$transaction(async (tx) => {
      await applyFailureToTarget(tx, payment);
    });
  }

  return result;
}
