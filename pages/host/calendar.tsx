import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import type { GetServerSideProps } from "next";
import { useRouter } from "next/router";

import { HostShellLayout } from "@/components/host/HostShellLayout";
import { BlockDatesModal, BlockTimesModal } from "@/components/calendar/BlockDatesModal";
import { BookingDrawer } from "@/components/calendar/BookingDrawer";
import { LinearCalendar } from "@/components/calendar/LinearCalendar";
import { HourlyTimeline } from "@/components/calendar/HourlyTimeline";
import { MonthCalendar } from "@/components/calendar/MonthCalendar";
import type {
  LinearCalendarEvent,
  LinearCalendarListing,
  LinearCalendarSource,
} from "@/components/calendar/LinearCalendar";
import {
  mapHostBookingsToLinearEvents,
  mapHostBlocksToLinearEvents,
  listingsToLinearCalendar,
} from "@/lib/calendarMapping";
import type { DateRange } from "@/lib/calendarTypes";
import {
  addDays,
  addMonths,
  diffInDays,
  rangeToDates,
  startOfDay,
  startOfDayInTimeZone,
  startOfMonth,
  formatISODate,
} from "@/lib/dateUtils";
import {
  createManualBlockForRange,
  createManualBlockForTimes,
  deleteManualBlock,
  updateManualBlockNotes,
  type BlockDatesPayload,
} from "@/lib/manualBlocks";
import { supabase } from "@/lib/supabaseClient";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

type SerializableLinearEvent = Omit<LinearCalendarEvent, "start" | "end"> & {
  start: string;
  end: string;
};

type SerializableHourlyBlock = {
  id: string;
  listing_id: string;
  start_at: string;
  end_at: string;
  source?: string | null;
  label?: string | null;
  color?: string | null;
  notes?: string | null;
};

type HostCalendarPageProps = {
  listings: LinearCalendarListing[];
  events: SerializableLinearEvent[];
  hourlyBlocks: SerializableHourlyBlock[];
  hourlyBookings: SerializableLinearEvent[];
  listingBaseRates: Record<string, { price: number; currency: string }>;
};

const CHANNEL_FILTERS: Array<{ key: LinearCalendarSource; label: string }> = [
  { key: "booking", label: "Direct" },
  { key: "airbnb", label: "Airbnb" },
  { key: "vrbo", label: "Vrbo" },
  { key: "bookingcom", label: "Booking.com" },
  { key: "expedia", label: "Expedia" },
  { key: "manual", label: "Manual" },
  { key: "other", label: "Other" },
];

type CalendarView = "two-week" | "month" | "timeline";

const formatISODateInZone = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

const isMissingColumn = (error: any) => {
  const code = error?.code;
  const message = String(error?.message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("schema cache");
};

export const getServerSideProps: GetServerSideProps<HostCalendarPageProps> = async () => {
  const supabase = getSupabaseServerClient();

  let listingRows: any[] = [];
  let listingsError: any = null;

  const listingSelects = [
    "id, title, price_per_night, booking_unit, timezone",
    "id, title, price_per_night, booking_unit",
    "id, title, price_per_night",
  ];

  for (const select of listingSelects) {
    const result = await supabase
      .from("listings")
      .select(select)
      .order("created_at", { ascending: false })
      .limit(50);

    listingRows = result.data ?? [];
    listingsError = result.error;

    if (!listingsError) break;
    if (!isMissingColumn(listingsError)) break;
  }

  if (listingsError) {
    console.error("Failed to load listings for host calendar", listingsError.message);
  }

  let bookingRows: any[] = [];
  let bookingsError: any = null;
  const bookingSelects = [
    "id, listing_id, check_in_time, check_out_time, channel, status, price_total, currency, guest_full_name, stay_type",
    "id, listing_id, check_in_time, check_out_time, channel, status, price_total, currency, stay_type",
  ];

  for (const select of bookingSelects) {
    const result = await supabase
      .from("bookings")
      .select(select)
      .order("check_in_time", { ascending: true })
      .limit(200);

    bookingRows = result.data ?? [];
    bookingsError = result.error;

    if (!bookingsError) break;
    if (!isMissingColumn(bookingsError)) break;
  }

  if (bookingsError) {
    console.error("Failed to load bookings for host calendar", bookingsError.message);
  }

  let blockRows = [] as any[];
  let blocksError: any = null;

  const blocksResult = await supabase
    .from("listing_calendar_blocks")
    .select("id, listing_id, start_date, end_date, source, label, color, notes, start_at, end_at")
    .order("start_date", { ascending: true })
    .limit(500);

  blockRows = blocksResult.data ?? [];
  blocksError = blocksResult.error;

  if (blocksError && isMissingColumn(blocksError)) {
    const fallbackResult = await supabase
      .from("listing_calendar_blocks")
      .select("id, listing_id, start_date, end_date, source, label, color")
      .order("start_date", { ascending: true })
      .limit(500);

    blockRows = fallbackResult.data ?? [];
    blocksError = fallbackResult.error;
  }

  if (blocksError) {
    console.error("Failed to load calendar blocks for host calendar", blocksError.message);
  }

  const listingData = listingRows ?? [];
  const bookingsData = bookingRows ?? [];
  const blocksData = blockRows ?? [];

  const listingBookingUnits = listingData.reduce<Record<string, string | null>>((acc, listing) => {
    if (listing.id) acc[listing.id] = listing.booking_unit ?? null;
    return acc;
  }, {});

  const isHourlyBooking = (booking: any) => {
    const stayType = String(booking?.stay_type ?? "").toLowerCase();
    if (stayType === "day_use" || stayType === "split_rest") return true;
    if (booking?.listing_id) {
      return listingBookingUnits[booking.listing_id] === "hourly";
    }
    return false;
  };

  const hourlyBookingRows = bookingsData.filter((booking) => isHourlyBooking(booking));
  const nightlyBookingRows = bookingsData.filter((booking) => !isHourlyBooking(booking));

  const hourlyBlocks = blocksData.filter((block) => block.start_at && block.end_at);
  const nightlyBlocks = blocksData.filter(
    (block) => block.start_date && block.end_date && !(block.start_at && block.end_at)
  );

  const listings = listingsToLinearCalendar(listingData);
  const bookingEvents = mapHostBookingsToLinearEvents(listingData, nightlyBookingRows);
  const hourlyBookingEvents = mapHostBookingsToLinearEvents(listingData, hourlyBookingRows);
  const blockEvents = mapHostBlocksToLinearEvents(nightlyBlocks);
  const events = [...bookingEvents, ...blockEvents];
  const listingBaseRates = listingData.reduce<
    Record<string, { price: number; currency: string }>
  >((acc, row) => {
    if (row.id && row.price_per_night != null) {
      acc[row.id] = { price: Number(row.price_per_night), currency: "GBP" };
    }
    return acc;
  }, {});

  const serializableEvents: SerializableLinearEvent[] = events.map((event) => ({
    ...event,
    start: event.start.toISOString(),
    end: event.end.toISOString(),
  }));

  const serializableHourlyBlocks: SerializableHourlyBlock[] = (hourlyBlocks ?? []).map(
    (block: any) => ({
      id: block.id,
      listing_id: block.listing_id,
      start_at: block.start_at,
      end_at: block.end_at,
      source: block.source ?? null,
      label: block.label ?? null,
      color: block.color ?? null,
      notes: block.notes ?? null,
    })
  );

  const serializableHourlyBookings: SerializableLinearEvent[] = hourlyBookingEvents.map(
    (event) => ({
      ...event,
      start: event.start.toISOString(),
      end: event.end.toISOString(),
    })
  );

  return {
    props: {
      listings,
      events: serializableEvents,
      hourlyBlocks: serializableHourlyBlocks,
      hourlyBookings: serializableHourlyBookings,
      listingBaseRates,
    },
  };
};

export default function HostCalendarPage({
  listings,
  events,
  hourlyBlocks,
  hourlyBookings,
  listingBaseRates,
}: HostCalendarPageProps) {
  const router = useRouter();
  const [rangeStart, setRangeStart] = useState(() => startOfDay(new Date()));
  const rangeEnd = useMemo(() => addDays(rangeStart, 13), [rangeStart]);
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    listingId: string | null;
    range: DateRange | null;
  }>({ isOpen: false, listingId: null, range: null });
  const [showSelectionHint, setShowSelectionHint] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<LinearCalendarEvent | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [viewMode, setViewMode] = useState<CalendarView>("two-week");
  const [selectedListingId, setSelectedListingId] = useState<string>("all");
  const [monthStart, setMonthStart] = useState(() => startOfMonth(new Date()));
  const [timelineDate, setTimelineDate] = useState(() => startOfDay(new Date()));
  const [showHourlyHint, setShowHourlyHint] = useState(false);
  const [hourlyModalState, setHourlyModalState] = useState<{
    isOpen: boolean;
    listingId: string | null;
    startAt: Date | null;
    endAt: Date | null;
  }>({ isOpen: false, listingId: null, startAt: null, endAt: null });
  const [hourlyBlockError, setHourlyBlockError] = useState<string | null>(null);
  const [isBlockingHourly, setIsBlockingHourly] = useState(false);

  const hydratedEvents = useMemo<LinearCalendarEvent[]>(
    () =>
      events.map((event) => ({
        ...event,
        start: new Date(event.start),
        end: new Date(event.end),
      })),
    [events]
  );

  const [eventsState, setEventsState] = useState<LinearCalendarEvent[]>(hydratedEvents);

  useEffect(() => {
    setEventsState(hydratedEvents);
  }, [hydratedEvents]);

  const hourlyListings = useMemo(
    () => listings.filter((listing) => listing.bookingUnit === "hourly"),
    [listings]
  );
  const selectedListing = useMemo(
    () =>
      selectedListingId === "all"
        ? null
        : listings.find((listing) => listing.id === selectedListingId) ?? null,
    [listings, selectedListingId]
  );
  const canViewTimeline = useMemo(
    () =>
      selectedListingId === "all"
        ? hourlyListings.length > 0
        : selectedListing?.bookingUnit === "hourly",
    [hourlyListings, selectedListing, selectedListingId]
  );
  const visibleListings = useMemo(() => {
    if (viewMode === "timeline") {
      if (selectedListingId === "all") return hourlyListings;
      return selectedListing ? [selectedListing] : [];
    }
    if (selectedListingId === "all") return listings;
    return selectedListing ? [selectedListing] : listings;
  }, [viewMode, selectedListingId, listings, selectedListing, hourlyListings]);
  const visibleListingIds = useMemo(
    () => visibleListings.map((listing) => listing.id),
    [visibleListings]
  );
  const lastSelectionRef = useRef<string | null>(null);

  useEffect(() => {
    const selectionKey = `${selectedListingId}:${selectedListing?.bookingUnit ?? ""}`;
    if (lastSelectionRef.current === selectionKey) return;
    lastSelectionRef.current = selectionKey;
    if (viewMode === "month") return;
    if (selectedListingId === "all") return;
    if (selectedListing?.bookingUnit === "hourly") {
      setViewMode("timeline");
    } else {
      setViewMode("two-week");
    }
  }, [selectedListingId, selectedListing?.bookingUnit, viewMode]);

  useEffect(() => {
    if (viewMode === "timeline" && !canViewTimeline) {
      setViewMode("two-week");
    }
  }, [viewMode, canViewTimeline]);

  useEffect(() => {
    if (viewMode === "month") {
      setMonthStart(startOfMonth(rangeStart));
    }
  }, [viewMode, rangeStart]);

  const hydratedHourlyEvents = useMemo(() => {
    return (hourlyBlocks ?? []).map((block) => {
      const source = (block.source ?? "manual").toLowerCase();
      const mappedSource =
        source === "airbnb" ||
        source === "vrbo" ||
        source === "bookingcom" ||
        source === "expedia" ||
        source === "other"
          ? (source as LinearCalendarSource)
          : "manual";

      return {
        id: block.id,
        listingId: block.listing_id,
        start: new Date(block.start_at),
        end: new Date(block.end_at),
        label: block.label?.trim() || "Manual block",
        color: block.color ?? "#4B5563",
        textColor: "#ffffff",
        badgeLabel: "Manual block",
        source: mappedSource,
        meta: {
          kind: "block",
          isHourly: true,
          notes: block.notes ?? null,
          reason: block.notes ?? null,
        },
      } as LinearCalendarEvent;
    });
  }, [hourlyBlocks]);

  const hydratedHourlyBookings = useMemo<LinearCalendarEvent[]>(
    () =>
      (hourlyBookings ?? []).map((event) => ({
        ...event,
        start: new Date(event.start),
        end: new Date(event.end),
      })),
    [hourlyBookings]
  );

  const [hourlyEventsState, setHourlyEventsState] = useState<LinearCalendarEvent[]>(
    [...hydratedHourlyEvents, ...hydratedHourlyBookings]
  );

  useEffect(() => {
    setHourlyEventsState([...hydratedHourlyEvents, ...hydratedHourlyBookings]);
  }, [hydratedHourlyEvents, hydratedHourlyBookings]);

  const hourlyEventsScoped = useMemo(
    () => hourlyEventsState.filter((event) => visibleListingIds.includes(event.listingId)),
    [hourlyEventsState, visibleListingIds]
  );

  const hourlyIndicators = useMemo(() => {
    const map: Record<string, Record<string, boolean>> = {};
    hourlyEventsState.forEach((event) => {
      const listing = listings.find((item) => item.id === event.listingId);
      const tz = listing?.timezone ?? "Europe/London";
      const startDay = startOfDayInTimeZone(event.start, tz);
      const endDay = startOfDayInTimeZone(event.end, tz);
      for (let cursor = startDay; cursor <= endDay; cursor = addDays(cursor, 1)) {
        const key = formatISODateInZone(cursor, tz);
        if (!map[event.listingId]) map[event.listingId] = {};
        map[event.listingId][key] = true;
      }
    });
    return map;
  }, [hourlyEventsState, listings]);

  const nightlyDayStates = useMemo(() => {
    const map: Record<string, Record<string, "booked" | "manual" | "external">> = {};
    const priority: Record<string, number> = { booked: 3, manual: 2, external: 1 };
    eventsState.forEach((event) => {
      if (!visibleListingIds.includes(event.listingId)) return;
      if (event.meta?.status === "cancelled" || event.meta?.status === "declined") return;
      let state: "booked" | "manual" | "external" | null = null;
      if (event.meta?.kind === "booking") {
        state = "booked";
      } else if (event.meta?.kind === "block" && event.source === "manual") {
        state = "manual";
      } else if (event.meta?.kind === "block") {
        state = "external";
      }
      if (!state) return;
      const displayEnd = event.end > event.start ? addDays(event.end, -1) : event.end;
      rangeToDates(event.start, displayEnd).forEach((date) => {
        const iso = formatISODate(date);
        if (!map[event.listingId]) map[event.listingId] = {};
        const existing = map[event.listingId][iso];
        if (!existing || priority[state] > priority[existing]) {
          map[event.listingId][iso] = state;
        }
      });
    });
    return map;
  }, [eventsState, visibleListingIds]);

  const handleCancelBooking = useCallback(
    async (event: LinearCalendarEvent) => {
      try {
        const { error } = await supabase
          .from("bookings")
          .update({ status: "cancelled" })
          .eq("id", event.id);
        if (error) {
          throw error;
        }
        setDrawerOpen(false);
        setSelectedEvent(null);
        await router.replace(router.asPath);
      } catch (err) {
        console.error("Failed to cancel booking.", err);
        alert("Failed to cancel booking. Please try again.");
      }
    },
    [router]
  );

  const handleDeleteBlock = useCallback(
    async (event: LinearCalendarEvent) => {
      const isHourly = event.meta?.isHourly;
      const previousEvents = eventsState;
      const previousHourlyEvents = hourlyEventsState;

      if (isHourly) {
        setHourlyEventsState((prev) => prev.filter((item) => item.id !== event.id));
      } else {
        setEventsState((prev) => prev.filter((item) => item.id !== event.id));
      }

      try {
        await deleteManualBlock(event.id);
        setDrawerOpen(false);
        setSelectedEvent(null);
        void router.replace(router.asPath);
      } catch (err) {
        console.error("Failed to delete manual block.", err);
        setEventsState(previousEvents);
        setHourlyEventsState(previousHourlyEvents);
        alert("Failed to delete manual block. Please try again.");
      }
    },
    [eventsState, hourlyEventsState, router]
  );

  const handleSaveBlockNotes = useCallback(
    async (event: LinearCalendarEvent, notes: string) => {
      const trimmedNotes = notes.trim();
      const isHourly = event.meta?.isHourly;
      const previousEvents = eventsState;
      const previousHourlyEvents = hourlyEventsState;

      if (isHourly) {
        setHourlyEventsState((prev) =>
          prev.map((item) =>
            item.id === event.id
              ? {
                  ...item,
                  meta: {
                    ...item.meta,
                    notes: trimmedNotes,
                    reason: trimmedNotes,
                  },
                }
              : item
          )
        );
      } else {
        setEventsState((prev) =>
          prev.map((item) =>
            item.id === event.id
              ? {
                  ...item,
                  meta: {
                    ...item.meta,
                    notes: trimmedNotes,
                    reason: trimmedNotes,
                  },
                }
              : item
          )
        );
      }

      try {
        await updateManualBlockNotes(event.id, trimmedNotes);
        void router.replace(router.asPath);
      } catch (err) {
        console.error("Failed to save block notes.", err);
        setEventsState(previousEvents);
        setHourlyEventsState(previousHourlyEvents);
        alert("Failed to save block notes. Please try again.");
      }
    },
    [eventsState, hourlyEventsState, router]
  );

  const handleMonthDayClick = useCallback(
    (date: Date, listingId: string) => {
      const targetListingId = listingId || (selectedListingId !== "all" ? selectedListingId : null);
      if (!targetListingId) return;
      const targetListing = listings.find((listing) => listing.id === targetListingId);
      setSelectedListingId(targetListingId);
      setShowSelectionHint(false);
      setShowHourlyHint(false);
      if (targetListing?.bookingUnit === "hourly") {
        setViewMode("timeline");
        setTimelineDate(startOfDayInTimeZone(date, targetListing?.timezone ?? "Europe/London"));
      } else {
        setViewMode("two-week");
        setRangeStart(startOfDay(date));
      }
    },
    [listings, selectedListingId]
  );

  const [visibleSources, setVisibleSources] = useState<Record<
    LinearCalendarSource,
    boolean
  >>({
    booking: true,
    airbnb: true,
    vrbo: true,
    bookingcom: true,
    expedia: true,
    manual: true,
    other: true,
  });

  const scopedEvents = useMemo(
    () => eventsState.filter((event) => visibleListingIds.includes(event.listingId)),
    [eventsState, visibleListingIds]
  );

  const filteredEvents = useMemo(
    () =>
      scopedEvents.map((event) => ({
        ...event,
        visible: visibleSources[event.source] !== false,
      })),
    [scopedEvents, visibleSources]
  );

  const [ratesByListingDate, setRatesByListingDate] = useState<
    Record<string, Record<string, { price: number; currency: string }>>
  >({});

  useEffect(() => {
    const fetchRates = async () => {
      const startIso = formatISODate(rangeStart);
      const endIso = formatISODate(rangeEnd);
      const listingIds = visibleListingIds;
      if (!listingIds.length || viewMode !== "two-week") return;

      const params = new URLSearchParams({
        start: startIso,
        end: endIso,
      });
      listingIds.forEach((id) => params.append("listingId", id));

      const response = await fetch(`/api/rates?${params.toString()}`);
      if (!response.ok) {
        console.error("Failed to fetch nightly rates");
        return;
      }
      const { rates } = await response.json();
      const next: Record<string, Record<string, { price: number; currency: string }>> = {};
      const dayIsos: string[] = [];
      for (
        let cursor = startOfDay(rangeStart);
        cursor <= rangeEnd;
        cursor = addDays(cursor, 1)
      ) {
        dayIsos.push(formatISODate(cursor));
      }

      listingIds.forEach((id) => {
        next[id] = {};
        dayIsos.forEach((iso) => {
          const fromApi = rates?.[id]?.[iso];
          if (fromApi) {
            next[id][iso] = fromApi;
          } else if (listingBaseRates[id]) {
            next[id][iso] = listingBaseRates[id];
          }
        });
      });

      setRatesByListingDate(next);
    };

    fetchRates();
  }, [rangeStart, rangeEnd, visibleListingIds, viewMode, listingBaseRates]);

  const viewButtonClass = (active: boolean, disabled = false) =>
    `rounded-full border px-3 py-1 text-xs font-semibold transition ${
      active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600"
    } ${disabled ? "cursor-not-allowed opacity-40" : "hover:bg-slate-50"}`;

  const defaultListingId =
    selectedListingId === "all"
      ? viewMode === "timeline"
        ? hourlyListings[0]?.id ?? listings[0]?.id ?? null
        : listings[0]?.id ?? null
      : selectedListingId;
  const activeTimeZone =
    selectedListing?.timezone ??
    (viewMode === "timeline" ? hourlyListings[0]?.timezone : listings[0]?.timezone) ??
    "Europe/London";
  const timelineLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        day: "numeric",
        month: "short",
        timeZone: activeTimeZone,
      }).format(timelineDate),
    [timelineDate, activeTimeZone]
  );

  return (
    <HostShellLayout title="Calendar" activeNav="calendar">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Calendar &amp; reservations</h1>
          <p className="mt-1 text-sm text-slate-500">
            See all bookings, OTA feeds, and blocks in one place.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {showSelectionHint && viewMode === "two-week" && (
            <p className="text-xs text-slate-500">
              Click a start and end date (or drag across a row) to choose your manual booking.
            </p>
          )}
          {showHourlyHint && viewMode === "timeline" && (
            <p className="text-xs text-slate-500">
              Click a start and end time (or drag across a row) to block hours.
            </p>
          )}
          <div className="flex gap-3">
            <button className="rounded-full border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
              Sync calendars
            </button>
            <button
              className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              onClick={() => {
                if (viewMode === "timeline") {
                  setShowHourlyHint(true);
                  setHourlyBlockError(null);
                  setHourlyModalState({
                    isOpen: true,
                    listingId: defaultListingId,
                    startAt: null,
                    endAt: null,
                  });
                  return;
                }

                if (viewMode === "month") {
                  if (selectedListing?.bookingUnit === "hourly") {
                    setViewMode("timeline");
                    setShowHourlyHint(true);
                    setHourlyBlockError(null);
                    setHourlyModalState({
                      isOpen: true,
                      listingId: defaultListingId,
                      startAt: null,
                      endAt: null,
                    });
                  } else {
                    setViewMode("two-week");
                    setShowSelectionHint(true);
                    setBlockError(null);
                    setModalState({ isOpen: true, listingId: defaultListingId, range: null });
                  }
                  return;
                }

                setShowSelectionHint(true);
                setBlockError(null);
                setModalState({ isOpen: true, listingId: defaultListingId, range: null });
              }}
            >
              Add manual booking
            </button>
          </div>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">View</span>
          <button
            type="button"
            className={viewButtonClass(viewMode === "timeline", !canViewTimeline)}
            disabled={!canViewTimeline}
            onClick={() => {
              if (!canViewTimeline) return;
              setViewMode("timeline");
            }}
          >
            Timeline
          </button>
          <button
            type="button"
            className={viewButtonClass(viewMode === "two-week")}
            onClick={() => setViewMode("two-week")}
          >
            2-week
          </button>
          <button
            type="button"
            className={viewButtonClass(viewMode === "month")}
            onClick={() => setViewMode("month")}
          >
            Month
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Listing</span>
          <select
            value={selectedListingId}
            onChange={(event) => setSelectedListingId(event.target.value)}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600"
          >
            <option value="all">{viewMode === "timeline" ? "All hourly listings" : "All listings"}</option>
            {listings.map((listing) => (
              <option key={listing.id} value={listing.id}>
                {listing.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {viewMode === "two-week" && (
        <div className="mb-4 flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Visible window</p>
            <p className="mt-1 text-sm text-slate-800">
              {rangeStart.toDateString()} – {rangeEnd.toDateString()}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
              onClick={() => setRangeStart(startOfDay(new Date()))}
            >
              Today
            </button>
            <button
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
              onClick={() => setRangeStart((prev) => addDays(prev, -14))}
            >
              ← 2 weeks
            </button>
            <button
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
              onClick={() => setRangeStart((prev) => addDays(prev, 14))}
            >
              2 weeks →
            </button>
          </div>
        </div>
      )}

      {viewMode === "month" && (
        <div className="mb-4 flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Month view</p>
            <p className="mt-1 text-sm text-slate-800">
              {monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
              onClick={() => setMonthStart(startOfMonth(new Date()))}
            >
              This month
            </button>
            <button
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
              onClick={() => setMonthStart((prev) => addMonths(prev, -1))}
            >
              ← Prev month
            </button>
            <button
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
              onClick={() => setMonthStart((prev) => addMonths(prev, 1))}
            >
              Next month →
            </button>
          </div>
        </div>
      )}

      {viewMode === "timeline" && (
        <div className="mb-4 flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Timeline day</p>
            <p className="mt-1 text-sm text-slate-800">
              {timelineLabel}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
              onClick={() => setTimelineDate(startOfDayInTimeZone(new Date(), activeTimeZone))}
            >
              Today
            </button>
            <button
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
              onClick={() => setTimelineDate((prev) => addDays(prev, -1))}
            >
              ← Previous day
            </button>
            <button
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
              onClick={() => setTimelineDate((prev) => addDays(prev, 1))}
            >
              Next day →
            </button>
          </div>
        </div>
      )}

      {viewMode === "two-week" && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">
            Channels
          </span>
          {CHANNEL_FILTERS.map(({ key, label }) => {
            const active = visibleSources[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() =>
                  setVisibleSources((prev) => ({
                    ...prev,
                    [key]: !prev[key],
                  }))
                }
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  active
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-500"
                }`}
              >
                {label}
              </button>
            );
          })}
          <p className="text-[11px] text-slate-400">
            Hidden channels still block availability to avoid double-bookings.
          </p>
        </div>
      )}

      {(viewMode === "two-week" || viewMode === "month") && (
        <div className="mb-6 flex flex-wrap items-center gap-4 text-xs text-slate-500">
          <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Legend</span>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm border border-slate-300 bg-white" />
            <span>Available</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm bg-[#14FF62]" />
            <span>Booked</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm bg-slate-200 ring-1 ring-slate-300" />
            <span>Manual block</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm bg-slate-200 ring-1 ring-slate-300" />
            <span>External block</span>
          </div>
        </div>
      )}

      {viewMode === "two-week" && (
        <LinearCalendar
          listings={visibleListings}
          events={filteredEvents}
          startDate={rangeStart}
          endDate={rangeEnd}
          selection={
            modalState.isOpen && modalState.listingId && modalState.range
              ? { listingId: modalState.listingId, range: modalState.range }
              : null
          }
          onSelectRange={(listingId, range) => {
            setShowSelectionHint(false);
            setBlockError(null);
            setModalState({ isOpen: true, listingId, range });
          }}
          onClearSelection={() => {
            if (!modalState.isOpen) {
              setModalState({ isOpen: false, listingId: null, range: null });
              setShowSelectionHint(false);
              setBlockError(null);
            }
          }}
          ratesByListingDate={ratesByListingDate}
          hourlyIndicators={hourlyIndicators}
          onBookingClick={(event) => {
            setSelectedEvent(event);
            setDrawerOpen(true);
          }}
          onRequestRangeShift={(days) => setRangeStart((prev) => addDays(prev, days))}
        />
      )}

      {viewMode === "month" && (
        <MonthCalendar
          listings={visibleListings}
          monthStart={monthStart}
          dayStates={nightlyDayStates}
          hourlyIndicators={hourlyIndicators}
          onDayClick={handleMonthDayClick}
        />
      )}

      {viewMode === "timeline" && (
        <HourlyTimeline
          listings={visibleListings}
          events={hourlyEventsScoped}
          date={timelineDate}
          selection={
            hourlyModalState.isOpen &&
            hourlyModalState.listingId &&
            hourlyModalState.startAt &&
            hourlyModalState.endAt
              ? {
                  listingId: hourlyModalState.listingId,
                  start: hourlyModalState.startAt,
                  end: hourlyModalState.endAt,
                }
              : null
          }
          onSelectRange={(listingId, startAt, endAt) => {
            setShowHourlyHint(false);
            setHourlyBlockError(null);
            setHourlyModalState({ isOpen: true, listingId, startAt, endAt });
          }}
          onClearSelection={() => {
            if (!hourlyModalState.isOpen) {
              setHourlyModalState({ isOpen: false, listingId: null, startAt: null, endAt: null });
              setShowHourlyHint(false);
              setHourlyBlockError(null);
            }
          }}
          onBookingClick={(event) => {
            setSelectedEvent(event);
            setDrawerOpen(true);
          }}
          onRequestDayShift={(days) => setTimelineDate((prev) => addDays(prev, days))}
          timezone={activeTimeZone}
        />
      )}

      <BookingDrawer
        open={drawerOpen}
        onOpenChange={(open) => {
          setDrawerOpen(open);
          if (!open) setSelectedEvent(null);
        }}
        event={selectedEvent}
        onMessageGuest={(event) => console.debug("Message guest", event.id)}
        onModifyBooking={(event) => console.debug("Modify booking", event.id)}
        onCancelBooking={handleCancelBooking}
        onDeleteBlock={handleDeleteBlock}
        onSaveBlockNotes={handleSaveBlockNotes}
      />

      <BlockDatesModal
        open={modalState.isOpen}
        onOpenChange={(next) => {
          setBlockError(null);
          if (!next) {
            setModalState({ isOpen: false, listingId: null, range: null });
            setShowSelectionHint(false);
          }
        }}
        listingName={
          listings.find((listing) => listing.id === modalState.listingId)?.name ?? ""
        }
        dateRange={modalState.range}
        timezone="local time"
        isSubmitting={isBlocking}
        errorMessage={blockError}
        disableConfirm={!modalState.listingId || !modalState.range}
        onConfirm={async ({ label, notes, color }) => {
          if (!modalState.listingId || !modalState.range) {
            setBlockError("Select a listing and date range before confirming.");
            return;
          }
          setIsBlocking(true);
          setBlockError(null);
          const cleanedLabel = label.trim() || "Manual block";
          const trimmedNotes = notes?.trim() || "";
          const startDate = startOfDay(modalState.range.start);
          const endDate = startOfDay(modalState.range.end);
          const endExclusive = addDays(endDate, 1);
          const nights = Math.max(1, diffInDays(endDate, startDate) + 1);
          const optimisticId = `temp-${Date.now()}`;
          const optimisticEvent: LinearCalendarEvent = {
            id: optimisticId,
            listingId: modalState.listingId,
            start: startDate,
            end: endExclusive,
            label: cleanedLabel,
            color: color ?? "#4B5563",
            textColor: "#ffffff",
            badgeLabel: "Manual block",
            source: "manual",
            meta: {
              kind: "block",
              notes: trimmedNotes || null,
              reason: trimmedNotes || null,
              nights,
            },
          };

          setEventsState((prev) => [...prev, optimisticEvent]);

          try {
            const response = await createManualBlockForRange(modalState.listingId, modalState.range, {
              label: cleanedLabel,
              notes: trimmedNotes || undefined,
              color,
            });
            const inserted = response?.inserted;
            if (inserted?.id) {
              setEventsState((prev) =>
                prev.map((item) =>
                  item.id === optimisticId
                    ? {
                        ...item,
                        id: inserted.id,
                        listingId: inserted.listing_id ?? item.listingId,
                        start: inserted.start_date ? new Date(inserted.start_date) : item.start,
                        end: inserted.end_date
                          ? addDays(new Date(inserted.end_date), 1)
                          : item.end,
                        label: inserted.label ?? item.label,
                        color: inserted.color ?? item.color,
                      }
                    : item
                )
              );
            }
            setModalState({ isOpen: false, listingId: null, range: null });
            setShowSelectionHint(false);
            void router.replace(router.asPath);
          } catch (err) {
            console.error("Failed to block selected dates.", err);
            setEventsState((prev) => prev.filter((item) => item.id !== optimisticId));
            setBlockError(err instanceof Error ? err.message : "Failed to block selected dates.");
          } finally {
            setIsBlocking(false);
          }
        }}
      />

      <BlockTimesModal
        open={hourlyModalState.isOpen}
        onOpenChange={(next) => {
          setHourlyBlockError(null);
          if (!next) {
            setHourlyModalState({ isOpen: false, listingId: null, startAt: null, endAt: null });
            setShowHourlyHint(false);
          }
        }}
        listingName={
          listings.find((listing) => listing.id === hourlyModalState.listingId)?.name ?? ""
        }
        startAt={hourlyModalState.startAt}
        endAt={hourlyModalState.endAt}
        timezone={activeTimeZone}
        isSubmitting={isBlockingHourly}
        errorMessage={hourlyBlockError}
        disableConfirm={
          !hourlyModalState.listingId || !hourlyModalState.startAt || !hourlyModalState.endAt
        }
        onConfirm={async ({ label, notes, color }) => {
          if (!hourlyModalState.listingId || !hourlyModalState.startAt || !hourlyModalState.endAt) {
            setHourlyBlockError("Select a listing and time range before confirming.");
            return;
          }

          setIsBlockingHourly(true);
          setHourlyBlockError(null);
          const cleanedLabel = label.trim() || "Manual block";
          const trimmedNotes = notes?.trim() || "";
          const optimisticId = `temp-hourly-${Date.now()}`;
          const optimisticEvent: LinearCalendarEvent = {
            id: optimisticId,
            listingId: hourlyModalState.listingId,
            start: hourlyModalState.startAt,
            end: hourlyModalState.endAt,
            label: cleanedLabel,
            color: color ?? "#4B5563",
            textColor: "#ffffff",
            badgeLabel: "Manual block",
            source: "manual",
            meta: {
              kind: "block",
              isHourly: true,
              notes: trimmedNotes || null,
              reason: trimmedNotes || null,
            },
          };

          setHourlyEventsState((prev) => [...prev, optimisticEvent]);

          try {
            const response = await createManualBlockForTimes(
              hourlyModalState.listingId,
              hourlyModalState.startAt,
              hourlyModalState.endAt,
              {
                label: cleanedLabel,
                notes: trimmedNotes || undefined,
                color,
              }
            );
            const inserted = response?.inserted;
            if (inserted?.id) {
              setHourlyEventsState((prev) =>
                prev.map((item) =>
                  item.id === optimisticId
                    ? {
                        ...item,
                        id: inserted.id,
                        listingId: inserted.listing_id ?? item.listingId,
                        start: inserted.start_at ? new Date(inserted.start_at) : item.start,
                        end: inserted.end_at ? new Date(inserted.end_at) : item.end,
                        label: inserted.label ?? item.label,
                        color: inserted.color ?? item.color,
                      }
                    : item
                )
              );
            }
            setHourlyModalState({ isOpen: false, listingId: null, startAt: null, endAt: null });
            setShowHourlyHint(false);
            void router.replace(router.asPath);
          } catch (err) {
            console.error("Failed to block selected hours.", err);
            setHourlyEventsState((prev) => prev.filter((item) => item.id !== optimisticId));
            setHourlyBlockError(err instanceof Error ? err.message : "Failed to block selected hours.");
          } finally {
            setIsBlockingHourly(false);
          }
        }}
      />
    </HostShellLayout>
  );
}
