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

const WEEKDAY_COLUMNS = [
  { weekday: 1, short: "Mon", long: "Monday" },
  { weekday: 2, short: "Tue", long: "Tuesday" },
  { weekday: 3, short: "Wed", long: "Wednesday" },
  { weekday: 4, short: "Thu", long: "Thursday" },
  { weekday: 5, short: "Fri", long: "Friday" },
  { weekday: 6, short: "Sat", long: "Saturday" },
] as const;

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

type SlotTarget = {
  weekday: number;
  time: string;
  date: string;
  short: string;
  long: string;
};

export function BookingCalendar({
  occupants,
  bookingHrefPrefix = "/dashboard/bookings",
}: {
  occupants: CalendarOccupant[];
  bookingHrefPrefix?: string;
}) {
  const router = useRouter();
  const [weekStart, setWeekStart] = useState(() => nairobiWeekStart());
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [target, setTarget] = useState<SlotTarget | null>(null);
  const [candidateName, setCandidateName] = useState("");

  const days = useMemo(
    () =>
      WEEKDAY_COLUMNS.map((column, index) => ({
        ...column,
        date: addNairobiDays(weekStart, index),
      })),
    [weekStart],
  );

  const today = nairobiYmd();

  const closeDialog = () => {
    setTarget(null);
    setCandidateName("");
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
        toast.error(result.error);
      }
    });
  };

  const saveBlock = () => {
    if (!target) return;
    const name = candidateName.trim();
    if (name.length < 2) {
      toast.error("Enter the candidate's name");
      return;
    }
    run(
      `${target.weekday}-${target.time}`,
      () =>
        blockCalendarSlot({
          weekday: target.weekday,
          time: target.time,
          name,
        }),
      `${target.short} ${target.time} is reserved for ${name}`,
    );
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-slate-200 bg-slate-50 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.22em] text-blue-700 uppercase">
            Clinic diary
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
            {formatWeekRange(weekStart)}
          </h2>
          <p className="mt-1 max-w-xl text-sm text-slate-600">
            Block an open hour for a named candidate. Booked hours stay closed
            until you free them.
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
            className="rounded-full bg-blue-700 text-white hover:bg-blue-800"
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
          <span className="size-2.5 rounded-full bg-blue-700" /> Booked
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-amber-500" /> Hold
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-slate-800" /> Blocked
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
                        isToday ? "bg-blue-700 text-white" : "text-slate-700"
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
                      <div className="flex h-full min-h-16 flex-col justify-center rounded-xl bg-blue-700 px-3 py-2 text-left text-white shadow-sm">
                        <span className="text-[10px] font-semibold tracking-wide text-blue-100 uppercase">
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
                          className="flex h-full min-h-16 w-full flex-col justify-center rounded-xl bg-slate-800 px-3 py-2 text-left text-white hover:bg-slate-900 disabled:opacity-50"
                        >
                          <span className="text-[10px] font-semibold tracking-wide text-slate-300 uppercase">
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
                        className="flex h-full min-h-16 w-full items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-xs font-medium text-slate-400 transition hover:border-blue-700 hover:bg-blue-50 hover:text-blue-800 disabled:opacity-50"
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
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle>Block this hour</DialogTitle>
            <DialogDescription>
              {target
                ? `${target.long} ${target.date} at ${target.time}. Enter the candidate’s name to reserve the slot.`
                : "Enter the candidate’s name."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="candidate-name">Candidate name</Label>
            <Input
              id="candidate-name"
              value={candidateName}
              onChange={(event) => setCandidateName(event.target.value)}
              placeholder="Full name"
              autoFocus
              className="h-10"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  saveBlock();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-blue-700 text-white hover:bg-blue-800"
              disabled={isPending || candidateName.trim().length < 2}
              onClick={saveBlock}
            >
              {isPending ? "Saving…" : "Block slot"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
