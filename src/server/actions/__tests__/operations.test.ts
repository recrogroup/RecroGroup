import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  griefApplication: { update: vi.fn() },
  inquiry: { update: vi.fn(), delete: vi.fn() },
  booking: {
    update: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
  therapist: { findUnique: vi.fn() },
  payment: { findUnique: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
  paymentEvent: { deleteMany: vi.fn() },
  appointment: { update: vi.fn(), deleteMany: vi.fn() },
  $executeRawUnsafe: vi.fn().mockResolvedValue(1),
  user: { update: vi.fn() },
};

class SlotUnavailableError extends Error {
  constructor() {
    super("That day and time is already booked.");
    this.name = "SlotUnavailableError";
  }
}

const {
  requireStaff,
  requireAdmin,
  reconcileBookingSlots,
  withSlotLock,
  assertSlotFree,
  createBlockedSlot,
  deleteBlockedSlot,
} = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  requireAdmin: vi.fn(),
  reconcileBookingSlots: vi.fn(),
  withSlotLock: vi.fn(),
  assertSlotFree: vi.fn(),
  createBlockedSlot: vi.fn(),
  deleteBlockedSlot: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/server/booking-slots", () => ({
  reconcileBookingSlots,
  withSlotLock,
  assertSlotFree,
  createBlockedSlot,
  deleteBlockedSlot,
  SlotUnavailableError,
}));

vi.mock("@/server/authz", async () => {
  const actual =
    await vi.importActual<typeof import("@/server/authz")>("@/server/authz");
  return { ...actual, requireStaff, requireAdmin };
});

const { AuthorizationError } = await import("@/server/authz");
const {
  assignTherapist,
  clearAllBookings,
  clearOldBookings,
  deleteBooking,
  deleteInquiry,
  linkPaymentToBooking,
  blockCalendarSlot,
  releaseBookingSlot,
  setGriefApplicationStatus,
  setInquiryStatus,
  unblockCalendarSlot,
} = await import("@/server/actions/operations");

const STAFF = {
  userId: "u1",
  email: "s@e.com",
  name: "Staff",
  image: null,
  role: "receptionist",
};

beforeEach(() => {
  vi.clearAllMocks();
  requireStaff.mockResolvedValue(STAFF);
  requireAdmin.mockResolvedValue({ ...STAFF, role: "admin" });
  reconcileBookingSlots.mockResolvedValue([]);
  withSlotLock.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock));
  assertSlotFree.mockResolvedValue(undefined);
});

describe("setGriefApplicationStatus", () => {
  it("updates a valid status", async () => {
    prismaMock.griefApplication.update.mockResolvedValueOnce({
      id: "g1",
      status: "ACCEPTED",
    });

    const result = await setGriefApplicationStatus("g1", "ACCEPTED");

    expect(result).toEqual({ ok: true, data: { id: "g1", status: "ACCEPTED" } });
  });

  it("rejects an unknown status without touching the database", async () => {
    const result = await setGriefApplicationStatus(
      "g1",
      "NOT_A_STATUS" as never,
    );

    expect(result.ok).toBe(false);
    expect(prismaMock.griefApplication.update).not.toHaveBeenCalled();
  });

  it("returns the authorization message when the caller is not staff", async () => {
    requireStaff.mockRejectedValueOnce(new AuthorizationError("No access"));

    const result = await setGriefApplicationStatus("g1", "ACCEPTED");

    expect(result).toEqual({ ok: false, error: "No access" });
  });

  it("does not leak internal errors to the caller", async () => {
    prismaMock.griefApplication.update.mockRejectedValueOnce(
      new Error("connect ECONNREFUSED 10.0.0.1:5432"),
    );

    const result = await setGriefApplicationStatus("g1", "ACCEPTED");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toContain("ECONNREFUSED");
  });
});

describe("setInquiryStatus", () => {
  it("rejects an unknown status", async () => {
    const result = await setInquiryStatus("i1", "BOGUS" as never);

    expect(result.ok).toBe(false);
    expect(prismaMock.inquiry.update).not.toHaveBeenCalled();
  });
});

describe("deleteInquiry", () => {
  it("removes the message for staff", async () => {
    prismaMock.inquiry.delete.mockResolvedValueOnce({ id: "i1" });

    const result = await deleteInquiry("i1");

    expect(result).toEqual({ ok: true, data: { id: "i1" } });
    expect(prismaMock.inquiry.delete).toHaveBeenCalledWith({ where: { id: "i1" } });
  });

  it("returns the authorization message when the caller is not staff", async () => {
    requireStaff.mockRejectedValueOnce(
      new AuthorizationError("You do not have access to this area"),
    );

    const result = await deleteInquiry("i1");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("You do not have access to this area");
    expect(prismaMock.inquiry.delete).not.toHaveBeenCalled();
  });
});

describe("assignTherapist", () => {
  it("assigns an active therapist", async () => {
    prismaMock.therapist.findUnique.mockResolvedValueOnce({
      id: "t1",
      isActive: true,
    });
    prismaMock.booking.update.mockResolvedValueOnce({ id: "b1", therapistId: "t1" });

    const result = await assignTherapist("b1", "t1");

    expect(result.ok).toBe(true);
  });

  it("refuses an inactive therapist", async () => {
    prismaMock.therapist.findUnique.mockResolvedValueOnce({
      id: "t1",
      isActive: false,
    });

    const result = await assignTherapist("b1", "t1");

    expect(result.ok).toBe(false);
    expect(prismaMock.booking.update).not.toHaveBeenCalled();
  });

  it("refuses a therapist that does not exist", async () => {
    prismaMock.therapist.findUnique.mockResolvedValueOnce(null);

    const result = await assignTherapist("b1", "missing");

    expect(result.ok).toBe(false);
    expect(prismaMock.booking.update).not.toHaveBeenCalled();
  });

  it("allows clearing the assignment without a lookup", async () => {
    prismaMock.booking.update.mockResolvedValueOnce({ id: "b1", therapistId: null });

    const result = await assignTherapist("b1", null);

    expect(result.ok).toBe(true);
    expect(prismaMock.therapist.findUnique).not.toHaveBeenCalled();
  });
});

describe("blockCalendarSlot", () => {
  it("blocks an open weekday and time", async () => {
    createBlockedSlot.mockResolvedValueOnce({
      id: "blk_1",
      weekday: 2,
      time: "10:00 AM",
    });

    const result = await blockCalendarSlot({ weekday: 2, time: "10:00 AM" });

    expect(result).toEqual({
      ok: true,
      data: { id: "blk_1", weekday: 2, time: "10:00 AM" },
    });
    expect(createBlockedSlot).toHaveBeenCalledWith({
      weekday: 2,
      time: "10:00 AM",
      createdById: "u1",
    });
  });

  it("refuses a time that is already taken", async () => {
    createBlockedSlot.mockRejectedValueOnce(new SlotUnavailableError());

    const result = await blockCalendarSlot({ weekday: 2, time: "10:00 AM" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/already booked or blocked/);
  });
});

describe("unblockCalendarSlot", () => {
  it("removes a staff block", async () => {
    deleteBlockedSlot.mockResolvedValueOnce({ id: "blk_1" });

    const result = await unblockCalendarSlot("blk_1");

    expect(result).toEqual({ ok: true, data: { id: "blk_1" } });
  });
});

describe("releaseBookingSlot", () => {
  it("finishes the booking so the weekly time can be booked again", async () => {
    prismaMock.booking.findUnique.mockResolvedValueOnce({
      id: "b1",
      status: "CONFIRMED",
      preferredDate: new Date("2026-09-29T00:00:00.000Z"),
      preferredTime: "10:00 AM",
    });

    const result = await releaseBookingSlot("b1");

    expect(result).toEqual({
      ok: true,
      data: { id: "b1", slotLabel: "Every Tuesday at 10:00 AM" },
    });
    expect(prismaMock.booking.update).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { status: "COMPLETED" },
    });
    expect(reconcileBookingSlots).toHaveBeenCalled();
  });

  it("leaves a finished booking unchanged", async () => {
    prismaMock.booking.findUnique.mockResolvedValueOnce({
      id: "b1",
      status: "COMPLETED",
      preferredDate: new Date("2026-09-29T00:00:00.000Z"),
      preferredTime: "10:00 AM",
    });

    const result = await releaseBookingSlot("b1");

    expect(result.ok).toBe(false);
    expect(prismaMock.booking.update).not.toHaveBeenCalled();
  });
});

describe("linkPaymentToBooking", () => {
  it("links an unsettled payment to a booking", async () => {
    prismaMock.payment.findUnique.mockResolvedValueOnce({
      id: "p1",
      status: "PENDING",
      bookingId: null,
    });
    prismaMock.booking.findUnique.mockResolvedValueOnce({ id: "b1" });
    prismaMock.payment.update.mockResolvedValueOnce({ id: "p1", bookingId: "b1" });

    const result = await linkPaymentToBooking("p1", "b1");

    expect(result.ok).toBe(true);
  });

  it("refuses to move a settled payment to a different booking", async () => {
    prismaMock.payment.findUnique.mockResolvedValueOnce({
      id: "p1",
      status: "PAID",
      bookingId: "b1",
    });

    const result = await linkPaymentToBooking("p1", "b2");

    expect(result.ok).toBe(false);
    expect(prismaMock.payment.update).not.toHaveBeenCalled();
  });

  it("allows relinking a settled payment to the same booking", async () => {
    prismaMock.payment.findUnique.mockResolvedValueOnce({
      id: "p1",
      status: "PAID",
      bookingId: "b1",
    });
    prismaMock.booking.findUnique.mockResolvedValueOnce({ id: "b1" });
    prismaMock.payment.update.mockResolvedValueOnce({ id: "p1", bookingId: "b1" });

    const result = await linkPaymentToBooking("p1", "b1");

    expect(result.ok).toBe(true);
  });

  it("reports a missing payment", async () => {
    prismaMock.payment.findUnique.mockResolvedValueOnce(null);

    const result = await linkPaymentToBooking("missing", "b1");

    expect(result.ok).toBe(false);
  });
});

describe("clearAllBookings", () => {
  it("deletes booking payments first, then every booking", async () => {
    prismaMock.payment.deleteMany.mockResolvedValueOnce({ count: 3 });
    prismaMock.booking.deleteMany.mockResolvedValueOnce({ count: 2 });

    const result = await clearAllBookings();

    expect(requireAdmin).toHaveBeenCalled();
    expect(prismaMock.payment.deleteMany).toHaveBeenCalledWith();
    expect(prismaMock.booking.deleteMany).toHaveBeenCalledWith();
    expect(result).toEqual({
      ok: true,
      data: { bookings: 2, payments: 3 },
    });
  });

  it("refuses anyone who is not an admin", async () => {
    requireAdmin.mockRejectedValueOnce(
      new AuthorizationError("Administrator access is required"),
    );

    const result = await clearAllBookings();

    expect(result).toEqual({
      ok: false,
      error: "Administrator access is required",
    });
    expect(prismaMock.payment.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.booking.deleteMany).not.toHaveBeenCalled();
  });
});

describe("deleteBooking", () => {
  it("deletes one booking, its payments, and the rows those deletes need", async () => {
    prismaMock.booking.findUnique.mockResolvedValueOnce({ id: "b1" });
    prismaMock.paymentEvent.deleteMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.appointment.deleteMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.payment.deleteMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.booking.delete.mockResolvedValueOnce({ id: "b1" });

    const result = await deleteBooking("b1");

    expect(requireAdmin).toHaveBeenCalled();
    expect(prismaMock.paymentEvent.deleteMany).toHaveBeenCalledWith({
      where: { payment: { bookingId: "b1" } },
    });
    expect(prismaMock.appointment.deleteMany).toHaveBeenCalledWith({
      where: { bookingId: "b1" },
    });
    expect(prismaMock.payment.deleteMany).toHaveBeenCalledWith({
      where: { bookingId: "b1" },
    });
    expect(prismaMock.booking.delete).toHaveBeenCalledWith({
      where: { id: "b1" },
    });
    expect(reconcileBookingSlots).toHaveBeenCalled();
    expect(result).toEqual({ ok: true, data: { id: "b1" } });
  });

  it("refuses anyone who is not an admin", async () => {
    requireAdmin.mockRejectedValueOnce(
      new AuthorizationError("Administrator access is required"),
    );

    const result = await deleteBooking("b1");

    expect(result).toEqual({
      ok: false,
      error: "Administrator access is required",
    });
    expect(prismaMock.booking.delete).not.toHaveBeenCalled();
  });

  it("reports a missing booking", async () => {
    prismaMock.booking.findUnique.mockResolvedValueOnce(null);

    const result = await deleteBooking("missing");

    expect(result).toEqual({ ok: false, error: "Booking not found" });
    expect(prismaMock.booking.delete).not.toHaveBeenCalled();
  });
});

describe("clearOldBookings", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T04:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("deletes old bookings, their payments, and the rows those deletes need", async () => {
    prismaMock.paymentEvent.deleteMany.mockResolvedValueOnce({ count: 2 });
    prismaMock.appointment.deleteMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.payment.deleteMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.booking.deleteMany.mockResolvedValueOnce({ count: 1 });

    const result = await clearOldBookings("week");

    const cutoff = new Date("2026-09-29T04:00:00.000Z");
    const purposes = ["BOOKING_DEPOSIT", "BOOKING_BALANCE", "BOOKING_FULL"];
    expect(prismaMock.paymentEvent.deleteMany).toHaveBeenCalledWith({
      where: {
        payment: {
          OR: [
            { purpose: { in: purposes }, createdAt: { lt: cutoff } },
            { booking: { createdAt: { lt: cutoff } } },
          ],
        },
      },
    });
    expect(prismaMock.appointment.deleteMany).toHaveBeenCalled();
    expect(prismaMock.payment.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { purpose: { in: purposes }, createdAt: { lt: cutoff } },
          { booking: { createdAt: { lt: cutoff } } },
        ],
      },
    });
    expect(prismaMock.booking.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { createdAt: { lt: cutoff } },
          {
            payments: {
              some: { createdAt: { lt: cutoff }, purpose: { in: purposes } },
            },
          },
        ],
      },
    });
    expect(result).toEqual({
      ok: true,
      data: { bookings: 1, payments: 1 },
    });
  });

  it("deletes bookings and booking payments older than 30 days", async () => {
    prismaMock.payment.deleteMany.mockResolvedValueOnce({ count: 4 });
    prismaMock.booking.deleteMany.mockResolvedValueOnce({ count: 2 });

    const result = await clearOldBookings("month");
    const cutoff = new Date("2026-09-06T04:00:00.000Z");

    expect(prismaMock.payment.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ createdAt: { lt: cutoff } }),
            { booking: { createdAt: { lt: cutoff } } },
          ]),
        }),
      }),
    );
    expect(prismaMock.booking.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([{ createdAt: { lt: cutoff } }]),
        }),
      }),
    );
    expect(result).toEqual({
      ok: true,
      data: { bookings: 2, payments: 4 },
    });
  });

  it("refuses anyone who is not an admin", async () => {
    requireAdmin.mockRejectedValueOnce(
      new AuthorizationError("Administrator access is required"),
    );

    const result = await clearOldBookings("week");

    expect(result.ok).toBe(false);
    expect(prismaMock.payment.deleteMany).not.toHaveBeenCalled();
  });
});
