"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { TIME_SLOTS } from "@/features/public/booking/lib/schedule";
import {
  addNairobiDays,
  isStartTaken,
  nairobiWeekStart,
  nairobiYmd,
  parseSlotMinutes,
  sessionMinutes,
  type HeldSlot,
} from "@/features/public/booking/lib/slots";
import {
  blockCalendarSlot,
  unblockCalendarSlot,
} from "@/server/actions/operations";
import type { ActionResult } from "@/server/result";

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

export type CalendarServiceOption = {
  slug: string;
  title: string;
};

const WEEKDAY_COLUMNS = [
  { weekday: 1, short: "Mon", long: "Monday" },
  { weekday: 2, short: "Tue", long: "Tuesday" },
  { weekday: 3, short: "Wed", long: "Wednesday" },
  { weekday: 4, short: "Thu", long: "Thursday" },
  { weekday: 5, short: "Fri", long: "Friday" },
  { weekday: 6, short: "Sat", long: "Saturday" },
] as const;

const EMPTY_FORM = {
  serviceSlug: "",
  clientName: "",
  clientEmail: "",
  clientPhone: "",
  sessionMode: "IN_PERSON" as "IN_PERSON" | "ONLINE" | "PHONE",
  notes: "",
};

function occupantAt(
  occupants: CalendarOccupant[],
  weekday: number,
  time: string,
): CalendarOccupant | null {
  const start = parseSlotMinutes(time);
  if (start === null) return null;
  const held: HeldSlot[] = occupants.flatMap((row) => {
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
  const taken = isStartTaken({
    weekday,
    startLabel: time,
    durationMin: 60,
    held,
  });
  if (!taken) return null;
  return (
    occupants.find((row) => {
      const startMin = parseSlotMinutes(row.time);
      if (startMin === null || row.weekday !== weekday) return false;
      return start >= startMin && start < startMin + sessionMinutes(row.durationMin, null);
    }) ?? occupants.find((row) => row.weekday === weekday && row.time === time) ?? null
  );
}

function formatDayNumber(isoDate: string) {
  return isoDate.slice(8);
}

function formatWeekRange(weekStart: string) {
  const end = addNairobiDays(weekStart, 5);
  const startDate = new Date(`${weekStart}T12:00:00+03:00`);
  const endDate = new Date(`${end}T12:00:00+03:00`);
  const startLabel = startDate.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Africa/Nairobi",
  });
  const endLabel = endDate.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Nairobi",
  });
  return `${startLabel} – ${endLabel}`;
}

function firstFieldError(result: ActionResult<unknown>) {
  if (result.ok) return null;
  const first = Object.values(result.fieldErrors ?? {}).flat()[0];
  return first ?? result.error;
}

type SlotTarget = {
  weekday: number;
  time: string;
  date: string;
  short: string;
  long: string;
};

export function BookingCalendar({
  occupants,
  services = [],
  bookingHrefPrefix = "/dashboard/bookings",
}: {
  occupants: CalendarOccupant[];
  services?: CalendarServiceOption[];
  bookingHrefPrefix?: string;
}) {
  const router = useRouter();
  const [weekStart, setWeekStart] = useState(() => nairobiWeekStart());
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [target, setTarget] = useState<SlotTarget | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const days = useMemo(
    () =>
      WEEKDAY_COLUMNS.map((column, index) => ({
        ...column,
        date: addNairobiDays(weekStart, index),
      })),
    [weekStart],
  );

  const today = nairobiYmd();
  const canSave =
    form.clientName.trim().length >= 2 && Boolean(form.serviceSlug);

  const closeDialog = () => {
    setTarget(null);
    setForm(EMPTY_FORM);
  };

  const run = (
    key: string,
    action: () => Promise<ActionResult<unknown>>,
    success: string,
  ) => {
    setPendingKey(key);
    startTransition(async () => {
      const result = await action();
      setPendingKey(null);
      if (result.ok) {
        toast.success(success);
        closeDialog();
        router.refresh();
      } else {
        toast.error(firstFieldError(result) ?? result.error);
      }
    });
  };

  const saveBlock = () => {
    if (!target) return;
    if (!canSave) {
      toast.error("Enter the candidate's name and session type");
      return;
    }
    const slot = target;
    const name = form.clientName.trim();
    setPendingKey(`${slot.weekday}-${slot.time}`);
    startTransition(async () => {
      const result = await blockCalendarSlot({
        date: slot.date,
        time: slot.time,
        serviceSlug: form.serviceSlug,
        clientName: form.clientName,
        clientEmail: form.clientEmail,
        clientPhone: form.clientPhone,
        sessionMode: form.sessionMode,
        notes: form.notes,
      });
      setPendingKey(null);
      if (result.ok) {
        toast.success(`${name} is booked for ${slot.short} ${slot.time}`);
        closeDialog();
        router.push(`${bookingHrefPrefix}/${result.data.id}`);
        router.refresh();
      } else {
        toast.error(firstFieldError(result) ?? result.error);
      }
    });
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-slate-200 bg-primary-soft/60 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.22em] text-primary uppercase">
            Clinic diary
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
            {formatWeekRange(weekStart)}
          </h2>
          <p className="mt-1 max-w-xl text-sm text-slate-600">
            Block an open hour with the candidate’s details. That booking then
            opens like any other reserved session.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={() => setWeekStart(addNairobiDays(weekStart, -7))}
          >
            <ChevronLeft className="size-4" />
            Previous
          </Button>
          <Button
            type="button"
            size="sm"
            className="rounded-full bg-primary text-white hover:bg-primary-deep"
            onClick={() => setWeekStart(nairobiWeekStart())}
          >
            This week
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={() => setWeekStart(addNairobiDays(weekStart, 7))}
          >
            Next
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 px-5 py-3 text-xs font-medium text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-primary" /> Booked
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-amber-500" /> Hold
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-slate-400" /> Blocked
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border border-slate-300 bg-white" /> Open
        </span>
      </div>

      <div className="overflow-x-auto px-3 pb-4">
        <table className="w-full min-w-[860px] border-separate border-spacing-1.5 text-sm">
          <thead>
            <tr>
              <th className="w-24 px-2 py-2 text-left text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
                Time
              </th>
              {days.map((day) => {
                const isToday = day.date === today;
                return (
                  <th key={day.weekday} className="px-1 py-2 text-center">
                    <div
                      className={`rounded-xl px-2 py-2 ${
                        isToday ? "bg-primary text-white" : "text-slate-700"
                      }`}
                    >
                      <div className="text-[11px] font-semibold tracking-wide uppercase">
                        {day.short}
                      </div>
                      <div className="text-lg leading-none font-semibold">
                        {formatDayNumber(day.date)}
                      </div>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {TIME_SLOTS.map((time) => (
              <tr key={time}>
                <th className="px-2 py-1 text-left text-xs font-semibold whitespace-nowrap text-slate-500">
                  {time}
                </th>
                {days.map((day) => {
                  const occupant = occupantAt(occupants, day.weekday, time);
                  const key = `${day.weekday}-${time}`;
                  const busy = isPending && pendingKey === key;

                  if (occupant?.kind === "booking") {
                    const href = occupant.hrefId
                      ? `${bookingHrefPrefix}/${occupant.hrefId}`
                      : null;
                    const inner = occupant.pending ? (
                      <div className="flex h-full min-h-16 flex-col justify-center rounded-xl bg-amber-500 px-3 py-2 text-left text-amber-950 shadow-sm">
                        <span className="text-[10px] font-semibold tracking-wide text-amber-900 uppercase">
                          Hold
                        </span>
                        <span className="truncate text-sm font-semibold">
                          {occupant.label}
                        </span>
                      </div>
                    ) : (
                      <div className="flex h-full min-h-16 flex-col justify-center rounded-xl bg-primary px-3 py-2 text-left text-white shadow-sm">
                        <span className="text-[10px] font-semibold tracking-wide text-primary-soft uppercase">
                          Booked
                        </span>
                        <span className="truncate text-sm font-semibold">
                          {occupant.label}
                        </span>
                      </div>
                    );
                    return (
                      <td key={key} className="p-0 align-top">
                        {href ? (
                          <Link href={href} className="block h-full">
                            {inner}
                          </Link>
                        ) : (
                          inner
                        )}
                      </td>
                    );
                  }

                  if (occupant?.kind === "blocked") {
                    return (
                      <td key={key} className="p-0">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Open ${day.short} at ${time}? ${occupant.label} will no longer hold this hour.`,
                              )
                            ) {
                              return;
                            }
                            run(
                              key,
                              () => unblockCalendarSlot(occupant.id),
                              `${day.short} ${time} is open`,
                            );
                          }}
                          className="flex h-full min-h-16 w-full flex-col justify-center rounded-xl bg-slate-400 px-3 py-2 text-left text-white hover:bg-slate-500 disabled:opacity-50"
                        >
                          <span className="text-[10px] font-semibold tracking-wide text-slate-100 uppercase">
                            {busy ? "Opening…" : "Blocked"}
                          </span>
                          <span className="truncate text-sm font-semibold">
                            {occupant.label}
                          </span>
                        </button>
                      </td>
                    );
                  }

                  return (
                    <td key={key} className="p-0">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          setTarget({
                            weekday: day.weekday,
                            time,
                            date: day.date,
                            short: day.short,
                            long: day.long,
                          })
                        }
                        className="flex h-full min-h-16 w-full items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-xs font-medium text-slate-400 transition hover:border-primary hover:bg-primary-soft hover:text-primary-deep disabled:opacity-50"
                      >
                        {busy ? "Saving…" : "Block"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={Boolean(target)} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-lg" showCloseButton>
          <DialogHeader>
            <DialogTitle>Reserve this hour</DialogTitle>
            <DialogDescription>
              {target
                ? `${target.long} ${target.date} at ${target.time}. Name and session type are required.`
                : "Name and session type are required."}
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              saveBlock();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="session-type">Session type</Label>
              <NativeSelect
                id="session-type"
                required
                value={form.serviceSlug}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    serviceSlug: event.target.value,
                  }))
                }
                className="h-10 w-full min-w-full"
              >
                <NativeSelectOption value="">Choose a session</NativeSelectOption>
                {services.map((service) => (
                  <NativeSelectOption key={service.slug} value={service.slug}>
                    {service.title}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="candidate-name">Candidate name</Label>
              <Input
                id="candidate-name"
                value={form.clientName}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    clientName: event.target.value,
                  }))
                }
                placeholder="Full name"
                autoFocus
                required
                className="h-10"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="candidate-email">Email (optional)</Label>
                <Input
                  id="candidate-email"
                  type="email"
                  value={form.clientEmail}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      clientEmail: event.target.value,
                    }))
                  }
                  placeholder="name@email.com"
                  className="h-10"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="candidate-phone">Phone (optional)</Label>
                <Input
                  id="candidate-phone"
                  value={form.clientPhone}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      clientPhone: event.target.value,
                    }))
                  }
                  placeholder="07xx xxx xxx"
                  className="h-10"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="session-mode">Session mode (optional)</Label>
              <NativeSelect
                id="session-mode"
                value={form.sessionMode}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    sessionMode: event.target.value as typeof form.sessionMode,
                  }))
                }
                className="h-10 w-full min-w-full"
              >
                <NativeSelectOption value="IN_PERSON">In person</NativeSelectOption>
                <NativeSelectOption value="ONLINE">Online</NativeSelectOption>
                <NativeSelectOption value="PHONE">Phone</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="session-notes">Notes (optional)</Label>
              <Textarea
                id="session-notes"
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
                placeholder="Anything the clinician should know"
                className="min-h-20"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-primary text-white hover:bg-primary-deep"
                disabled={isPending || !canSave}
              >
                {isPending ? "Saving…" : "Save booking"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
