"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { ClearProductionDataButton } from "@/features/admin/components/clear-production-data-button";
import {
  BookingCalendar,
  type CalendarOccupant,
  type CalendarServiceOption,
} from "@/features/portal/components/booking-calendar";
import { PortalPageHeader } from "@/features/portal/components/portal-page-header";
import {
  StatusBadge,
  bookingStatusTone,
  paymentStatusTone,
} from "@/features/portal/components/status-badge";
import { formatKes } from "@/features/portal/lib/format";
import { releaseBookingSlot } from "@/server/actions/operations";

export type BookingRow = {
  id: string;
  reference: string;
  clientName: string;
  clientPhone: string | null;
  serviceTitle: string | null;
  preferredDateLabel: string;
  preferredTime: string | null;
  slotLabel: string | null;
  status: string;
  paymentStatus: string;
  amountKes: number | null;
  amountPaidKes: number;
  latestPaymentReference: string | null;
  latestFailureReason: string | null;
  needsNewTime?: boolean;
};

function humanize(value: string) {
  return value.toLowerCase().replace(/_/g, " ");
}

export function BookingsPanel({
  bookings,
  occupants = [],
  services = [],
  canClear = false,
}: {
  bookings: BookingRow[];
  occupants?: CalendarOccupant[];
  services?: CalendarServiceOption[];
  canClear?: boolean;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const freeTime = (row: BookingRow) => {
    const label = row.slotLabel ?? row.preferredTime ?? "this time";
    if (
      !window.confirm(
        `Free ${label}? New clients will be able to book this time.`,
      )
    ) {
      return;
    }
    setPendingId(row.id);
    startTransition(async () => {
      const result = await releaseBookingSlot(row.id);
      setPendingId(null);
      if (result.ok) toast.success(`${result.data.slotLabel} is free for new bookings`);
      else toast.error(result.error);
    });
  };

  return (
    <div className="space-y-5">
      <PortalPageHeader
        title="Bookings"
        description="The calendar shows booked hours. Block an open hour with the candidate’s details to create their booking. Website checkouts hold a slot for 5 minutes."
        actions={canClear ? <ClearProductionDataButton /> : null}
      />

      <BookingCalendar occupants={occupants} services={services} />

      <Card>
        <CardContent className="p-0">
          {bookings.length === 0 ? (
            <Empty className="py-12">
              <EmptyHeader>
                <EmptyTitle>No paid bookings yet</EmptyTitle>
                <EmptyDescription>
                  A booking appears here after the M-Pesa payment succeeds.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="divide-y divide-border">
              {bookings.map((row) => {
                const holdsSlot =
                  row.status !== "CANCELLED" &&
                  row.status !== "COMPLETED" &&
                  Boolean(row.preferredTime);
                const busy = isPending && pendingId === row.id;

                return (
                <li key={row.id} className="flex items-center gap-3 px-5 py-4">
                  <Link
                    href={`/dashboard/bookings/${row.id}`}
                    className="flex min-w-0 flex-1 items-center gap-4 rounded-md transition-colors hover:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{row.clientName}</p>
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {row.reference}
                        {row.latestPaymentReference
                          ? ` · ${row.latestPaymentReference}`
                          : ""}
                      </p>
                      <p className="mt-0.5 truncate text-sm text-muted-foreground">
                        {row.serviceTitle ?? "Session"}
                        {" · "}
                        {row.slotLabel ?? row.preferredDateLabel}
                        {row.clientPhone ? ` · ${row.clientPhone}` : ""}
                      </p>
                      {row.needsNewTime && (
                        <p className="mt-1 text-xs text-amber-700">
                          Needs a new time — this hour is held by an earlier booking.
                        </p>
                      )}
                      {row.latestFailureReason && (
                        <p className="mt-1 line-clamp-2 text-xs text-destructive">
                          {row.latestFailureReason}
                        </p>
                      )}
                    </div>
                    <div className="hidden shrink-0 flex-col items-end gap-2 sm:flex">
                      <div className="flex items-center gap-2">
                        <StatusBadge tone={bookingStatusTone(row.status)}>
                          {humanize(row.status)}
                        </StatusBadge>
                        <StatusBadge tone={paymentStatusTone(row.paymentStatus)}>
                          {humanize(row.paymentStatus)}
                        </StatusBadge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        KES {formatKes(row.amountPaidKes)}
                        {row.amountKes != null ? ` / ${formatKes(row.amountKes)}` : ""}
                      </p>
                    </div>
                    <StatusBadge
                      className="sm:hidden"
                      tone={paymentStatusTone(row.paymentStatus)}
                    >
                      {humanize(row.paymentStatus)}
                    </StatusBadge>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                  {holdsSlot ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => freeTime(row)}
                    >
                      {busy ? "Freeing…" : "Free time"}
                    </Button>
                  ) : row.status === "COMPLETED" && row.preferredTime ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      Time free
                    </span>
                  ) : null}
                </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
