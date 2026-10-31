export const DEFAULT_SESSION_MINUTES = 60;

export const SLOT_TAKEN_MESSAGE =
  "This day and time was taken by an earlier booking. Choose a different date and time.";

export const SLOT_UNAVAILABLE_MESSAGE =
  "That day and time is already booked. Choose a different slot. A longer session also blocks the following hours.";

/** Unpaid website checkouts hold the weekday and time so a second client cannot take it. */
export const UNPAID_HOLD_MS = 5 * 60 * 1000;

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function sessionMinutes(
  bookingMinutes: number | null | undefined,
  serviceMinutes: number | null | undefined,
) {
  const value = bookingMinutes ?? serviceMinutes ?? DEFAULT_SESSION_MINUTES;
  return value > 0 ? value : DEFAULT_SESSION_MINUTES;
}

/** Recurring clinic time, such as "Every Tuesday at 10:00 AM". */
export function permanentSlotLabel(date: Date, time: string): string {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Nairobi",
    weekday: "long",
  }).format(date);
  return `Every ${weekday} at ${time}`;
}

/** Weekday in Nairobi, where clinic sessions are booked. Sunday is 0. */
export function nairobiWeekday(date: Date): number {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Nairobi",
    weekday: "short",
  }).format(date);
  return WEEKDAY_INDEX[short] ?? date.getUTCDay();
}

export function nairobiDate(isoDate: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const date = new Date(`${isoDate}T12:00:00+03:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function nairobiYmd(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Monday (YYYY-MM-DD) of the Nairobi week that contains `date`. */
export function nairobiWeekStart(date: Date | string = new Date()): string {
  const ymd = typeof date === "string" ? date : nairobiYmd(date);
  const noon = nairobiDate(ymd);
  if (!noon) return nairobiYmd();
  const weekday = nairobiWeekday(noon);
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  return nairobiYmd(new Date(noon.getTime() + mondayOffset * 86_400_000));
}

export function addNairobiDays(isoDate: string, days: number): string {
  const noon = nairobiDate(isoDate);
  if (!noon) return isoDate;
  return nairobiYmd(new Date(noon.getTime() + days * 86_400_000));
}

export function parseSlotMinutes(label: string): number | null {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(label.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3].toUpperCase();
  if (hour < 1 || hour > 12 || minute > 59) return null;
  if (meridiem === "AM") {
    if (hour === 12) hour = 0;
  } else if (hour !== 12) {
    hour += 12;
  }
  return hour * 60 + minute;
}

export function formatMinutesLabel(totalMinutes: number): string {
  const day = 24 * 60;
  const normalized = ((totalMinutes % day) + day) % day;
  const hour24 = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const meridiem = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

export function sessionEndLabel(startLabel: string, durationMin: number): string | null {
  const start = parseSlotMinutes(startLabel);
  if (start === null) return null;
  return formatMinutesLabel(start + sessionMinutes(durationMin, null));
}

export function rangesOverlap(
  startA: number,
  durationA: number,
  startB: number,
  durationB: number,
) {
  const lengthA = Math.max(1, durationA);
  const lengthB = Math.max(1, durationB);
  return startA < startB + lengthB && startB < startA + lengthA;
}

export type HeldSlot = {
  weekday: number;
  startMin: number;
  durationMin: number;
};

export function isStartTaken(input: {
  weekday: number;
  startLabel: string;
  durationMin: number;
  held: HeldSlot[];
}) {
  const start = parseSlotMinutes(input.startLabel);
  if (start === null) return false;
  const duration = sessionMinutes(input.durationMin, null);
  return input.held.some(
    (slot) =>
      slot.weekday === input.weekday &&
      rangesOverlap(start, duration, slot.startMin, slot.durationMin),
  );
}

export type SlotClaim = {
  id: string;
  weekday: number;
  startMin: number;
  durationMin: number;
  paidAtMs: number;
};

export type BookingHoldInput = {
  status: string;
  preferredDate: Date | null;
  preferredTime: string | null;
  createdAt: Date;
  amountPaidKes: number;
  paidAtMs: number | null;
  hasLivePayment: boolean;
};

/** True while a booking should keep its weekday and time off the public calendar. */
export function bookingHoldsSlot(row: BookingHoldInput, now = Date.now()) {
  if (row.status === "CANCELLED" || row.status === "COMPLETED") return false;
  if (!row.preferredDate || !row.preferredTime) return false;
  if (row.status === "CONFIRMED") return true;
  if (row.paidAtMs != null || row.amountPaidKes > 0) return true;
  if (row.hasLivePayment) return true;
  return now - row.createdAt.getTime() < UNPAID_HOLD_MS;
}

export function livePaymentOpen(
  payments: { status: string; expiresAt?: Date | null }[],
  now = Date.now(),
) {
  return payments.some(
    (payment) =>
      (payment.status === "PENDING" || payment.status === "PROCESSING") &&
      (!payment.expiresAt || payment.expiresAt.getTime() > now),
  );
}

export function earliestPaidAtMs(
  payments: { status: string; paidAt?: Date | null; createdAt: Date }[],
) {
  const paid = payments.filter((payment) => payment.status === "PAID");
  if (paid.length === 0) return null;
  return Math.min(
    ...paid.map((payment) => (payment.paidAt ?? payment.createdAt).getTime()),
  );
}

/** Earliest successful payment keeps the weekday and time. Later overlaps must move. */
export function slotWinners(claims: SlotClaim[]) {
  const sorted = [...claims].sort(
    (a, b) => a.paidAtMs - b.paidAtMs || a.id.localeCompare(b.id),
  );
  const held: SlotClaim[] = [];
  const hold = new Set<string>();
  const release = new Set<string>();

  for (const claim of sorted) {
    const clashes = held.some(
      (owner) =>
        owner.weekday === claim.weekday &&
        rangesOverlap(
          owner.startMin,
          owner.durationMin,
          claim.startMin,
          claim.durationMin,
        ),
    );
    if (clashes) {
      release.add(claim.id);
    } else {
      hold.add(claim.id);
      held.push(claim);
    }
  }

  return { hold, release };
}
