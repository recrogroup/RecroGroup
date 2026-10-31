"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, Download, Filter, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";

import type { BookingStatus } from "@prisma/client";
import { downloadCsv, toCsv } from "@/features/admin/lib/csv";
import {
  assignTherapist,
  releaseBookingSlot,
  setBookingStatus,
} from "@/server/actions/operations";
import type { ActionResult } from "@/server/result";

import {
  BookingCalendar,
  type CalendarOccupant,
} from "@/features/portal/components/booking-calendar";

import { ClearProductionDataButton } from "./clear-production-data-button";
import { AdminShell, Card, DataTable, PageHeader, StatusBadge } from "./admin-shell";

export type AdminBookingRow = {
  id: string;
  reference: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string | null;
  serviceTitle: string | null;
  therapistId: string | null;
  therapistName: string | null;
  preferredDateLabel: string;
  preferredTime: string | null;
  slotLabel: string | null;
  status: BookingStatus;
  paymentStatus: string;
  amountKes: number | null;
  amountPaidKes: number;
  latestPaymentReference: string | null;
  latestFailureReason: string | null;
  needsNewTime?: boolean;
  createdAtLabel: string;
};

export type AdminTherapistOption = {
  id: string;
  fullName: string;
};

type AdminBookingsPageProps = {
  bookings: AdminBookingRow[];
  occupants?: CalendarOccupant[];
  therapists: AdminTherapistOption[];
  total: number;
  isAdmin: boolean;
};

const STATUSES: BookingStatus[] = [
  "REQUESTED",
  "CONFIRMED",
  "COMPLETED",
  "CANCELLED",
];

const CSV_COLUMNS = [
  "Reference",
  "Client",
  "Email",
  "Phone",
  "Service",
  "Preferred date",
  "Preferred time",
  "Therapist",
  "Status",
  "Payment",
  "Amount",
  "Paid",
  "Created",
];

function humanize(value: string) {
  return value.toLowerCase().replace(/_/g, " ");
}

function statusTone(status: BookingStatus) {
  if (status === "COMPLETED") return "success" as const;
  if (status === "CONFIRMED") return "info" as const;
  if (status === "CANCELLED") return "danger" as const;
  return "warning" as const;
}

function paymentTone(status: string) {
  if (status === "PAID") return "success" as const;
  if (status === "FAILED" || status === "REFUNDED") return "danger" as const;
  if (status === "CANCELLED") return "muted" as const;
  return "warning" as const;
}

export function AdminBookingsPage({
  bookings,
  occupants = [],
  therapists,
  total,
  isAdmin,
}: AdminBookingsPageProps) {
  const [therapistFilter, setTherapistFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const rows = useMemo(
    () =>
      bookings.filter((booking) => {
        if (therapistFilter === "unassigned" && booking.therapistId !== null) {
          return false;
        }
        if (
          therapistFilter !== "all" &&
          therapistFilter !== "unassigned" &&
          booking.therapistId !== therapistFilter
        ) {
          return false;
        }
        return statusFilter === "all" || booking.status === statusFilter;
      }),
    [bookings, therapistFilter, statusFilter],
  );

  const run = (
    id: string,
    action: () => Promise<ActionResult<unknown>>,
    successMessage: string,
  ) => {
    setPendingId(id);
    startTransition(async () => {
      const result = await action();
      setPendingId(null);
      if (result.ok) {
        toast.success(successMessage);
      } else {
        toast.error(result.error);
      }
    });
  };

  const handleExport = () => {
    const csv = toCsv(
      CSV_COLUMNS,
      rows.map((row) => [
        row.reference,
        row.clientName,
        row.clientEmail,
        row.clientPhone,
        row.serviceTitle,
        row.preferredDateLabel,
        row.preferredTime,
        row.therapistName ?? "Unassigned",
        row.status,
        row.paymentStatus,
        row.amountKes,
        row.amountPaidKes,
        row.createdAtLabel,
      ]),
    );

    downloadCsv(`bookings-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  };

  return (
    <AdminShell isAdmin={isAdmin}>
      <div className="p-6 lg:p-8">
        <PageHeader
          title="Bookings"
          description="Use the calendar to see reserved hours. Click Block on an empty hour to close it; click a blocked hour to open it again."
        />

        <div className="mt-6">
          <BookingCalendar occupants={occupants} />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Filter size={18} className="text-gray-500" />
            <select
              value={therapistFilter}
              onChange={(event) => setTherapistFilter(event.target.value)}
              aria-label="Filter by therapist"
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-deep focus:ring-1 focus:ring-primary-deep focus:outline-none"
            >
              <option value="all">All Therapists</option>
              <option value="unassigned">Unassigned</option>
              {therapists.map((therapist) => (
                <option key={therapist.id} value={therapist.id}>
                  {therapist.fullName}
                </option>
              ))}
            </select>
          </div>

          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            aria-label="Filter by status"
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm capitalize focus:border-primary-deep focus:ring-1 focus:ring-primary-deep focus:outline-none"
          >
            <option value="all">All Statuses</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {humanize(status)}
              </option>
            ))}
          </select>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {isAdmin ? <ClearProductionDataButton /> : null}
            <button
              type="button"
              onClick={handleExport}
              disabled={rows.length === 0}
              className="flex items-center gap-2 rounded-lg bg-primary-deep px-4 py-2 text-sm font-semibold text-white hover:bg-primary-deep/90 disabled:opacity-50"
            >
              <Download size={16} />
              Export CSV
            </button>
          </div>
        </div>

        <Card className="mt-6">
          {rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-gray-600">
              {bookings.length === 0
                ? "No bookings yet."
                : "No bookings match the selected filters."}
            </div>
          ) : (
            <DataTable
              columns={[
                "Reference",
                "Client",
                "Service",
                "Preferred",
                "Therapist",
                "Status",
                "Payment",
                "Actions",
              ]}
              rows={rows.map((row) => {
                const busy = isPending && pendingId === row.id;

                return [
                  <span key="ref" className="font-mono text-xs">
                    {row.reference}
                  </span>,
                  <div key="client">
                    <div className="text-sm font-medium">{row.clientName}</div>
                    <div className="text-xs text-gray-600">{row.clientEmail}</div>
                    {row.clientPhone && (
                      <div className="text-xs text-gray-500">{row.clientPhone}</div>
                    )}
                  </div>,
                  <span key="service" className="text-sm">
                    {row.serviceTitle ?? "—"}
                  </span>,
                  <div key="preferred">
                    <div className="text-xs">{row.preferredDateLabel}</div>
                    <div className="text-xs text-gray-500">
                      {row.slotLabel ?? row.preferredTime ?? "—"}
                    </div>
                    {row.needsNewTime ? (
                      <div className="mt-1 text-xs text-amber-700">
                        Needs a new time
                      </div>
                    ) : null}
                  </div>,
                  <select
                    key="therapist"
                    value={row.therapistId ?? ""}
                    disabled={busy}
                    aria-label={`Therapist for ${row.reference}`}
                    onChange={(event) =>
                      run(
                        row.id,
                        () =>
                          assignTherapist(row.id, event.target.value || null),
                        event.target.value
                          ? "Therapist assigned"
                          : "Therapist unassigned",
                      )
                    }
                    className="rounded-md border border-gray-200 bg-white px-2 py-1 text-sm disabled:opacity-50"
                  >
                    <option value="">— assign —</option>
                    {therapists.map((therapist) => (
                      <option key={therapist.id} value={therapist.id}>
                        {therapist.fullName}
                      </option>
                    ))}
                  </select>,
                  <StatusBadge key="status" tone={statusTone(row.status)}>
                    {humanize(row.status)}
                  </StatusBadge>,
                  <div key="payment">
                    <StatusBadge tone={paymentTone(row.paymentStatus)}>
                      {humanize(row.paymentStatus)}
                    </StatusBadge>
                    {row.amountKes !== null && (
                      <div className="mt-1 text-xs text-gray-500">
                        {row.amountPaidKes.toLocaleString()} /{" "}
                        {row.amountKes.toLocaleString()}
                      </div>
                    )}
                    {row.latestPaymentReference && (
                      <div className="mt-1 font-mono text-xs text-gray-500">
                        {row.latestPaymentReference}
                      </div>
                    )}
                    {row.latestFailureReason && (
                      <div className="mt-1 max-w-[220px] text-xs text-red-600">
                        {row.latestFailureReason}
                      </div>
                    )}
                  </div>,
                  <div key="actions" className="flex gap-2">
                    {row.status === "REQUESTED" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          run(
                            row.id,
                            () => setBookingStatus(row.id, "CONFIRMED"),
                            "Booking confirmed",
                          )
                        }
                        className="rounded-md bg-green-100 p-2 text-green-700 hover:bg-green-200 disabled:opacity-50"
                        title="Confirm"
                      >
                        <Check size={16} />
                      </button>
                    )}
                    {(row.status === "REQUESTED" || row.status === "CONFIRMED") &&
                      row.preferredTime && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            const label = row.slotLabel ?? row.preferredTime;
                            if (
                              !window.confirm(
                                `Free ${label}? New clients will be able to book this time.`,
                              )
                            ) {
                              return;
                            }
                            run(
                              row.id,
                              () => releaseBookingSlot(row.id),
                              `${label} is free for new bookings`,
                            );
                          }}
                          className="rounded-md bg-green-100 px-2 py-1 text-xs font-medium text-green-800 hover:bg-green-200 disabled:opacity-50"
                        >
                          Free time
                        </button>
                      )}
                    {row.status !== "CANCELLED" && row.status !== "COMPLETED" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          run(
                            row.id,
                            () => setBookingStatus(row.id, "CANCELLED"),
                            "Booking cancelled",
                          )
                        }
                        className="rounded-md bg-red-100 p-2 text-red-700 hover:bg-red-200 disabled:opacity-50"
                        title="Cancel"
                      >
                        <X size={16} />
                      </button>
                    )}
                    {row.status === "CANCELLED" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          run(
                            row.id,
                            () => setBookingStatus(row.id, "REQUESTED"),
                            "Booking reopened",
                          )
                        }
                        className="rounded-md bg-gray-100 p-2 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                        title="Reopen"
                      >
                        <RotateCcw size={16} />
                      </button>
                    )}
                  </div>,
                ];
              })}
            />
          )}
        </Card>

        <div className="mt-4 text-sm text-gray-600">
          Showing {rows.length} of {total} booking(s)
        </div>
      </div>
    </AdminShell>
  );
}
