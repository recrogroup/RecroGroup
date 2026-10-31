import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const paymentEvent = {
  create: vi.fn(),
  update: vi.fn(),
};

const payment = {
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
};

const booking = {
  findUnique: vi.fn(),
  findMany: vi.fn().mockResolvedValue([]),
  update: vi.fn(),
  delete: vi.fn(),
};

const prismaMock = {
  payment,
  paymentEvent,
  booking,
  blockedSlot: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), delete: vi.fn() },
  griefApplication: { findUnique: vi.fn(), update: vi.fn() },
  donation: { update: vi.fn() },
  $transaction: vi.fn(),
  $executeRawUnsafe: vi.fn().mockResolvedValue(0),
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

vi.mock("@/lib/payments/receipts", () => ({
  sendPaymentReceipt: vi.fn(),
  sendPaymentFailureNotice: vi.fn(),
}));

const { processEvent, settlePayment } = await import("@/lib/payments/service");

const PENDING_PAYMENT = {
  id: "pay_1",
  reference: "RP-ABCD2345",
  bookingId: "bk_1",
  griefApplicationId: null,
  donationId: null,
  status: "PROCESSING",
  amountKes: 2500,
  settledAmountKes: null,
  mpesaReceipt: null,
  mpesaCheckoutId: null,
  providerRef: "ws_CO_1",
  phone: null,
};

const EVENT = {
  dedupeKey: "dedupe-1",
  eventType: "stk_callback",
  provider: "MPESA_DARAJA" as const,
  reference: "RP-ABCD2345",
  providerRef: "ws_CO_1",
  result: {
    status: "PAID" as const,
    settledAmountKes: 2500,
    mpesaReceipt: "QA12B3C4D5",
    paidAt: new Date("2026-08-09T09:00:00.000Z"),
  },
  payload: { ok: true },
};

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "7",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn(prismaMock),
  );
});

describe("settlePayment", () => {
  it("marks a processing payment as paid and credits the booking once", async () => {
    payment.findUnique.mockResolvedValueOnce(PENDING_PAYMENT);
    payment.update.mockResolvedValueOnce({ ...PENDING_PAYMENT, status: "PAID" });
    payment.findUnique.mockResolvedValueOnce({
      ...PENDING_PAYMENT,
      status: "PAID",
      settledAmountKes: 2500,
    });
    booking.findUnique.mockResolvedValueOnce({
      id: "bk_1",
      amountKes: 5000,
      status: "REQUESTED",
    });
    payment.findMany.mockResolvedValueOnce([{ settledAmountKes: 2500, amountKes: 2500 }]);

    const result = await settlePayment("pay_1", EVENT.result);

    expect(result.applied).toBe(true);
    expect(booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amountPaidKes: 2500,
          paymentStatus: "PROCESSING",
          status: "CONFIRMED",
        }),
      }),
    );
  });

  it("marks the booking paid once settled payments cover the total", async () => {
    payment.findUnique.mockResolvedValueOnce(PENDING_PAYMENT);
    payment.update.mockResolvedValueOnce({ ...PENDING_PAYMENT, status: "PAID" });
    payment.findUnique.mockResolvedValueOnce({
      ...PENDING_PAYMENT,
      status: "PAID",
      settledAmountKes: 2500,
    });
    booking.findUnique.mockResolvedValueOnce({
      id: "bk_1",
      amountKes: 5000,
      status: "CONFIRMED",
    });
    payment.findMany.mockResolvedValueOnce([
      { settledAmountKes: 2500, amountKes: 2500 },
      { settledAmountKes: 2500, amountKes: 2500 },
    ]);

    await settlePayment("pay_1", EVENT.result);

    expect(booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amountPaidKes: 5000, paymentStatus: "PAID" }),
      }),
    );
  });

  it("refuses to re-apply an already-paid payment", async () => {
    payment.findUnique.mockResolvedValueOnce({ ...PENDING_PAYMENT, status: "PAID" });

    const result = await settlePayment("pay_1", EVENT.result);

    expect(result).toMatchObject({ applied: false, reason: "already_final" });
    expect(payment.update).not.toHaveBeenCalled();
    expect(booking.update).not.toHaveBeenCalled();
  });

  it("lets a late PAID callback correct a payment a status poll wrongly failed", async () => {
    payment.findUnique.mockResolvedValueOnce({ ...PENDING_PAYMENT, status: "FAILED" });
    payment.update.mockResolvedValueOnce({ ...PENDING_PAYMENT, status: "PAID" });
    payment.findUnique.mockResolvedValueOnce({
      ...PENDING_PAYMENT,
      status: "PAID",
      settledAmountKes: 2500,
    });
    booking.findUnique.mockResolvedValueOnce({
      id: "bk_1",
      amountKes: 5000,
      status: "REQUESTED",
    });
    payment.findMany.mockResolvedValueOnce([{ settledAmountKes: 2500, amountKes: 2500 }]);

    const result = await settlePayment("pay_1", EVENT.result);

    expect(result.applied).toBe(true);
    expect(booking.update).toHaveBeenCalled();
  });

  it("does not let a late failure overturn a settled payment", async () => {
    payment.findUnique.mockResolvedValueOnce({ ...PENDING_PAYMENT, status: "PAID" });

    const result = await settlePayment("pay_1", {
      status: "FAILED",
      failureReason: "The transaction is still under processing",
    });

    expect(result).toMatchObject({ applied: false, reason: "already_final" });
    expect(payment.update).not.toHaveBeenCalled();
  });

  it("refuses to settle a refunded payment", async () => {
    payment.findUnique.mockResolvedValueOnce({
      ...PENDING_PAYMENT,
      status: "REFUNDED",
    });

    const result = await settlePayment("pay_1", EVENT.result);

    expect(result).toMatchObject({ applied: false, reason: "already_final" });
    expect(booking.update).not.toHaveBeenCalled();
  });

  it("reports a missing payment rather than throwing", async () => {
    payment.findUnique.mockResolvedValueOnce(null);

    const result = await settlePayment("missing", EVENT.result);

    expect(result).toMatchObject({ applied: false, reason: "not_found" });
  });

  it("does not credit the target when the payment failed", async () => {
    payment.findUnique.mockResolvedValueOnce(PENDING_PAYMENT);
    payment.update.mockResolvedValueOnce({ ...PENDING_PAYMENT, status: "FAILED" });
    booking.findUnique.mockResolvedValueOnce({
      id: "bk_1",
      amountKes: 5000,
      status: "REQUESTED",
    });
    payment.findMany.mockResolvedValueOnce([]);
    payment.count.mockResolvedValueOnce(0);

    await settlePayment("pay_1", {
      status: "FAILED",
      failureReason: "Request cancelled by user",
    });

    expect(booking.delete).toHaveBeenCalledWith({ where: { id: "bk_1" } });
    expect(booking.update).not.toHaveBeenCalled();
  });
});

describe("processEvent", () => {
  it("ignores a replayed callback via the dedupe key", async () => {
    payment.findUnique.mockResolvedValueOnce(PENDING_PAYMENT);
    paymentEvent.create.mockRejectedValueOnce(uniqueViolation());

    const result = await processEvent(EVENT);

    expect(result).toEqual({ duplicate: true });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("records an unmatched event for staff reconciliation", async () => {
    payment.findUnique.mockResolvedValueOnce(null);
    payment.findFirst.mockResolvedValueOnce(null);
    paymentEvent.create.mockResolvedValueOnce({ id: "evt_1" });

    const result = await processEvent(EVENT);

    expect(result).toMatchObject({ duplicate: false, matched: false });
    expect(paymentEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ error: expect.stringContaining("No matching") }),
      }),
    );
  });

  it("falls back to the provider reference when our reference is absent", async () => {
    payment.findFirst.mockResolvedValueOnce(PENDING_PAYMENT);
    paymentEvent.create.mockResolvedValueOnce({ id: "evt_1" });
    payment.findUnique.mockResolvedValueOnce({ ...PENDING_PAYMENT, status: "PAID" });

    await processEvent({ ...EVENT, reference: null });

    expect(payment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { provider: "MPESA_DARAJA", providerRef: "ws_CO_1" },
      }),
    );
  });

  it("marks the stored event processed after a successful settlement", async () => {
    payment.findUnique.mockResolvedValueOnce(PENDING_PAYMENT);
    paymentEvent.create.mockResolvedValueOnce({ id: "evt_1" });
    payment.findUnique.mockResolvedValueOnce(PENDING_PAYMENT);
    payment.update.mockResolvedValueOnce({ ...PENDING_PAYMENT, status: "PAID" });
    payment.findUnique.mockResolvedValueOnce({
      ...PENDING_PAYMENT,
      status: "PAID",
      settledAmountKes: 2500,
    });
    booking.findUnique.mockResolvedValueOnce({
      id: "bk_1",
      amountKes: 5000,
      status: "REQUESTED",
    });
    payment.findMany.mockResolvedValueOnce([{ settledAmountKes: 2500, amountKes: 2500 }]);

    await processEvent(EVENT);

    expect(paymentEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { processed: true } }),
    );
  });
});
