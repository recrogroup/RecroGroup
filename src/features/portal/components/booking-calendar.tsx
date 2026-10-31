"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  { weekday: 1, short: "Mon" },
  { weekday: 2, short: "Tue" },
  { weekday: 3, short: "Wed" },
  { weekday: 4, short: "Thu" },
  { weekday: 5, short: "Fri" },
  { weekday: 6, short: "Sat" },
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

  const days = useMemo(
    () =>
      WEEKDAY_COLUMNS.map((column, index) => ({
        ...column,
        date: addNairobiDays(weekStart, index),
      })),
    [weekStart],
  );

  const today = nairobiYmd();

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
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Calendar</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Click <strong>Block</strong> on an empty hour to close it. Clients
              cannot book a blocked or already-taken time. Click a blocked hour
              to open it again.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setWeekStart(addNairobiDays(weekStart, -7))}
            >
              <ChevronLeft className="size-4" />
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setWeekStart(nairobiWeekStart())}
            >
              This week
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setWeekStart(addNairobiDays(weekStart, 7))}
            >
              Next
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-primary/80" /> Booked
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-amber-400" /> Checkout hold (5 min)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-slate-400" /> Blocked
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm border border-border bg-background" /> Open
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr>
                <th className="w-24 border-b border-border px-2 py-2 text-left font-medium text-muted-foreground">
                  Time
                </th>
                {days.map((day) => (
                  <th
                    key={day.weekday}
                    className={`border-b border-border px-2 py-2 text-left font-medium ${
                      day.date === today ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    <div>{day.short}</div>
                    <div className="text-xs font-normal">{day.date.slice(5)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TIME_SLOTS.map((time) => (
                <tr key={time}>
                  <th className="border-b border-border px-2 py-2 text-left text-xs font-medium text-muted-foreground">
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
                      const body = (
                        <span className="block truncate font-medium">
                          {occupant.label}
                          {occupant.pending ? " · hold" : ""}
                        </span>
                      );
                      return (
                        <td key={key} className="border-b border-border p-1">
                          <div className="rounded-md bg-primary/15 px-2 py-2 text-xs text-foreground">
                            {href ? (
                              <Link href={href} className="hover:underline">
                                {body}
                              </Link>
                            ) : (
                              body
                            )}
                          </div>
                        </td>
                      );
                    }

                    if (occupant?.kind === "blocked") {
                      return (
                        <td key={key} className="border-b border-border p-1">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              if (
                                !window.confirm(
                                  `Unblock ${day.short} at ${time}? Clients will be able to book this slot.`,
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
                            className="w-full rounded-md bg-slate-200 px-2 py-2 text-left text-xs text-slate-800 hover:bg-slate-300 disabled:opacity-50"
                          >
                            {busy ? "Opening…" : "Blocked — click to open"}
                          </button>
                        </td>
                      );
                    }

                    return (
                      <td key={key} className="border-b border-border p-1">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Block ${day.short} at ${time}? Clients will not be able to book this slot until you open it.`,
                              )
                            ) {
                              return;
                            }
                            run(
                              key,
                              () =>
                                blockCalendarSlot({
                                  weekday: day.weekday,
                                  time,
                                }),
                              `${day.short} ${time} is blocked`,
                            );
                          }}
                          className="w-full rounded-md border border-dashed border-border px-2 py-2 text-left text-xs text-muted-foreground hover:border-primary hover:text-foreground disabled:opacity-50"
                        >
                          {busy ? "Blocking…" : "Block"}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
