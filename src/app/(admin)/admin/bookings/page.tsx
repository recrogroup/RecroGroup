import {
    AdminBookingsPage,
    type AdminBookingRow,
    type AdminTherapistOption,
} from "@/features/admin/components/admin-bookings-page";
import { requireAdminArea } from "@/features/admin/lib/admin-guard";
import { permanentSlotLabel } from "@/features/public/booking/lib/slots";
import { formatDate } from "@/features/portal/lib/format";
import { deliverUnsentBookingReceipts } from "@/lib/payments/receipts";
import { listCalendarOccupancy } from "@/server/booking-slots";
import { listBookings } from "@/server/queries/bookings";
import { listTherapists } from "@/server/queries/catalog";

export default async function BookingsPage() {
    const session = await requireAdminArea();
    await deliverUnsentBookingReceipts();

    const [bookings, therapists, occupants] = await Promise.all([
        listBookings({
            hasSuccessfulPayment: true,
            includeUnpaidConfirmed: true,
            take: 200,
        }),
        listTherapists(),
        listCalendarOccupancy(),
    ]);

    const rows: AdminBookingRow[] = bookings.items.map((booking) => ({
        id: booking.id,
        reference: booking.reference,
        clientName: booking.clientName,
        clientEmail: booking.clientEmail,
        clientPhone: booking.clientPhone,
        serviceTitle: booking.service?.title ?? null,
        therapistId: booking.therapistId,
        therapistName: booking.therapist?.fullName ?? null,
        preferredDateLabel: formatDate(booking.preferredDate),
        preferredTime: booking.preferredTime,
        slotLabel:
            booking.preferredDate && booking.preferredTime
                ? permanentSlotLabel(booking.preferredDate, booking.preferredTime)
                : null,
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        amountKes: booking.amountKes,
        amountPaidKes: booking.amountPaidKes,
        latestPaymentReference: booking.payments[0]?.reference ?? null,
        latestFailureReason: booking.payments[0]?.failureReason ?? null,
        needsNewTime: Boolean(booking.rescheduleReason),
        createdAtLabel: formatDate(booking.createdAt),
    }));

    const therapistOptions: AdminTherapistOption[] = therapists
        .filter((therapist) => therapist.isActive)
        .map((therapist) => ({
            id: therapist.id,
            fullName: therapist.fullName,
        }));

    return (
        <AdminBookingsPage
            bookings={rows}
            occupants={occupants}
            therapists={therapistOptions}
            total={bookings.total}
            isAdmin={session.role === "admin"}
        />
    );
}
