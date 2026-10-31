// Starts an M-Pesa charge for a booking, grief-camp application, or donation.
// The amount is read from the database here. The browser cannot choose it.
// allowStoredContact is true only for staff or the account that owns the record.
// See HANDOVER.md.
import "server-only";

import { Prisma } from "@prisma/client";
import type { PaymentMethod, PaymentPurpose } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { isSlotAvailable } from "@/server/booking-slots";
import { sessionMinutes } from "@/features/public/booking/lib/slots";

import { readPaymentAccessToken } from "./access-token";
import { absoluteUrl, paymentsConfig, resolveStkCallbackUrl } from "./config";
import { getProvider, providerForMethod } from "./index";
import { resolveBookingChargeAmount, resolveCampPrice } from "./pricing";
import { createPendingPayment, failPayment, markPaymentProcessing } from "./service";
import type { ChargeResult, PaymentTarget } from "./types";
import { PaymentError } from "./types";
import { assertPositiveAmount, normalizePhone } from "./utils";

export type CheckoutInput = {
  target: PaymentTarget;
  method: PaymentMethod;
  phone?: string | null;
  email?: string | null;
  name?: string | null;
  userId?: string | null;
  idempotencyKey?: string | null;
  /** Staff, or the signed-in owner, may reuse the phone stored on the record. */
  allowStoredContact?: boolean;
};

export type CheckoutResult = {
  paymentId: string;
  reference: string;
  status: string;
  amountKes: number;
  accessToken: string | null;
  redirectUrl?: string | null;
  customerMessage?: string | null;
};

type ResolvedCharge = {
  amountKes: number;
  purpose: PaymentPurpose;
  description: string;
  customer: { name?: string | null; email?: string | null; phone?: string | null };
};

function customerContact(
  input: CheckoutInput,
  stored: { name?: string | null; email?: string | null; phone?: string | null },
) {
  if (input.allowStoredContact) {
    return {
      name: input.name ?? stored.name ?? null,
      email: input.email ?? stored.email ?? null,
      phone: input.phone ?? stored.phone ?? null,
    };
  }

  return {
    name: input.name ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
  };
}

async function resolveCharge(input: CheckoutInput): Promise<ResolvedCharge> {
  switch (input.target.kind) {
    case "booking": {
      const booking = await prisma.booking.findUnique({
        where: { id: input.target.bookingId },
        include: { service: true },
      });
      if (!booking) throw new PaymentError("not_found", "Booking not found");
      if (booking.status === "CANCELLED" || booking.status === "COMPLETED") {
        throw new PaymentError(
          "slot_taken",
          "This booking is no longer holding a time. Start a new booking to choose an open slot.",
        );
      }

      if (booking.preferredDate && booking.preferredTime) {
        const slotFree = await isSlotAvailable({
          date: booking.preferredDate,
          time: booking.preferredTime,
          durationMin: sessionMinutes(booking.durationMin, booking.service?.durationMin),
          ignoreBookingId: booking.id,
        });
        if (!slotFree) {
          throw new PaymentError(
            "slot_taken",
            "That day and time is already booked. Choose a different slot before paying.",
          );
        }
      }

      const charge = resolveBookingChargeAmount(booking);
      if (charge.amountKes <= 0) {
        throw new PaymentError("already_paid", "This booking is fully paid");
      }

      return {
        amountKes: charge.amountKes,
        purpose: charge.purpose,
        description: booking.service?.title ?? "Therapy session",
        customer: customerContact(input, {
          name: booking.clientName,
          email: booking.clientEmail,
          phone: booking.clientPhone,
        }),
      };
    }

    case "griefApplication": {
      const application = await prisma.griefApplication.findUnique({
        where: { id: input.target.griefApplicationId },
      });
      if (!application) {
        throw new PaymentError("not_found", "Application not found");
      }

      const amountKes =
        application.amountKes ??
        (await resolveCampPrice({ parentAttending: application.parentAttending }))
          .totalKes;

      if (application.paymentStatus === "PAID") {
        throw new PaymentError("already_paid", "This application is already paid");
      }

      return {
        amountKes,
        purpose: "GRIEF_CAMP_FEE",
        description: "Grief camp fee",
        customer: customerContact(input, {
          name: application.parentName,
          email: application.parentEmail,
          phone: application.parentPhone,
        }),
      };
    }

    case "donation": {
      const donation = await prisma.donation.findUnique({
        where: { id: input.target.donationId },
      });
      if (!donation) throw new PaymentError("not_found", "Donation not found");

      if (donation.paymentStatus === "PAID") {
        throw new PaymentError("already_paid", "This donation is already paid");
      }

      return {
        amountKes: donation.amountKes,
        purpose: "DONATION",
        description: "Sponsor a child",
        customer: customerContact(input, {
          name: donation.donorName,
          email: donation.donorEmail,
          phone: donation.donorPhone,
        }),
      };
    }
  }
}

export async function startCheckout(
  input: CheckoutInput,
): Promise<CheckoutResult> {
  if (input.method === "CARD" || input.method === "BANK") {
    throw new PaymentError(
      "method_unavailable",
      "Card and bank payments are coming soon. Please pay with M-Pesa.",
    );
  }

  const charge = await resolveCharge(input);
  assertPositiveAmount(charge.amountKes, "Payment amount");

  const providerId = providerForMethod(input.method);

  if (input.method === "MPESA") {
    const phone = charge.customer.phone;
    if (!phone) {
      throw new PaymentError("missing_phone", "A phone number is required for M-Pesa");
    }
    try {
      charge.customer.phone = normalizePhone(phone);
    } catch {
      throw new PaymentError(
        "invalid_phone",
        "Enter a valid Kenyan M-Pesa number, e.g. 0712 345 678",
      );
    }
  }

  const adapter = getProvider(providerId);

  const payment = await createPendingPayment({
    target: input.target,
    userId: input.userId ?? null,
    method: input.method,
    provider: providerId,
    purpose: charge.purpose,
    amountKes: charge.amountKes,
    phone: charge.customer.phone,
    idempotencyKey: input.idempotencyKey ?? null,
  });

  const accessToken = readPaymentAccessToken(payment.providerMeta);

  if (payment.status !== "PENDING") {
    return {
      paymentId: payment.id,
      reference: payment.reference,
      status: payment.status,
      amountKes: payment.amountKes,
      accessToken,
    };
  }

  let result: ChargeResult;
  try {
    result = await adapter.charge({
      reference: payment.reference,
      amountKes: payment.amountKes,
      currency: payment.currency,
      purpose: payment.purpose,
      description: charge.description,
      customer: charge.customer,
      callbackUrl:
        input.method === "MPESA"
          ? resolveStkCallbackUrl()
          : absoluteUrl(
            `/api/payments/return?reference=${encodeURIComponent(payment.reference)}`,
          ),
      metadata: {
        paymentId: payment.id,
        purpose: payment.purpose,
        target: input.target.kind,
      },
    });
  } catch (error) {
    await failPayment(
      payment.id,
      error instanceof Error ? error.message : "Could not reach the payment provider",
    );
    throw error;
  }

  const expiresAt = new Date(
    Date.now() + paymentsConfig.stkTimeoutSeconds * 1000,
  );

  const updated = await markPaymentProcessing(payment.id, {
    providerRef: result.providerRef ?? null,
    expiresAt: input.method === "MPESA" ? expiresAt : null,
    providerMeta: result.meta ? (result.meta as Prisma.InputJsonValue) : null,
  });

  return {
    paymentId: updated.id,
    reference: updated.reference,
    status: updated.status,
    amountKes: updated.amountKes,
    accessToken,
    redirectUrl: result.redirectUrl ?? null,
    customerMessage: result.customerMessage ?? null,
  };
}

export async function refreshPaymentStatus(reference: string) {
  const payment = await prisma.payment.findUnique({ where: { reference } });
  if (!payment) throw new PaymentError("not_found", "Payment not found");

  if (
    payment.status === "PAID" ||
    payment.status === "FAILED" ||
    payment.status === "CANCELLED" ||
    payment.status === "REFUNDED" ||
    payment.provider === "MANUAL"
  ) {
    if (payment.status === "PAID") {
      const { sendPaymentReceipt } = await import("./receipts");
      await sendPaymentReceipt(payment.id);
    }
    return payment;
  }

  const adapter = getProvider(payment.provider);
  const result = await adapter.verify({
    reference: payment.reference,
    providerRef: payment.providerRef,
    currency: payment.currency,
  });

  if (result.status === payment.status) return payment;

  const { settlePayment } = await import("./service");
  const outcome = await settlePayment(payment.id, result);
  if (outcome.applied && result.status === "PAID") {
    const { sendPaymentReceipt } = await import("./receipts");
    await sendPaymentReceipt(payment.id);
  }
  if (outcome.applied && result.status === "FAILED") {
    const { sendPaymentFailureNotice } = await import("./receipts");
    await sendPaymentFailureNotice(payment.id);
  }
  return outcome.payment ?? payment;
}
