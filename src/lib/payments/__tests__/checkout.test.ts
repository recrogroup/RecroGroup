import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  booking: { findUnique: vi.fn() },
  griefApplication: { findUnique: vi.fn() },
  donation: { findUnique: vi.fn() },
  payment: { findUnique: vi.fn() },
};

const createPendingPayment = vi.fn();
const markPaymentProcessing = vi.fn();
const failPayment = vi.fn();
const getProvider = vi.fn();

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/server/booking-slots", () => ({
  isSlotAvailable: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/payments/service", () => ({
  createPendingPayment,
  markPaymentProcessing,
  failPayment,
  settlePayment: vi.fn(),
}));
vi.mock("@/lib/payments/index", async () => {
  const actual = await vi.importActual<typeof import("@/lib/payments/types")>(
    "@/lib/payments/types",
  );
  return {
    getProvider,
    providerForMethod: (m: string) =>
      m === "MPESA" ? "MPESA_DARAJA" : m === "CARD" ? "PAYSTACK" : "MANUAL",
    PaymentError: actual.PaymentError,
  };
});

const { PaymentError } = await import("@/lib/payments/types");
const { isSlotAvailable } = await import("@/server/booking-slots");
const { startCheckout } = await import("@/lib/payments/checkout");

const BOOKING = {
  id: "bk_1",
  amountKes: 5000,
  depositKes: 2500,
  amountPaidKes: 0,
  clientName: "Asha Wanjiru",
  clientEmail: "asha@example.com",
  clientPhone: "0712345678",
  service: { title: "Individual Therapy" },
};

const PAYMENT = {
  id: "pay_1",
  reference: "RP-ABCD2345",
  status: "PENDING",
  amountKes: 2500,
  currency: "KES",
  purpose: "BOOKING_DEPOSIT",
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.booking.findUnique.mockResolvedValue(BOOKING);
  createPendingPayment.mockResolvedValue(PAYMENT);
});

describe("startCheckout", () => {
  it("does not create a payment when the provider is unconfigured", async () => {
    getProvider.mockImplementation(() => {
      throw new PaymentError("provider_unconfigured", "MPESA_DARAJA is not configured");
    });

    await expect(
      startCheckout({
        target: { kind: "booking", bookingId: "bk_1" },
        method: "MPESA",
        phone: "0712345678",
      }),
    ).rejects.toThrow("not configured");

    expect(createPendingPayment).not.toHaveBeenCalled();
  });

  it("marks the payment failed when the provider rejects the charge", async () => {
    getProvider.mockReturnValue({
      id: "MPESA_DARAJA",
      method: "MPESA",
      isConfigured: () => true,
      charge: vi.fn().mockRejectedValue(new Error("Daraja unreachable")),
      verify: vi.fn(),
    });

    await expect(
      startCheckout({
        target: { kind: "booking", bookingId: "bk_1" },
        method: "MPESA",
        phone: "0712345678",
      }),
    ).rejects.toThrow("Daraja unreachable");

    expect(failPayment).toHaveBeenCalledWith("pay_1", "Daraja unreachable");
    expect(markPaymentProcessing).not.toHaveBeenCalled();
  });

  it("charges the deposit and marks the payment processing on success", async () => {
    getProvider.mockReturnValue({
      id: "MPESA_DARAJA",
      method: "MPESA",
      isConfigured: () => true,
      charge: vi.fn().mockResolvedValue({
        provider: "MPESA_DARAJA",
        method: "MPESA",
        status: "PROCESSING",
        providerRef: "ws_CO_1",
        meta: { checkoutRequestId: "ws_CO_1" },
      }),
      verify: vi.fn(),
    });
    markPaymentProcessing.mockResolvedValue({ ...PAYMENT, status: "PROCESSING" });

    const result = await startCheckout({
      target: { kind: "booking", bookingId: "bk_1" },
      method: "MPESA",
      phone: "0712345678",
    });

    expect(createPendingPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        amountKes: 2500,
        purpose: "BOOKING_DEPOSIT",
        phone: "254712345678",
      }),
    );
    expect(result.reference).toBe("RP-ABCD2345");
    expect(failPayment).not.toHaveBeenCalled();
  });

  it("does not use the phone stored on the booking unless that is allowed", async () => {
    await expect(
      startCheckout({ target: { kind: "booking", bookingId: "bk_1" }, method: "MPESA" }),
    ).rejects.toMatchObject({ code: "missing_phone" });

    expect(createPendingPayment).not.toHaveBeenCalled();

    getProvider.mockImplementation(() => {
      throw new PaymentError("provider_unconfigured", "not configured");
    });

    await expect(
      startCheckout({
        target: { kind: "booking", bookingId: "bk_1" },
        method: "MPESA",
        allowStoredContact: true,
      }),
    ).rejects.toThrow("not configured");
  });

  it("rejects card and bank while they are coming soon", async () => {
    await expect(
      startCheckout({
        target: { kind: "booking", bookingId: "bk_1" },
        method: "CARD",
      }),
    ).rejects.toThrow("coming soon");

    await expect(
      startCheckout({
        target: { kind: "booking", bookingId: "bk_1" },
        method: "BANK",
      }),
    ).rejects.toThrow("coming soon");

    expect(createPendingPayment).not.toHaveBeenCalled();
    expect(getProvider).not.toHaveBeenCalled();
  });

  it("rejects an invalid M-Pesa number as a payment error", async () => {
    await expect(
      startCheckout({
        target: { kind: "booking", bookingId: "bk_1" },
        method: "MPESA",
        phone: "not-a-phone",
      }),
    ).rejects.toMatchObject({
      name: "PaymentError",
      code: "invalid_phone",
    });

    expect(createPendingPayment).not.toHaveBeenCalled();
  });

  it("refuses to charge when another booking already holds the slot", async () => {
    vi.mocked(isSlotAvailable).mockResolvedValueOnce(false);
    prismaMock.booking.findUnique.mockResolvedValue({
      ...BOOKING,
      status: "REQUESTED",
      preferredDate: new Date("2026-10-27T09:00:00.000Z"),
      preferredTime: "10:00 AM",
      durationMin: 60,
    });

    await expect(
      startCheckout({
        target: { kind: "booking", bookingId: "bk_1" },
        method: "MPESA",
        phone: "0712345678",
      }),
    ).rejects.toMatchObject({ code: "slot_taken" });

    expect(createPendingPayment).not.toHaveBeenCalled();
  });

  it("refuses to charge a fully paid booking", async () => {
    prismaMock.booking.findUnique.mockResolvedValue({
      ...BOOKING,
      amountPaidKes: 5000,
    });

    await expect(
      startCheckout({ target: { kind: "booking", bookingId: "bk_1" }, method: "MPESA" }),
    ).rejects.toThrow("fully paid");

    expect(createPendingPayment).not.toHaveBeenCalled();
  });
});
