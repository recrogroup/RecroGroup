// A booking owns its weekday + start time in Nairobi until it is
// COMPLETED or CANCELLED. Paid bookings keep the slot. Unpaid checkouts
// hold it for UNPAID_HOLD_MS so two clients cannot pay for the same hour.
// Staff can also block a weekday and time. See HANDOVER.md.
import type { Prisma, PrismaClient } from "@prisma/client";

import { TIME_SLOTS, isTimeSlot } from "@/features/public/booking/lib/schedule";
import {
  SLOT_TAKEN_MESSAGE,
  SLOT_UNAVAILABLE_MESSAGE,
  UNPAID_HOLD_MS,
  bookingHoldsSlot,
  earliestPaidAtMs,
  isStartTaken,
  livePaymentOpen,
  addNairobiDays,
  nairobiDate,
  nairobiWeekday,
  parseSlotMinutes,
  sessionMinutes,
  slotWinners,
  type HeldSlot,
  type SlotClaim,
} from "@/features/public/booking/lib/slots";
import { ensurePaymentsSchema } from "@/lib/payments/ensure-schema";
import { prisma } from "@/lib/prisma";

type SlotClient = Prisma.TransactionClient | PrismaClient;

const SLOT_LOCK_KEY = 87201631;

export function ensureSlotColumns() {
  return ensurePaymentsSchema();
}

const activeWhere = {
  status: { notIn: ["CANCELLED", "COMPLETED"] as ("CANCELLED" | "COMPLETED")[] },
  preferredDate: { not: null },
  preferredTime: { not: null },
};

const bookingSlotSelect = {
  id: true,
  status: true,
  preferredDate: true,
  preferredTime: true,
  durationMin: true,
  rescheduleReason: true,
  createdAt: true,
  amountPaidKes: true,
  clientName: true,
  reference: true,
  paymentStatus: true,
  service: { select: { durationMin: true } },
  payments: {
    select: {
      status: true,
      paidAt: true,
      createdAt: true,
      expiresAt: true,
    },
  },
} satisfies Prisma.BookingSelect;

type SlotBookingRow = Prisma.BookingGetPayload<{ select: typeof bookingSlotSelect }>;

export async function withSlotLock<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  await ensureSlotColumns();
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SLOT_LOCK_KEY})`;
    await expireStaleHolds(tx);
    return fn(tx);
  });
}

export async function expireStaleHolds(db: SlotClient = prisma) {
  const cutoff = new Date(Date.now() - UNPAID_HOLD_MS);
  await db.booking.updateMany({
    where: {
      status: "REQUESTED",
      amountPaidKes: 0,
      createdAt: { lt: cutoff },
      payments: {
        none: { status: { in: ["PAID", "PROCESSING"] } },
      },
    },
    data: { status: "CANCELLED" },
  });
}

async function loadBookingRows(db: SlotClient) {
  return db.booking.findMany({
    where: activeWhere,
    select: bookingSlotSelect,
  });
}

function claimFromRow(row: SlotBookingRow, paidAtMs: number): SlotClaim | null {
  if (!row.preferredDate || !row.preferredTime) return null;
  const startMin = parseSlotMinutes(row.preferredTime);
  if (startMin === null) return null;
  return {
    id: row.id,
    weekday: nairobiWeekday(row.preferredDate),
    startMin,
    durationMin: sessionMinutes(row.durationMin, row.service?.durationMin),
    paidAtMs,
  };
}

function paidClaims(rows: SlotBookingRow[]) {
  const claims: SlotClaim[] = [];
  for (const row of rows) {
    const paidAtMs = earliestPaidAtMs(row.payments);
    if (paidAtMs == null) continue;
    const claim = claimFromRow(row, paidAtMs);
    if (claim) claims.push(claim);
  }
  return claims;
}

function activeHoldSlots(
  rows: SlotBookingRow[],
  ignoreBookingId?: string,
): HeldSlot[] {
  const now = Date.now();
  const paid = paidClaims(rows);
  const { hold } = slotWinners(paid);
  const held: HeldSlot[] = [];
  const seen = new Set<string>();

  for (const claim of paid) {
    if (!hold.has(claim.id) || claim.id === ignoreBookingId) continue;
    held.push({
      weekday: claim.weekday,
      startMin: claim.startMin,
      durationMin: claim.durationMin,
    });
    seen.add(claim.id);
  }

  for (const row of rows) {
    if (row.id === ignoreBookingId || seen.has(row.id)) continue;
    if (
      !bookingHoldsSlot(
        {
          status: row.status,
          preferredDate: row.preferredDate,
          preferredTime: row.preferredTime,
          createdAt: row.createdAt,
          amountPaidKes: row.amountPaidKes,
          paidAtMs: earliestPaidAtMs(row.payments),
          hasLivePayment: livePaymentOpen(row.payments, now),
        },
        now,
      )
    ) {
      continue;
    }
    const claim = claimFromRow(row, row.createdAt.getTime());
    if (!claim) continue;
    held.push({
      weekday: claim.weekday,
      startMin: claim.startMin,
      durationMin: claim.durationMin,
    });
  }

  return held;
}

async function blockedHoldSlots(db: SlotClient): Promise<HeldSlot[]> {
  const rows = await db.blockedSlot.findMany({
    select: { weekday: true, time: true, durationMin: true },
  });
  return rows.flatMap((row) => {
    const startMin = parseSlotMinutes(row.time);
    if (startMin === null) return [];
    return [
      {
        weekday: row.weekday,
        startMin,
        durationMin: sessionMinutes(row.durationMin, null),
      },
    ];
  });
}

async function allHeldSlots(db: SlotClient, ignoreBookingId?: string) {
  const rows = await loadBookingRows(db);
  return [...activeHoldSlots(rows, ignoreBookingId), ...(await blockedHoldSlots(db))];
}

export async function reconcileBookingSlots(db: SlotClient = prisma) {
  const rows = await loadBookingRows(db);
  const claims = paidClaims(rows);
  const { hold, release } = slotWinners(claims);
  const durationById = new Map(claims.map((claim) => [claim.id, claim.durationMin]));
  const reasonById = new Map(rows.map((row) => [row.id, row.rescheduleReason]));

  const writes = [];
  for (const id of release) {
    if (reasonById.get(id) !== SLOT_TAKEN_MESSAGE) {
      writes.push(
        db.booking.update({
          where: { id },
          data: { rescheduleReason: SLOT_TAKEN_MESSAGE },
        }),
      );
    }
  }
  for (const id of hold) {
    const durationMin = durationById.get(id);
    if (reasonById.get(id) || rows.find((row) => row.id === id)?.durationMin !== durationMin) {
      writes.push(
        db.booking.update({
          where: { id },
          data: { rescheduleReason: null, durationMin },
        }),
      );
    }
  }
  await Promise.all(writes);
  return claims;
}

export async function getSlotAvailability(date: string, durationMin: number) {
  const when = nairobiDate(date);
  if (!when) return TIME_SLOTS.map((time) => ({ time, taken: true }));

  await ensureSlotColumns();
  const held = await allHeldSlots(prisma);
  const weekday = nairobiWeekday(when);
  const minutes = sessionMinutes(durationMin, null);

  return TIME_SLOTS.map((time) => ({
    time,
    taken: isStartTaken({
      weekday,
      startLabel: time,
      durationMin: minutes,
      held,
    }),
  }));
}

export async function isSlotAvailable(input: {
  date: Date;
  time: string;
  durationMin: number;
  ignoreBookingId?: string;
  db?: SlotClient;
}) {
  const db = input.db ?? prisma;
  if (input.db === undefined) await ensureSlotColumns();
  const held = await allHeldSlots(db, input.ignoreBookingId);
  return !isStartTaken({
    weekday: nairobiWeekday(input.date),
    startLabel: input.time,
    durationMin: input.durationMin,
    held,
  });
}

export async function assertSlotFree(
  db: SlotClient,
  input: {
    date: Date;
    time: string;
    durationMin: number;
    ignoreBookingId?: string;
  },
) {
  const free = await isSlotAvailable({ ...input, db });
  if (!free) throw new SlotUnavailableError();
}

export class SlotUnavailableError extends Error {
  constructor() {
    super(SLOT_UNAVAILABLE_MESSAGE);
    this.name = "SlotUnavailableError";
  }
}

export type CalendarOccupant = {
  kind: "booking" | "blocked";
  id: string;
  weekday: number;
  time: string;
  durationMin: number;
  label: string;
  pending: boolean;
  hrefId: string | null;
};

export async function listCalendarOccupancy(): Promise<CalendarOccupant[]> {
  await ensureSlotColumns();
  const [rows, blocked] = await Promise.all([
    loadBookingRows(prisma),
    prisma.blockedSlot.findMany({
      select: { id: true, weekday: true, time: true, durationMin: true, note: true },
    }),
  ]);

  const now = Date.now();
  const paid = paidClaims(rows);
  const { hold } = slotWinners(paid);
  const occupants: CalendarOccupant[] = [];

  for (const row of rows) {
    const paidAtMs = earliestPaidAtMs(row.payments);
    const keepsSlot = bookingHoldsSlot(
      {
        status: row.status,
        preferredDate: row.preferredDate,
        preferredTime: row.preferredTime,
        createdAt: row.createdAt,
        amountPaidKes: row.amountPaidKes,
        paidAtMs,
        hasLivePayment: livePaymentOpen(row.payments, now),
      },
      now,
    );
    if (!keepsSlot || !row.preferredTime) continue;
    if (paidAtMs != null && !hold.has(row.id)) continue;

    occupants.push({
      kind: "booking",
      id: row.id,
      weekday: nairobiWeekday(row.preferredDate!),
      time: row.preferredTime,
      durationMin: sessionMinutes(row.durationMin, row.service?.durationMin),
      label: row.clientName,
      pending: paidAtMs == null && row.status !== "CONFIRMED",
      hrefId: row.id,
    });
  }

  for (const row of blocked) {
    occupants.push({
      kind: "blocked",
      id: row.id,
      weekday: row.weekday,
      time: row.time,
      durationMin: sessionMinutes(row.durationMin, null),
      label: row.note?.trim() || "Blocked",
      pending: false,
      hrefId: null,
    });
  }

  return occupants;
}

export async function createBlockedSlot(input: {
  weekday: number;
  time: string;
  durationMin?: number;
  note?: string | null;
  createdById?: string | null;
}) {
  if (input.weekday < 1 || input.weekday > 6) {
    throw new Error("Choose a weekday from Monday to Saturday");
  }
  if (!isTimeSlot(input.time)) {
    throw new Error("Choose a clinic time");
  }

  return withSlotLock(async (tx) => {
    await assertSlotFree(tx, {
      date: weekdaySampleDate(input.weekday),
      time: input.time,
      durationMin: input.durationMin ?? 60,
    });

    return tx.blockedSlot.create({
      data: {
        weekday: input.weekday,
        time: input.time,
        durationMin: sessionMinutes(input.durationMin, null),
        note: input.note?.trim() || null,
        createdById: input.createdById ?? null,
      },
      select: { id: true, weekday: true, time: true },
    });
  });
}

export async function deleteBlockedSlot(id: string) {
  await ensureSlotColumns();
  return prisma.blockedSlot.delete({ where: { id }, select: { id: true } });
}

function weekdaySampleDate(weekday: number) {
  const offset = Math.min(6, Math.max(1, weekday)) - 1;
  return nairobiDate(addNairobiDays("2026-10-26", offset))!;
}
