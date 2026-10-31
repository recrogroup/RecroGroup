"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronDown } from "lucide-react";

import {
  HOME_BOOKABLE_SERVICES,
  HOME_PROGRAM_SERVICES,
  TIME_SLOTS,
  formatBookingDateLabel,
  formatWeekday,
  generateAvailableDates,
  toDateOnly,
} from "@/features/public/booking/lib/schedule";
import { listSlotAvailability } from "@/server/actions/booking";

const fieldClassName =
  "w-full cursor-pointer appearance-none rounded-xl border border-border bg-background px-4 py-3 pr-10 text-sm text-foreground transition-colors hover:border-primary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

function NativeSelect({
  id,
  name,
  value,
  onChange,
  children,
  disabled,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <select
        id={id}
        name={name}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={fieldClassName}
      >
        {children}
      </select>
      <ChevronDown
        size={16}
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}

export function HomeBookingForm({
  services = [],
}: {
  services?: { value: string; label: string }[];
}) {
  const router = useRouter();
  const sessionServices =
    services.length > 0 ? services : [...HOME_BOOKABLE_SERVICES];
  const [service, setService] = useState(sessionServices[0]?.value ?? "individual");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [availableDates, setAvailableDates] = useState<Date[]>([]);
  const [takenTimes, setTakenTimes] = useState<string[]>([]);

  useEffect(() => {
    setAvailableDates(generateAvailableDates());
  }, []);

  useEffect(() => {
    if (!date) {
      setTakenTimes([]);
      return;
    }
    let cancelled = false;
    listSlotAvailability(date, 60)
      .then((slots) => {
        if (!cancelled) {
          setTakenTimes(slots.filter((slot) => slot.taken).map((slot) => slot.time));
        }
      })
      .catch(() => {
        if (!cancelled) setTakenTimes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  useEffect(() => {
    if (time && takenTimes.includes(time)) setTime("");
  }, [time, takenTimes]);

  const dateOptions = useMemo(
    () =>
      availableDates.map((item) => ({
        value: toDateOnly(item),
        label: formatBookingDateLabel(item),
      })),
    [availableDates],
  );

  const needsSchedule = sessionServices.some((item) => item.value === service);
  const selectedDate = availableDates.find((item) => toDateOnly(item) === date);
  const weekdayLabel = selectedDate ? formatWeekday(selectedDate) : null;
  const canContinue = !needsSchedule || (Boolean(date) && Boolean(time));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!canContinue) return;

        const params = new URLSearchParams({ service });
        if (needsSchedule && date) params.set("date", date);
        if (needsSchedule && time) {
          params.set("time", time);
        }
        const query = params.toString().replace(/\+/g, "%20");
        router.push(`/booking?${query}`);
      }}
      className="flex flex-col gap-5"
    >
      <label className="block" htmlFor="home-booking-service">
        <span className="mb-3 block text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          Support type
        </span>
        <NativeSelect
          id="home-booking-service"
          name="service"
          value={service}
          onChange={(value) => {
            setService(value);
            if (!sessionServices.some((item) => item.value === value)) {
              setDate("");
              setTime("");
            }
          }}
        >
          {sessionServices.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
          {HOME_PROGRAM_SERVICES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </NativeSelect>
      </label>

      {needsSchedule && (
        <div className="grid grid-cols-2 gap-4">
          <label className="block" htmlFor="home-booking-date">
            <span className="mb-3 block text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              Preferred date
            </span>
            <NativeSelect
              id="home-booking-date"
              name="date"
              value={date}
              onChange={setDate}
            >
              <option value="">
                {dateOptions.length > 0 ? "Select a day" : "Loading dates…"}
              </option>
              {dateOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="block" htmlFor="home-booking-time">
            <span className="mb-3 block text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              Time
            </span>
            <NativeSelect
              id="home-booking-time"
              name="time"
              value={time}
              onChange={setTime}
              disabled={!date}
            >
              <option value="">{date ? "Select a time" : "Choose a date first"}</option>
              {TIME_SLOTS.map((slot) => (
                <option key={slot} value={slot} disabled={takenTimes.includes(slot)}>
                  {takenTimes.includes(slot) ? `${slot} · booked` : slot}
                </option>
              ))}
            </NativeSelect>
          </label>
        </div>
      )}

      {needsSchedule && weekdayLabel && time && (
        <p className="rounded-xl border border-border bg-primary-soft/50 px-4 py-3 text-xs leading-relaxed text-foreground">
          This becomes your permanent slot: every{" "}
          <strong>
            {weekdayLabel} at {time}
          </strong>{" "}
          until your sessions finish.
        </p>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        Online booking is for Nairobi clinic visits. Diaspora clients:{" "}
        <Link href="/contact-us" className="font-semibold text-primary-deep">
          contact us
        </Link>{" "}
        or email info@recrogroup.org.
      </p>
      <button
        type="submit"
        disabled={!canContinue}
        className="btn-primary mt-2 w-full justify-center disabled:cursor-not-allowed disabled:opacity-50"
      >
        Continue to booking <ArrowRight size={16} />
      </button>
    </form>
  );
}
