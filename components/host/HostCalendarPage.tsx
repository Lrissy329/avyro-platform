import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/router";

import { HostShellLayout } from "@/components/host/HostShellLayout";
import { HostPageHeader } from "@/components/host/HostPageHeader";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { formatRangeSummary, startOfDay, startOfMonth } from "@/lib/dateUtils";
import { CalendarToolbar } from "@/modules/calendar/components/CalendarToolbar";
import { ReservationContextMenu } from "@/modules/calendar/components/ReservationContextMenu";
import { ReservationDrawer } from "@/modules/calendar/components/ReservationDrawer";
import type { HostCalendarView, ReservationRecord, CalendarFeed } from "@/modules/calendar/types";
import { useCalendarFeed } from "@/modules/calendar/hooks/useCalendarFeed";
import {
  getMonthRange,
  getSchedulerRange,
  navigateAnchor,
  todayAnchorForView,
} from "@/modules/calendar/utils/calendarDates";

const SchedulerView = dynamic(
  () => import("@/modules/calendar/components/SchedulerView").then((mod) => mod.SchedulerView),
  { ssr: false }
);
const HourlyView = dynamic(
  () => import("@/modules/calendar/components/HourlyView").then((mod) => mod.HourlyView),
  { ssr: false }
);
const MonthView = dynamic(
  () => import("@/modules/calendar/components/MonthView").then((mod) => mod.MonthView),
  { ssr: false }
);

export function HostCalendarPage() {
  const router = useRouter();
  const isMobile = useMediaQuery("(max-width: 767px)");

  const [view, setView] = useState<HostCalendarView>("scheduler");
  const [schedulerAnchor, setSchedulerAnchor] = useState(() => startOfDay(new Date()));
  const [hourlyAnchor, setHourlyAnchor] = useState(() => startOfDay(new Date()));
  const [monthAnchor, setMonthAnchor] = useState(() => startOfMonth(new Date()));

  const [selectedListingId, setSelectedListingId] = useState("all");
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [channelFilter, setChannelFilter] = useState("all");

  const [selectedReservation, setSelectedReservation] = useState<ReservationRecord | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    reservation: ReservationRecord | null;
  }>({ open: false, x: 0, y: 0, reservation: null });

  useEffect(() => {
    if (!isMobile) return;
    setView((prev) => (prev === "scheduler" ? "month" : prev));
  }, [isMobile]);

  const visibleRange = useMemo(() => {
    if (view === "month") return getMonthRange(monthAnchor);
    if (view === "hourly") return { start: hourlyAnchor, end: hourlyAnchor };
    return getSchedulerRange(schedulerAnchor);
  }, [hourlyAnchor, monthAnchor, schedulerAnchor, view]);

  const { feed, loading, error, refetch } = useCalendarFeed({
    start: visibleRange.start,
    end: visibleRange.end,
    listingId: selectedListingId,
    includeCancelled,
  });

  const filteredFeed = useMemo<CalendarFeed>(() => {
    if (channelFilter === "all") return feed;
    const bookings = feed.bookings.filter((booking) => {
      const channel = String(booking.channel ?? "").toLowerCase();
      if (channelFilter === "booking") {
        return channel === "booking" || channel === "bookingcom";
      }
      return channel === channelFilter;
    });
    return { ...feed, bookings };
  }, [channelFilter, feed]);

  const listingOptions = useMemo(
    () => feed.listings.map((listing) => ({ id: listing.id, label: listing.title })),
    [feed.listings]
  );

  const dateLabel = useMemo(() => {
    if (view === "month") {
      return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(monthAnchor);
    }
    if (view === "hourly") {
      return new Intl.DateTimeFormat("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(hourlyAnchor);
    }

    const range = getSchedulerRange(schedulerAnchor);
    return formatRangeSummary(range.start, range.end);
  }, [hourlyAnchor, monthAnchor, schedulerAnchor, view]);

  const handlePrev = useCallback(() => {
    if (view === "month") {
      setMonthAnchor((prev) => navigateAnchor("month", prev, -1));
      return;
    }
    if (view === "hourly") {
      setHourlyAnchor((prev) => navigateAnchor("hourly", prev, -1));
      return;
    }
    setSchedulerAnchor((prev) => navigateAnchor("scheduler", prev, -1));
  }, [view]);

  const handleNext = useCallback(() => {
    if (view === "month") {
      setMonthAnchor((prev) => navigateAnchor("month", prev, 1));
      return;
    }
    if (view === "hourly") {
      setHourlyAnchor((prev) => navigateAnchor("hourly", prev, 1));
      return;
    }
    setSchedulerAnchor((prev) => navigateAnchor("scheduler", prev, 1));
  }, [view]);

  const handleToday = useCallback(() => {
    const today = todayAnchorForView(view);
    if (view === "month") {
      setMonthAnchor(today);
      return;
    }
    if (view === "hourly") {
      setHourlyAnchor(today);
      return;
    }
    setSchedulerAnchor(today);
  }, [view]);

  const handleCopyAddress = useCallback(async (reservation: ReservationRecord) => {
    if (!reservation.address) return;
    try {
      await navigator.clipboard.writeText(reservation.address);
      setCopyStatus("Copied");
      window.setTimeout(() => setCopyStatus(null), 1500);
    } catch (err) {
      console.error("Failed to copy address", err);
    }
  }, []);

  const handleMessageGuest = useCallback(
    (reservation: ReservationRecord) => {
      if (reservation.isBlock) return;
      router.push(`/host/messages?bookingId=${reservation.id}`);
    },
    [router]
  );

  const handleViewBooking = useCallback(
    (reservation: ReservationRecord) => {
      if (reservation.isBlock) return;
      router.push(`/host/bookings/${reservation.id}`);
    },
    [router]
  );

  const handleCancelBooking = useCallback(
    async (reservation: ReservationRecord) => {
      if (reservation.isBlock) return;
      const confirmed = window.confirm("Cancel this booking? This will release the dates.");
      if (!confirmed) return;

      const response = await fetch("/api/host/bookings/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: reservation.id }),
      });

      if (!response.ok) {
        alert("Unable to cancel booking.");
        return;
      }

      await refetch();
      setSelectedReservation(null);
    },
    [refetch]
  );

  const handleBlockDates = useCallback(
    async (selection: { listingId: string; startDate: string; endDate: string }) => {
      const response = await fetch("/api/host/calendar/block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selection),
      });
      if (!response.ok) {
        alert("Failed to block dates. Please try again.");
        return;
      }
      await refetch();
    },
    [refetch]
  );

  const handleSetRate = useCallback(
    async (selection: { listingId: string; startDate: string; endDate: string }, nightlyRate: number) => {
      const response = await fetch("/api/host/calendar/rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...selection, nightlyRate }),
      });
      if (!response.ok) {
        alert("Failed to update rates. Please try again.");
        return;
      }
      await refetch();
    },
    [refetch]
  );

  const handleBlockTime = useCallback(
    async (selection: { listingId: string; startAt: string; endAt: string }) => {
      const response = await fetch("/api/host/calendar/block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selection),
      });
      if (!response.ok) {
        alert("Failed to block time. Please try again.");
        return;
      }
      await refetch();
    },
    [refetch]
  );

  const handleSetHourlyRate = useCallback(async () => {
    alert("Hourly rate editing is not configured yet.");
  }, []);

  const isDrawerOpen = Boolean(selectedReservation);

  useEffect(() => {
    if (!isDrawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isDrawerOpen]);

  return (
    <HostShellLayout title="Calendar v2" activeNav="calendar" variant="wide">
      <HostPageHeader
        title="Calendar v2"
        description="Operations calendar preview with Scheduler, Hourly, and Month views."
      />

      <div className="-mx-6 lg:-mx-8 2xl:-mx-10">
        {error ? (
          <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : null}

        <div className="min-h-[calc(100vh-11.5rem)] overflow-hidden border-y border-slate-200 bg-white">
          <CalendarToolbar
            view={view}
            onViewChange={setView}
            dateLabel={dateLabel}
            onPrev={handlePrev}
            onToday={handleToday}
            onNext={handleNext}
            listingId={selectedListingId}
            listingOptions={listingOptions}
            onListingChange={setSelectedListingId}
            includeCancelled={includeCancelled}
            onToggleCancelled={() => setIncludeCancelled((prev) => !prev)}
            channel={channelFilter}
            onChannelChange={setChannelFilter}
          />

          <div className="border-t border-slate-200">
            {loading ? (
              <div className="px-4 py-6 text-sm text-slate-500">Loading calendar…</div>
            ) : view === "scheduler" ? (
              <SchedulerView
                feed={filteredFeed}
                startDate={schedulerAnchor}
                days={14}
                selectedReservationId={selectedReservation?.id ?? null}
                onSelectReservation={setSelectedReservation}
                onOpenContextMenu={(reservation, x, y) =>
                  setContextMenu({ open: true, x, y, reservation })
                }
                onBlockDates={handleBlockDates}
                onSetRate={handleSetRate}
              />
            ) : view === "hourly" ? (
              <HourlyView
                feed={filteredFeed}
                day={hourlyAnchor}
                selectedReservationId={selectedReservation?.id ?? null}
                onSelectReservation={setSelectedReservation}
                onOpenContextMenu={(reservation, x, y) =>
                  setContextMenu({ open: true, x, y, reservation })
                }
                onBlockTime={handleBlockTime}
                onSetHourlyRate={handleSetHourlyRate}
              />
            ) : (
              <MonthView
                feed={filteredFeed}
                monthStart={startOfMonth(monthAnchor)}
                selectedReservationId={selectedReservation?.id ?? null}
                onSelectReservation={setSelectedReservation}
                onOpenContextMenu={(reservation, x, y) =>
                  setContextMenu({ open: true, x, y, reservation })
                }
              />
            )}
          </div>
        </div>
      </div>

      <ReservationDrawer
        open={Boolean(selectedReservation)}
        reservation={selectedReservation}
        onClose={() => setSelectedReservation(null)}
        onMessageGuest={handleMessageGuest}
        onViewBooking={handleViewBooking}
        onCopyAddress={handleCopyAddress}
        onCancelBooking={handleCancelBooking}
        copyStatus={copyStatus}
        mobile={isMobile}
      />

      <ReservationContextMenu
        open={contextMenu.open}
        x={contextMenu.x}
        y={contextMenu.y}
        reservation={contextMenu.reservation}
        onClose={() => setContextMenu((prev) => ({ ...prev, open: false }))}
        onMessageGuest={handleMessageGuest}
        onViewBooking={handleViewBooking}
        onCopyAddress={handleCopyAddress}
        onCancelBooking={handleCancelBooking}
      />
    </HostShellLayout>
  );
}

export default HostCalendarPage;

