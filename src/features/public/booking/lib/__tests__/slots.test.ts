import { describe, expect, it } from "vitest";

import {
  UNPAID_HOLD_MS,
  bookingHoldsSlot,
  formatMinutesLabel,
  isStartTaken,
  nairobiWeekStart,
  nairobiWeekday,
  parseSlotMinutes,
  permanentSlotLabel,
  rangesOverlap,
  sessionEndLabel,
  slotWinners,
} from "../slots";

describe("session windows", () => {
  it("parses clinic time labels", () => {
    expect(parseSlotMinutes("9:00 AM")).toBe(9 * 60);
    expect(parseSlotMinutes("12:00 PM")).toBe(12 * 60);
    expect(parseSlotMinutes("1:00 PM")).toBe(13 * 60);
    expect(parseSlotMinutes("5:00 PM")).toBe(17 * 60);
  });

  it("blocks the following hour when a session runs for two hours", () => {
    const held = [{ weekday: 2, startMin: 9 * 60, durationMin: 120 }];
    expect(
      isStartTaken({
        weekday: 2,
        startLabel: "9:00 AM",
        durationMin: 60,
        held,
      }),
    ).toBe(true);
    expect(
      isStartTaken({
        weekday: 2,
        startLabel: "10:00 AM",
        durationMin: 60,
        held,
      }),
    ).toBe(true);
    expect(
      isStartTaken({
        weekday: 2,
        startLabel: "11:00 AM",
        durationMin: 60,
        held,
      }),
    ).toBe(false);
    expect(
      isStartTaken({
        weekday: 3,
        startLabel: "9:00 AM",
        durationMin: 60,
        held,
      }),
    ).toBe(false);
  });

  it("treats the session end as exclusive", () => {
    expect(rangesOverlap(9 * 60, 120, 11 * 60, 60)).toBe(false);
    expect(sessionEndLabel("9:00 AM", 120)).toBe("11:00 AM");
    expect(formatMinutesLabel(9 * 60 + 50)).toBe("9:50 AM");
  });

  it("reads Tuesday in Nairobi from a date-only instant", () => {
    expect(nairobiWeekday(new Date("2026-09-29T00:00:00.000Z"))).toBe(2);
  });

  it("names the recurring weekday and time", () => {
    expect(
      permanentSlotLabel(new Date("2026-09-29T00:00:00.000Z"), "10:00 AM"),
    ).toBe("Every Tuesday at 10:00 AM");
  });
});

describe("bookingHoldsSlot", () => {
  const base = {
    status: "REQUESTED",
    preferredDate: new Date("2026-10-27T09:00:00.000Z"),
    preferredTime: "10:00 AM",
    createdAt: new Date("2026-10-27T08:00:00.000Z"),
    amountPaidKes: 0,
    paidAtMs: null as number | null,
    hasLivePayment: false,
  };

  it("holds an unpaid checkout that is still within the hold window", () => {
    expect(
      bookingHoldsSlot(base, base.createdAt.getTime() + UNPAID_HOLD_MS - 1_000),
    ).toBe(true);
  });

  it("releases an abandoned unpaid checkout after the hold window", () => {
    expect(
      bookingHoldsSlot(base, base.createdAt.getTime() + UNPAID_HOLD_MS + 1_000),
    ).toBe(false);
  });

  it("keeps a confirmed call booking even after the unpaid window", () => {
    expect(
      bookingHoldsSlot(
        { ...base, status: "CONFIRMED" },
        base.createdAt.getTime() + UNPAID_HOLD_MS * 3,
      ),
    ).toBe(true);
  });

  it("keeps a paid booking even after the unpaid window", () => {
    expect(
      bookingHoldsSlot(
        { ...base, paidAtMs: base.createdAt.getTime(), amountPaidKes: 2500 },
        base.createdAt.getTime() + UNPAID_HOLD_MS * 3,
      ),
    ).toBe(true);
  });
});

describe("nairobiWeekStart", () => {
  it("returns the Monday of the week in Nairobi", () => {
    expect(nairobiWeekStart(new Date("2026-10-31T16:00:00.000Z"))).toBe("2026-10-26");
  });
});

describe("slotWinners", () => {
  it("keeps the earlier payment and releases the overlapping one", () => {
    const result = slotWinners([
      {
        id: "later",
        weekday: 2,
        startMin: 10 * 60,
        durationMin: 60,
        paidAtMs: 200,
      },
      {
        id: "earlier",
        weekday: 2,
        startMin: 9 * 60,
        durationMin: 120,
        paidAtMs: 100,
      },
    ]);

    expect([...result.hold]).toEqual(["earlier"]);
    expect([...result.release]).toEqual(["later"]);
  });

  it("allows the same clock time on a different weekday", () => {
    const result = slotWinners([
      {
        id: "tue",
        weekday: 2,
        startMin: 9 * 60,
        durationMin: 60,
        paidAtMs: 100,
      },
      {
        id: "wed",
        weekday: 3,
        startMin: 9 * 60,
        durationMin: 60,
        paidAtMs: 200,
      },
    ]);

    expect(result.hold.has("tue")).toBe(true);
    expect(result.hold.has("wed")).toBe(true);
    expect(result.release.size).toBe(0);
  });
});
