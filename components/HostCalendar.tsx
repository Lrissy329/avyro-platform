import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { DayPicker, DateRange as PickerDateRange, type DayButtonProps } from "react-day-picker";
import clsx from "clsx";
import { supabase } from "@/lib/supabaseClient";
import {
  eventCoversDate,
  resolveDayState,
  parseISODate,
  mapIcalEventToLinearCalendar,
} from "@/lib/calendarUtils";
import type {
  CalendarEvent,
  DayState,
  ChannelId,
  BookingStatus,
  DateRange,
  RatesByListingDate,
} from "@/lib/calendarTypes";
import {
  LinearCalendar,
  type LinearCalendarEvent,
  type LinearCalendarListing,
  type LinearCalendarSource,
} from "@/components/calendar/LinearCalendar";
import { BlockDatesModal } from "@/components/calendar/BlockDatesModal";
import { BookingDrawer } from "@/components/calendar/BookingDrawer";
import { PriceModal } from "@/components/calendar/PriceModal";
import {
  startOfDay,
  addDays,
  addMonths,
  startOfMonth,
  daysInMonth,
  diffInDays,
  formatISODate,
  rangeToDates,
  formatRangeSummary,
} from "@/lib/dateUtils";
import { createManualBlockForRange, deleteManualBlock, updateManualBlockNotes, type BlockDatesPayload } from "@/lib/manualBlocks";

type CalendarEntry = {
  id: string;
  start: Date;
  end: Date;
  source:
    | "booking_accepted"
    | "booking_pending"
    | "manual"
    | "airbnb"
    | "vrbo"
    | "other";
  color: string;
  label: string;
  meta?: {
    total?: number | null;
    currency?: string | null;
    nightlyRate?: number | null;
    nights?: number;
    reason?: string | null;
    notes?: string | null;
    status?: BookingStatus;
    guestName?: string | null;
    sourceLabel?: string;
    syncSource?: string | null;
  };
  canDelete?: boolean;
};

type CalendarFeed = {
  id: string;
  listing_id: string;
  label: string;
  url: string;
  source: CalendarEntry["source"];
  color: string | null;
  last_synced_at: string | null;
};

const SOURCE_COLORS: Record<CalendarEntry["source"], string> = {
  booking_accepted: "#0B0D10",
  booking_pending: "#4B5563",
  manual: "#4B5563",
  airbnb: "#4B5563",
  vrbo: "#4B5563",
  other: "#4B5563",
};

const mapLinearToCalendarSource = (
  source: LinearCalendarSource
): CalendarEntry["source"] => {
  if (
    source === "airbnb" ||
    source === "vrbo" ||
    source === "bookingcom" ||
    source === "expedia" ||
    source === "other"
  )
    return source === "bookingcom" || source === "expedia" ? "other" : source;
  if (source === "manual") return "manual";
  return "booking_accepted";
};

const colorForLinearSource = (source: LinearCalendarSource) => {
  const calendarSource = mapLinearToCalendarSource(source);
  return SOURCE_COLORS[calendarSource] ?? SOURCE_COLORS.other;
};

const BLOCK_REASON_OPTIONS: Record<
  "personal" | "maintenance" | "other",
  { label: string; color: string }
> = {
  personal: { label: "Personal stay", color: SOURCE_COLORS.manual },
  maintenance: { label: "Maintenance", color: "#4B5563" },
  other: { label: "Other block", color: "#4B5563" },
};

const SOURCE_BADGES: Record<CalendarEntry["source"], { name: string; textColor: string }> = {
  booking_accepted: { name: "Direct", textColor: "#ffffff" },
  booking_pending: { name: "Direct (pending)", textColor: "#ffffff" },
  manual: { name: "Manual block", textColor: "#ffffff" },
  airbnb: { name: "Airbnb", textColor: "#ffffff" },
  vrbo: { name: "Vrbo", textColor: "#ffffff" },
  other: { name: "External", textColor: "#ffffff" },
};

const SOURCE_FILTERS: Array<{ key: CalendarEntry["source"]; label: string }> = [
  { key: "booking_accepted", label: "Direct" },
  { key: "booking_pending", label: "Direct (pending)" },
  { key: "manual", label: "Manual" },
  { key: "airbnb", label: "Airbnb" },
  { key: "vrbo", label: "Vrbo" },
  { key: "other", label: "Other" },
];

const DAY_PICKER_CLASSNAMES = {
  past: "host-cal-past",
  today: "host-cal-today",
  directaccepted: "host-cal-directaccepted",
  directpending: "host-cal-directpending",
  manual: "host-cal-manual",
  airbnb: "host-cal-airbnb",
  vrbo: "host-cal-vrbo",
  other: "host-cal-other",
};

const stateDots: Record<DayState, string | null> = {
  free: null,
  direct_confirmed: "bg-[#0B0D10]",
  direct_pending: "border border-[#0B0D10]",
  blocked: "bg-[#4B5563]",
  external: "bg-[#4B5563]",
  conflict: null,
};

const getDayClasses = (state: DayState) => {
  switch (state) {
    case "blocked":
      return "bg-slate-50 text-slate-400";
    case "conflict":
      return "bg-[#E5484D]/10 text-[#E5484D]";
    default:
      return "bg-white";
  }
};

type HostCalendarProps = {
  listingId: string;
  listingName?: string;
  listings?: { id: string; title?: string | null }[];
  refreshKey?: number;
  viewMode: "week" | "month";
  onCreateBlock?: (block: {
    start: Date;
    end: Date;
    label?: string;
    color?: string;
  }) => Promise<void> | void;
};

export function HostCalendar({
  listingId,
  listingName,
  listings,
  refreshKey = 0,
  viewMode,
  onCreateBlock,
}: HostCalendarProps) {
  const [entriesMap, setEntriesMap] = useState<Record<string, CalendarEntry[]>>({});
  const [importForm, setImportForm] = useState({
    label: "Airbnb",
    color: SOURCE_COLORS.airbnb,
    url: "",
    source: "airbnb" as CalendarEntry["source"],
    listingId,
  });
  const [importing, setImporting] = useState(false);
  const [feeds, setFeeds] = useState<CalendarFeed[]>([]);
  const [syncingFeedId, setSyncingFeedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [anchorDate, setAnchorDate] = useState(startOfDay(new Date()));
  const [timelineStartDate, setTimelineStartDate] = useState(() => startOfDay(new Date()));
  const [timelineDays, setTimelineDays] = useState(12);
  const [monthRange, setMonthRange] = useState<PickerDateRange | undefined>();
  const [visibleSources, setVisibleSources] = useState<Record<CalendarEntry["source"], boolean>>({
    booking_accepted: true,
    booking_pending: true,
    manual: true,
    airbnb: true,
    vrbo: true,
    other: true,
  });
  const [icalStatus, setIcalStatus] = useState<string | null>(null);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);
  const [visibleChannels, setVisibleChannels] = useState<ChannelId[]>([
    "direct",
    "airbnb",
    "vrbo",
    "other",
    "blocked",
  ]);
  const channelOptions: Array<{ id: ChannelId; label: string; dotClass: string }> = [
    { id: "direct", label: "Direct", dotClass: "bg-[#0B0D10]" },
    { id: "airbnb", label: "Airbnb", dotClass: "bg-slate-400" },
    { id: "vrbo", label: "Vrbo", dotClass: "bg-violet-500" },
    { id: "other", label: "Other", dotClass: "bg-slate-500" },
    { id: "blocked", label: "Blocked", dotClass: "bg-slate-400" },
  ];
  const TIMELINE_SCALES = [
    { label: "7 days", days: 7 },
    { label: "12 days", days: 12 },
  ];
  const [blockReason, setBlockReason] = useState<"personal" | "maintenance" | "other">(
    "personal"
  );
  const [blockLabel, setBlockLabel] = useState("");
  const [blockSelection, setBlockSelection] = useState<{
    listingId: string;
    range: DateRange;
  } | null>(null);
  const [blockListingName, setBlockListingName] = useState<string>("");
  const [isBlockModalOpen, setIsBlockModalOpen] = useState(false);
  const [isBlockSubmitting, setIsBlockSubmitting] = useState(false);
  const [isAwaitingBlockSelection, setIsAwaitingBlockSelection] = useState(false);
  const [priceSelection, setPriceSelection] = useState<{
    listingId: string;
    range: DateRange;
  } | null>(null);
  const [priceModal, setPriceModal] = useState<{
    listingId: string;
    range: DateRange;
  } | null>(null);
  const [ratesByListingDate, setRatesByListingDate] = useState<RatesByListingDate>({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerEvent, setDrawerEvent] = useState<LinearCalendarEvent | null>(null);
  const listingDisplayName = listingName?.trim() || "this listing";
  useEffect(() => {
    setPriceSelection(null);
    setPriceModal(null);
  }, [listingId]);

  useEffect(() => {
    setPriceSelection(null);
    setPriceModal(null);
  }, [timelineDays]);

  useEffect(() => {
    if (viewMode !== "week") {
      setPriceSelection(null);
      setPriceModal(null);
    }
  }, [viewMode]);

  const timelineListings = useMemo<LinearCalendarListing[]>(() => {
    if (listings?.length) {
      return listings
        .filter((listing) => listing.id)
        .map((listing) => ({
          id: listing.id,
          name:
            listing.title?.trim() ||
            (listing.id === listingId ? listingDisplayName : "Listing"),
        }));
    }
    return [{ id: listingId, name: listingDisplayName }];
  }, [listings, listingId, listingDisplayName]);

  const timelineListingIds = useMemo(
    () => timelineListings.map((listing) => listing.id),
    [timelineListings]
  );

  useEffect(() => {
    const defaultId = timelineListingIds[0] ?? listingId;
    setImportForm((prev) => ({
      ...prev,
      listingId: defaultId,
    }));
  }, [timelineListingIds, listingId]);

  const priceSelectionListingName = useMemo(() => {
    if (!priceSelection) return null;
    return (
      timelineListings.find((listing) => listing.id === priceSelection.listingId)?.name || null
    );
  }, [priceSelection, timelineListings]);

  const listingNameMap = useMemo(() => {
    const map = new Map<string, string>();
    timelineListings.forEach((listing) => map.set(listing.id, listing.name));
    return map;
  }, [timelineListings]);

  const entries = useMemo(() => entriesMap[listingId] ?? [], [entriesMap, listingId]);

  const toggleChannel = (id: ChannelId) => {
    setVisibleChannels((current) =>
      current.includes(id) ? current.filter((channel) => channel !== id) : [...current, id]
    );
  };
  const [showFeedModal, setShowFeedModal] = useState(false);

  const today = useMemo(() => startOfDay(new Date()), []);
  const timezoneLabel = useMemo(() => {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return resolved || "local time";
  }, []);

  const toggleSource = useCallback((source: CalendarEntry["source"]) => {
    setVisibleSources((current) => ({
      ...current,
      [source]: !current[source],
    }));
  }, []);

  const filteredEntries = useMemo(
    () => entries.filter((entry) => visibleSources[entry.source] !== false),
    [entries, visibleSources]
  );

  const normalizeBlockSource = useCallback(
    (source: string | null | undefined, label: string | null | undefined): CalendarEntry["source"] => {
      const normalized = (source ?? "").toLowerCase();
      if (normalized === "manual") return "manual";
      if (normalized === "airbnb") return "airbnb";
      if (normalized === "vrbo") return "vrbo";
      if (normalized === "bookingcom" || normalized === "expedia" || normalized === "other") {
        return "other";
      }
      const fallback = (label ?? "").toLowerCase();
      if (fallback.includes("airbnb")) return "airbnb";
      if (fallback.includes("vrbo")) return "vrbo";
      if (fallback.includes("booking") || fallback.includes("expedia")) return "other";
      return "manual";
    },
    []
  );

  const isMissingBlockColumn = (error: any) => {
    const code = error?.code;
    const message = String(error?.message ?? "").toLowerCase();
    if (code === "42703" || code === "PGRST204") return true;
    return message.includes("schema cache") && message.includes("notes");
  };

  const loadCalendarEntries = useCallback(async () => {
    const listingIds = timelineListingIds.length ? timelineListingIds : [listingId];
    if (!listingIds.length) return;
    setLoadError(null);

    try {
      const [bookingsResult, blocksResult] = await Promise.all([
        supabase
          .from("bookings")
          .select(
            "id, listing_id, check_in_time, check_out_time, channel, status, price_total, currency, guest_full_name"
          )
          .in("listing_id", listingIds)
          .order("check_in_time", { ascending: true }),
        supabase
          .from("listing_calendar_blocks")
          .select("id, listing_id, start_date, end_date, source, label, color, notes")
          .in("listing_id", listingIds)
          .order("start_date", { ascending: true }),
      ]);

      let blockRows = blocksResult.data ?? [];
      let blocksError = blocksResult.error;

      if (blocksError && isMissingBlockColumn(blocksError)) {
        const fallbackResult = await supabase
          .from("listing_calendar_blocks")
          .select("id, listing_id, start_date, end_date, source, label, color")
          .in("listing_id", listingIds)
          .order("start_date", { ascending: true });
        blockRows = fallbackResult.data ?? [];
        blocksError = fallbackResult.error;
      }

      if (bookingsResult.error) {
        console.error("Failed to load bookings", bookingsResult.error);
      }
      if (blocksError) {
        console.error("Failed to load calendar blocks", blocksError);
      }
      if (bookingsResult.error || blocksError) {
        setLoadError("Some calendar data failed to load. Please refresh and try again.");
      }

      const nextMap: Record<string, CalendarEntry[]> = {};
      listingIds.forEach((id) => {
        nextMap[id] = [];
      });

      (bookingsResult.data ?? []).forEach((row: any) => {
        if (!row.listing_id || !row.check_in_time || !row.check_out_time) return;
        const checkIn = startOfDay(new Date(row.check_in_time));
        const checkOut = startOfDay(new Date(row.check_out_time));
        if (!Number.isFinite(checkIn.getTime()) || !Number.isFinite(checkOut.getTime())) return;
        const inclusiveEnd = addDays(checkOut, -1);
        const end = inclusiveEnd < checkIn ? checkIn : inclusiveEnd;
        const nights = Math.max(1, diffInDays(checkOut, checkIn));
        const rawStatus = row.status as string | undefined;
        const status = rawStatus as BookingStatus | undefined;
        const source: CalendarEntry["source"] =
          rawStatus === "awaiting_payment" || rawStatus === "pending"
            ? "booking_pending"
            : "booking_accepted";
        const listingLabel = listingNameMap.get(row.listing_id) ?? listingDisplayName;
        const label = row.guest_full_name?.trim() || listingLabel || "Booking";
        const color = SOURCE_COLORS[source] ?? SOURCE_COLORS.booking_accepted;

        nextMap[row.listing_id].push({
          id: row.id,
          start: checkIn,
          end,
          source,
          color,
          label,
          meta: {
            total: row.price_total ?? null,
            currency: row.currency ?? "GBP",
            nights,
            status,
            guestName: row.guest_full_name ?? null,
          },
        });
      });

      (blockRows ?? []).forEach((row: any) => {
        if (!row.listing_id || !row.start_date || !row.end_date) return;
        const start = parseISODate(row.start_date);
        const end = parseISODate(row.end_date);
        const source = normalizeBlockSource(row.source, row.label);
        const label = row.label?.trim() || (source === "manual" ? "Manual block" : "External block");
        const color = row.color ?? SOURCE_COLORS[source] ?? SOURCE_COLORS.manual;
        const nights = Math.max(1, diffInDays(end, start) + 1);
        const notes = row.notes ?? null;

        nextMap[row.listing_id].push({
          id: row.id,
          start,
          end,
          source,
          color,
          label,
          canDelete: source === "manual",
          meta: {
            reason: notes,
            notes,
            nights,
          },
        });
      });

      Object.values(nextMap).forEach((bucket) =>
        bucket.sort((a, b) => a.start.getTime() - b.start.getTime())
      );

      setEntriesMap(nextMap);
    } catch (err) {
      console.error("Failed to load calendar entries", err);
      setLoadError("Unable to load calendar data. Please refresh and try again.");
    }
  }, [listingId, listingDisplayName, listingNameMap, normalizeBlockSource, timelineListingIds]);

  const loadFeeds = useCallback(async () => {
    const listingIds = timelineListingIds.length ? timelineListingIds : [listingId];
    if (!listingIds.length) return;
    const { data, error } = await supabase
      .from("listing_calendar_feeds")
      .select("id, listing_id, label, url, source, color, last_synced_at")
      .in("listing_id", listingIds)
      .order("created_at", { ascending: true });
    if (error) {
      console.error("Failed to load calendar feeds", error);
      return;
    }
    setFeeds((data as CalendarFeed[]) ?? []);
  }, [listingId, timelineListingIds]);

  const loadNightlyRates = useCallback(async () => {
    if (viewMode !== "week") return;
    const listingIds = timelineListingIds.length ? timelineListingIds : [listingId];
    if (!listingIds.length) return;

    const startIso = formatISODate(timelineStartDate);
    const endIso = formatISODate(addDays(timelineStartDate, timelineDays - 1));

    const { data, error } = await supabase
      .from("nightly_rates")
      .select("listing_id, date, price, currency")
      .gte("date", startIso)
      .lte("date", endIso)
      .in("listing_id", listingIds);

    if (error) {
      console.error("Failed to load nightly rates", error);
      return;
    }

    const next: RatesByListingDate = {};
    listingIds.forEach((id) => {
      next[id] = {};
    });

    data?.forEach((row: any) => {
      if (!row.listing_id || !row.date || row.price == null) return;
      const iso = row.date.slice(0, 10);
      next[row.listing_id] ??= {};
      next[row.listing_id][iso] = {
        price: row.price,
        currency: row.currency ?? "GBP",
      };
    });

    setRatesByListingDate(next);
  }, [listingId, timelineDays, timelineListingIds, timelineStartDate, viewMode]);

  const handleDeleteEntry = useCallback(
    async (entry: CalendarEntry) => {
      if (!entry.canDelete) return;
      const confirmation = window.confirm("Remove this block?");
      if (!confirmation) return;
      setDeletingEntryId(entry.id);
      try {
        await deleteManualBlock(entry.id);
        await loadCalendarEntries();
      } catch (err) {
        console.error("Failed to delete manual block", err);
        alert("Unable to delete this block. Please try again.");
      } finally {
        setDeletingEntryId(null);
      }
    },
    [loadCalendarEntries]
  );

  const handleBookingClick = useCallback((event: LinearCalendarEvent) => {
    setDrawerEvent(event);
    setDrawerOpen(true);
  }, []);

  const handleChangeBookingStatus = useCallback(
    async (event: LinearCalendarEvent, status: BookingStatus) => {
      try {
        const { error } = await supabase.from("bookings").update({ status }).eq("id", event.id);
        if (error) throw error;
        await loadCalendarEntries();
        setDrawerOpen(false);
        setDrawerEvent(null);
      } catch (err) {
        console.error("Failed to update booking status", err);
        alert("Unable to update this booking. Please try again.");
      }
    },
    [loadCalendarEntries]
  );

  const handleDeleteBlockFromDrawer = useCallback(
    async (event: LinearCalendarEvent) => {
      try {
        await deleteManualBlock(event.id);
        await loadCalendarEntries();
        setDrawerOpen(false);
        setDrawerEvent(null);
      } catch (err) {
        console.error("Failed to delete manual block", err);
        alert("Unable to delete this block. Please try again.");
      }
    },
    [loadCalendarEntries]
  );

  const handleSaveBlockNotes = useCallback(
    async (event: LinearCalendarEvent, notes: string) => {
      try {
        await updateManualBlockNotes(event.id, notes);
        await loadCalendarEntries();
      } catch (err) {
        console.error("Failed to save block notes", err);
        alert("Unable to save notes for this block.");
      }
    },
    [loadCalendarEntries]
  );

  useEffect(() => {
    loadCalendarEntries();
  }, [loadCalendarEntries, refreshKey]);

  useEffect(() => {
    loadFeeds();
  }, [loadFeeds]);

  useEffect(() => {
    loadNightlyRates();
  }, [loadNightlyRates]);

  const handleSelectPriceRange = useCallback((listingId: string, range: DateRange) => {
    setPriceSelection({ listingId, range });
  }, []);
  const handleClearPriceSelection = useCallback(() => {
    setPriceSelection(null);
  }, []);

  const handleOpenPriceModal = () => {
    if (!priceSelection) {
      alert("Select a date range first.");
      return;
    }
    setPriceModal(priceSelection);
  };

  const handleConfirmBlockDates = useCallback(
    async (payload: BlockDatesPayload) => {
      if (!blockSelection) return;
      setIsBlockSubmitting(true);
      try {
        await createManualBlockForRange(blockSelection.listingId, blockSelection.range, payload);
        await loadCalendarEntries();
        setIsBlockModalOpen(false);
        setBlockSelection(null);
      } catch (err) {
        console.error("Failed to create manual block", err);
        alert("Failed to create manual block. Please try again.");
      } finally {
        setIsBlockSubmitting(false);
      }
    },
    [blockSelection, loadCalendarEntries]
  );

  const handleSavePrices = useCallback(
    async ({
      listingId: targetListingId,
      range,
      price,
      currency,
    }: {
      listingId: string;
      range: DateRange;
      price: number;
      currency: string;
    }) => {
      const dates = rangeToDates(range.start, range.end);
      await Promise.all(
        dates.map(async (date) => {
          const { error } = await supabase.from("nightly_rates").upsert({
            listing_id: targetListingId,
            date: formatISODate(date),
            price,
            currency,
          });
          if (error) throw error;
        })
      );
      await loadNightlyRates();
      setPriceSelection(null);
    },
    [loadNightlyRates]
  );

  const rangeStart = useMemo(() => {
    return viewMode === "week" ? timelineStartDate : startOfMonth(anchorDate);
  }, [anchorDate, viewMode, timelineStartDate]);

  const totalDays = useMemo(() => {
    if (viewMode === "week") {
      return timelineDays;
    }
    return daysInMonth(rangeStart);
  }, [viewMode, rangeStart, timelineDays]);

  const days = useMemo(
    () => Array.from({ length: totalDays }, (_, idx) => addDays(rangeStart, idx)),
    [rangeStart, totalDays]
  );

  const rangeEnd = useMemo(() => addDays(rangeStart, totalDays - 1), [rangeStart, totalDays]);

  const linearEvents = useMemo<LinearCalendarEvent[]>(() => {
    const events: LinearCalendarEvent[] = [];
    Object.entries(entriesMap).forEach(([entryListingId, listingEntries]) => {
      const listingName = listingNameMap.get(entryListingId) ?? "Listing";
      listingEntries.forEach((entry) => {
        const source: LinearCalendarSource =
          entry.source === "booking_accepted" || entry.source === "booking_pending"
            ? "booking"
            : entry.source === "airbnb"
            ? "airbnb"
            : entry.source === "vrbo"
            ? "vrbo"
            : entry.source === "manual"
            ? "manual"
            : "other";

        events.push({
          id: entry.id,
          listingId: entryListingId,
          start: entry.start,
          end: addDays(entry.end, 1),
          label: entry.label,
          color: entry.color,
          textColor: SOURCE_BADGES[entry.source]?.textColor ?? "#ffffff",
          badgeLabel: SOURCE_BADGES[entry.source]?.name ?? null,
          source,
          visible: visibleSources[entry.source] !== false,
          meta: {
            ...entry.meta,
            notes: entry.meta?.notes ?? entry.meta?.reason ?? null,
            listingName,
            listingShortName: listingName,
          },
        });
      });
    });
    return events;
  }, [entriesMap, listingNameMap, visibleSources]);

  const calendarMonth = useMemo(() => startOfMonth(anchorDate), [anchorDate]);

  const computedBlockColor = useMemo(() => {
    return BLOCK_REASON_OPTIONS[blockReason]?.color ?? SOURCE_COLORS.manual;
  }, [blockReason]);

  const handleMonthRangeSelect = useCallback(
    (range: PickerDateRange | undefined) => {
      setMonthRange(range);
      if (!range?.from || !range?.to) return;
      setBlockSelection({
        listingId,
        range: {
          start: startOfDay(range.from),
          end: startOfDay(range.to),
        },
      });
      setBlockListingName(listingDisplayName);
      setIsBlockModalOpen(true);
      setIsAwaitingBlockSelection(false);
    },
    [listingDisplayName, listingId]
  );

  const monthEvents = useMemo<CalendarEvent[]>(() => {
    return entries
      .map((entry) => {
        const channel: ChannelId =
          entry.source === "booking_accepted" || entry.source === "booking_pending"
            ? "direct"
            : entry.source === "manual"
            ? "blocked"
            : entry.source === "airbnb"
            ? "airbnb"
            : entry.source === "vrbo"
            ? "vrbo"
            : "other";
        const kind: CalendarEvent["kind"] =
          entry.source === "booking_accepted" || entry.source === "booking_pending"
            ? "booking"
            : "block";
        const status =
          entry.source === "booking_pending"
            ? "pending"
            : entry.source === "booking_accepted"
            ? "confirmed"
            : undefined;

        return {
          id: entry.id,
          listingId,
          channel,
          kind,
          status,
          startDate: formatISODate(entry.start),
          endDate: formatISODate(addDays(entry.end, 1)),
        };
      })
      .filter((event) => visibleChannels.includes(event.channel));
  }, [entries, listingId, visibleChannels]);

  const resolveDayStateForDate = useCallback(
    (date: Date) => {
      const eventsForDay = monthEvents.filter((event) => eventCoversDate(event, date));
      return resolveDayState(eventsForDay);
    },
    [monthEvents]
  );

  const modifiersBySource = useMemo(() => {
    const buckets: Record<
      "directAccepted" | "directPending" | "manual" | "airbnb" | "vrbo" | "other",
      Date[]
    > = {
      directAccepted: [],
      directPending: [],
      manual: [],
      airbnb: [],
      vrbo: [],
      other: [],
    };

    filteredEntries.forEach((entry) => {
      let bucket: keyof typeof buckets;
      if (entry.source === "booking_accepted") bucket = "directAccepted";
      else if (entry.source === "booking_pending") bucket = "directPending";
      else if (entry.source === "manual" || entry.source === "airbnb" || entry.source === "vrbo") {
        bucket = entry.source;
      } else {
        bucket = "other";
      }

      rangeToDates(entry.start, entry.end).forEach((date) => {
        buckets[bucket].push(new Date(date));
      });
    });

    return buckets;
  }, [filteredEntries]);

  const dayPickerModifiers = useMemo(
    () => ({
      past: { before: today },
      today,
      directaccepted: modifiersBySource.directAccepted,
      directpending: modifiersBySource.directPending,
      manual: modifiersBySource.manual,
      airbnb: modifiersBySource.airbnb,
      vrbo: modifiersBySource.vrbo,
      other: modifiersBySource.other,
    }),
    [today, modifiersBySource]
  );

  const legend = useMemo(() => {
    const base = [
      { label: "Past", pattern: true },
      { label: "Today", color: "#0B0D10" },
      { label: SOURCE_BADGES.booking_accepted.name, color: SOURCE_COLORS.booking_accepted },
      { label: SOURCE_BADGES.booking_pending.name, color: SOURCE_COLORS.booking_pending },
      { label: SOURCE_BADGES.manual.name, color: SOURCE_COLORS.manual },
    ];
    const extras = Array.from(
      new Map(
        entries
          .filter(
            (entry) =>
              entry.source === "airbnb" || entry.source === "vrbo" || entry.source === "other"
          )
          .map((entry) => [entry.source, SOURCE_COLORS[entry.source]])
      ).entries()
    ).map(([source, color]) => ({
      label: SOURCE_BADGES[source as CalendarEntry["source"]].name,
      color,
    }));
    return [...base, ...extras];
  }, [entries]);

  const handleTimelineShift = useCallback(
    (offset: number) => {
      if (!offset) return;
      setTimelineStartDate((prev) => addDays(prev, offset));
      setPriceSelection(null);
      setPriceModal(null);
    },
    [setPriceSelection, setPriceModal]
  );

  const handleNavigate = (direction: "prev" | "next") => {
    if (viewMode === "week") {
      const offset = direction === "prev" ? -timelineDays : timelineDays;
      handleTimelineShift(offset);
    } else {
      setAnchorDate((prev) => addMonths(startOfMonth(prev), direction === "prev" ? -1 : 1));
    }
  };

  const goToToday = () => {
    const now = startOfDay(new Date());
    if (viewMode === "month") {
      setAnchorDate(now);
    } else {
      setTimelineStartDate(now);
      setPriceSelection(null);
      setPriceModal(null);
    }
  };

  const rangeLabel = useMemo(() => {
    if (viewMode === "week") {
      const end = addDays(rangeStart, totalDays - 1);
      const sameMonth = rangeStart.getMonth() === end.getMonth();
      const monthFormatter = new Intl.DateTimeFormat(undefined, {
        month: "short",
      });
      const dayFormatter = new Intl.DateTimeFormat(undefined, {
        day: "numeric",
      });
      const startLabel = `${monthFormatter.format(rangeStart)} ${dayFormatter.format(rangeStart)}`;
      const endLabel = sameMonth
        ? dayFormatter.format(end)
        : `${monthFormatter.format(end)} ${dayFormatter.format(end)}`;
      return `${startLabel} – ${endLabel}`;
    }
    const formatter = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
    return formatter.format(rangeStart);
  }, [rangeStart, totalDays, viewMode]);

  const manualEntries = useMemo(
    () =>
      entries
        .filter((entry) => entry.source === "manual" && entry.canDelete)
        .sort((a, b) => a.start.getTime() - b.start.getTime()),
    [entries]
  );

  const prevViewMode = useRef(viewMode);

  useEffect(() => {
    if (prevViewMode.current !== viewMode) {
      if (viewMode === "week") {
        setTimelineStartDate(startOfDay(new Date()));
      } else {
        setAnchorDate(startOfMonth(anchorDate));
      }
      prevViewMode.current = viewMode;
    }
  }, [viewMode, anchorDate]);

  const createBlock = useCallback(
    async (
      targetListingId: string,
      block: { start: Date; end: Date; label?: string; color?: string },
      source: CalendarEntry["source"] = "manual"
    ) => {
      const payload = {
        start: startOfDay(block.start),
        end: startOfDay(block.end),
        label: block.label ?? "Blocked",
        color: block.color ?? SOURCE_COLORS.manual,
      };
      if (onCreateBlock) {
        await onCreateBlock(payload);
      } else {
        await supabase.from("listing_calendar_blocks").insert({
          listing_id: targetListingId,
          start_date: formatISODate(payload.start),
          end_date: formatISODate(payload.end),
          label: payload.label,
          source,
          color: payload.color,
        });
      }
      await loadCalendarEntries();
    },
    [onCreateBlock, loadCalendarEntries]
  );


  const syncFeed = useCallback(
    async (feed: CalendarFeed) => {
      if (!feed.url) return;
      setSyncingFeedId(feed.id);
      setIcalStatus(null);
      try {
        const response = await fetch("/api/calendar/import-ical", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: feed.url }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || "Failed to import feed.");
        }
        const payload = await response.json();
        const events: {
          uid?: string | null;
          start: string;
          end: string;
          summary?: string | null;
          url?: string | null;
          nights?: number | null;
        }[] = payload?.events ?? [];
        if (!events.length) {
          setIcalStatus(`No events found for ${feed.label}.`);
          return;
        }
        const parsedEvents = events.map((event) => ({
          uid: event.uid ?? null,
          start: new Date(event.start),
          end: new Date(event.end),
          summary: event.summary ?? null,
          url: event.url ?? null,
          nights: event.nights ?? null,
        }));
        const linearSource: LinearCalendarSource =
          feed.source === "airbnb"
            ? "airbnb"
            : feed.source === "vrbo"
            ? "vrbo"
            : feed.source === "manual"
            ? "manual"
            : "other";
        const mappedEvents = parsedEvents.map((raw) =>
          mapIcalEventToLinearCalendar(raw, feed.listing_id, linearSource)
        );
        if (!mappedEvents.length) {
          setIcalStatus(`No events found for ${feed.label}.`);
          return;
        }
        await Promise.all(
          mappedEvents.map((event) =>
            createBlock(
              feed.listing_id,
              {
                start: event.start,
                end: event.end,
                label: event.label,
                color: colorForLinearSource(event.source),
              },
              mapLinearToCalendarSource(event.source)
            )
          )
        );
        await supabase
          .from("listing_calendar_feeds")
          .update({ last_synced_at: new Date().toISOString() })
          .eq("id", feed.id);
        await loadCalendarEntries();
        await loadFeeds();
        setIcalStatus(
          `Synced ${feed.label} • ${new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}`
        );
      } catch (err: any) {
        console.error("Failed to sync feed", err?.message ?? err);
        alert("Unable to sync this feed. Please verify the URL.");
        setIcalStatus("Import failed. Please verify the feed URL.");
      } finally {
        setSyncingFeedId(null);
      }
    },
    [createBlock, loadCalendarEntries, loadFeeds]
  );

  const handleSaveFeed = useCallback(async () => {
    if (!importForm.url.trim() || !importForm.listingId) {
      alert("Provide a listing and iCal URL.");
      return;
    }
    setImporting(true);
    setIcalStatus(null);
    try {
      const { data, error } = await supabase
        .from("listing_calendar_feeds")
        .insert({
          listing_id: importForm.listingId,
          label: importForm.label.trim() || "OTA Feed",
          source: importForm.source,
          url: importForm.url.trim(),
          color: importForm.color,
        })
        .select()
        .single();
      if (error) throw error;
      const feed = data as CalendarFeed;
      await loadFeeds();
      await syncFeed(feed);
      setImportForm((prev) => ({ ...prev, url: "" }));
      setShowFeedModal(false);
    } catch (err: any) {
      console.error("Failed to save feed", err?.message ?? err);
      alert("Unable to save this feed. Please try again.");
    } finally {
      setImporting(false);
    }
  }, [importForm, syncFeed, loadFeeds]);

  const handleDeleteFeed = useCallback(
    async (feedId: string) => {
      const confirmation = window.confirm("Remove this calendar feed?");
      if (!confirmation) return;
      try {
        await supabase.from("listing_calendar_feeds").delete().eq("id", feedId);
        setFeeds((prev) => prev.filter((feed) => feed.id !== feedId));
      } catch (err: any) {
        console.error("Failed to delete feed", err?.message ?? err);
        alert("Unable to delete this feed. Please try again.");
      }
    },
    []
  );

  return (
    <div className="host-calendar space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
              Availability
            </p>
            <h2 className="text-2xl font-semibold text-slate-900">Timeline</h2>
            <p className="text-sm text-slate-500">
              View direct and external stays side-by-side. Drag across the grid to block dates.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 shadow-sm">
            <button
              onClick={() => handleNavigate("prev")}
              className="h-8 w-8 rounded-full border border-slate-200 text-lg text-slate-700 hover:border-slate-400"
              aria-label="Previous range"
            >
              ‹
            </button>
            <span className="text-sm font-semibold text-slate-900">{rangeLabel}</span>
            <button
              onClick={() => handleNavigate("next")}
              className="h-8 w-8 rounded-full border border-slate-200 text-lg text-slate-700 hover:border-slate-400"
              aria-label="Next range"
            >
              ›
            </button>
            <button
              onClick={goToToday}
              className="hidden sm:inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Today
            </button>
          </div>
          <div className="inline-flex rounded-full bg-slate-100 p-1 text-xs font-semibold text-slate-500">
            {TIMELINE_SCALES.map((scale) => {
              const active = timelineDays === scale.days;
              return (
                <button
                  key={scale.days}
                  type="button"
                  onClick={() => setTimelineDays(scale.days)}
                  className={clsx(
                    "rounded-full px-3 py-1 transition",
                    active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                  )}
                >
                  {scale.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Channels</span>
          {SOURCE_FILTERS.map(({ key, label }) => {
            const active = visibleSources[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleSource(key)}
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
            Filters hide items visually only—hidden events still prevent double bookings.
          </p>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
              onClick={() => {
                setBlockSelection(null);
                setBlockListingName(listingDisplayName);
                setIsBlockModalOpen(false);
                setIsAwaitingBlockSelection(true);
              }}
            className="inline-flex items-center rounded-full bg-slate-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
          >
            Block dates
          </button>
          {viewMode === "week" && (
            <>
              <button
                type="button"
                onClick={handleOpenPriceModal}
                className="inline-flex items-center rounded-full border border-slate-200 px-4 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Edit prices
              </button>
              {priceSelection && (
                <span className="text-[11px] text-slate-500">
                  {priceSelectionListingName ? `${priceSelectionListingName} · ` : "Selected "}
                  {formatRangeSummary(priceSelection.range.start, priceSelection.range.end)}
                </span>
              )}
            </>
          )}
        </div>

        {viewMode === "week" ? (
          <LinearCalendar
            listings={timelineListings}
            events={linearEvents}
            startDate={rangeStart}
            endDate={rangeEnd}
            selection={
              blockSelection
                ? { listingId: blockSelection.listingId, range: blockSelection.range }
                : priceSelection ?? null
            }
            ratesByListingDate={ratesByListingDate}
            onBookingClick={handleBookingClick}
            onSelectRange={(listingId, range) => {
              if (isAwaitingBlockSelection) {
                setBlockSelection({ listingId, range });
                const listing = timelineListings.find((l) => l.id === listingId);
                setBlockListingName(listing?.name ?? "Listing");
                setIsBlockModalOpen(true);
                setIsAwaitingBlockSelection(false);
              } else {
                handleSelectPriceRange(listingId, range);
              }
            }}
            onClearSelection={() => {
              if (blockSelection) {
                setBlockSelection(null);
                setIsAwaitingBlockSelection(false);
              } else {
                handleClearPriceSelection();
              }
            }}
            onRequestRangeShift={handleTimelineShift}
          />
        ) : (
          <div className="mt-6">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                {channelOptions.map((channel) => {
                  const active = visibleChannels.includes(channel.id);
                  return (
                    <button
                      key={channel.id}
                      type="button"
                      onClick={() => toggleChannel(channel.id)}
                      className={clsx(
                        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors",
                        active
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                      )}
                    >
                      <span className={clsx("h-1.5 w-1.5 rounded-full", channel.dotClass)} />
                      <span>{channel.label}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#0B0D10]" /> Direct
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> Airbnb
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-violet-500" /> Vrbo
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> Blocked
                </span>
                <span className="flex items-center gap-1">
                  <span className="flex h-3 w-3 items-center justify-center rounded-full bg-red-500 text-[8px] text-white">
                    !
                  </span>{" "}
                  Conflict
                </span>
              </div>
            </div>
            <div className="mt-2">
              <div className="max-w-xl md:max-w-2xl mx-auto">
                <DayPicker
                  mode="range"
                  numberOfMonths={1}
                  pagedNavigation={false}
                  fixedWeeks={true}
                  showOutsideDays={true}
                  selected={monthRange}
                  onSelect={handleMonthRangeSelect}
                  weekStartsOn={1}
                  month={calendarMonth}
                  disabled={{ before: today }}
                  modifiers={dayPickerModifiers}
                  modifiersClassNames={DAY_PICKER_CLASSNAMES}
                  className="hero-month-picker"
                  components={{
                    DayButton: (dayButtonProps) => (
                      <HeroDayButton
                        {...dayButtonProps}
                        state={resolveDayStateForDate(dayButtonProps.day.date)}
                      />
                    ),
                  }}
                />
              </div>
            </div>
            <section className="mt-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
              <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                Block settings
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Choose how manual blocks are labelled on this calendar.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-slate-600">Reason</label>
                  <select
                    value={blockReason}
                    onChange={(e) => setBlockReason(e.target.value as "personal" | "maintenance" | "other")}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#FEDD02]/60"
                  >
                    <option value="personal">Personal stay</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-slate-600">Label (optional)</label>
                  <input
                    type="text"
                    value={blockLabel}
                    onChange={(e) => setBlockLabel(e.target.value)}
                    placeholder="e.g. Family visiting"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#FEDD02]/60"
                  />
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
                <span
                  className="inline-flex h-4 w-4 rounded-full"
                  style={{ backgroundColor: computedBlockColor }}
                />
                <span>Preview of how blocked dates will appear.</span>
              </div>
            </section>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3 text-xs text-gray-600">
          {legend.map((item) => (
            <div
              key={item.label}
              className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-600"
            >
              {"pattern" in item && item.pattern ? (
                <span className="h-3 w-6 rounded-full bg-[length:6px_6px] bg-[repeating-linear-gradient(135deg,rgba(11,13,16,0.12),rgba(11,13,16,0.12)_4px,rgba(11,13,16,0.04)_4px,rgba(11,13,16,0.04)_8px)]" />
              ) : (
                <span
                  className="h-3 w-6 rounded-full border border-gray-200"
                  style={{ backgroundColor: item.color }}
                />
              )}
              {item.label}
            </div>
          ))}
          <div className="ml-auto inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-[11px] font-medium text-slate-500">
            <span className="h-2 w-2 rounded-full bg-slate-900" />
            {timezoneLabel}
          </div>
        </div>
      </div>

      <div className="grid gap-6">
        <div className="rounded-[28px] border border-slate-200 bg-white/90 p-5 shadow-sm">
          <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            Sync calendars
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Import holds from Airbnb, Vrbo, and other platforms so you never double-book.
          </p>
          <div className="mt-4 space-y-3 text-xs text-slate-600">
            {feeds.length === 0 ? (
              <p className="text-[11px] text-slate-400">No feeds yet. Add your Airbnb or Vrbo link.</p>
            ) : (
              feeds.map((feed) => {
                const listingLabel = listingNameMap.get(feed.listing_id) ?? "Listing";
                const lastSynced = feed.last_synced_at
                  ? new Date(feed.last_synced_at).toLocaleString()
                  : "Never synced";
                return (
                  <div
                    key={feed.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 px-3 py-2"
                  >
                    <div>
                      <p className="font-semibold text-slate-900">{feed.label}</p>
                      <p className="text-[11px] text-slate-500">
                        {listingLabel} · {SOURCE_BADGES[feed.source]?.name ?? "External"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400">{lastSynced}</span>
                      <button
                        type="button"
                        onClick={() => syncFeed(feed)}
                        disabled={syncingFeedId === feed.id}
                        className="rounded-full border border-slate-200 px-3 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        {syncingFeedId === feed.id ? "Syncing…" : "Sync now"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteFeed(feed.id)}
                        className="rounded-full border border-red-200 px-3 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowFeedModal(true)}
            className="mt-3 inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            + Add feed
          </button>
        </div>
      </div>

      {showFeedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Add iCal feed</h3>
                <p className="text-xs text-slate-500">Paste your calendar link to sync blocks.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowFeedModal(false)}
                className="rounded-full border border-slate-200 p-2 text-sm text-slate-500 hover:bg-slate-50"
              >
                ×
              </button>
            </div>
            <div className="mt-4 space-y-3 text-sm">
              <label className="block">
                <span className="text-xs text-gray-500">Listing</span>
                <select
                  value={importForm.listingId ?? ""}
                  onChange={(e) =>
                    setImportForm((prev) => ({ ...prev, listingId: e.target.value || prev.listingId }))
                  }
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-black focus:ring-black"
                >
                  {timelineListings.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-gray-500">Feed label</span>
                <input
                  type="text"
                  value={importForm.label}
                  onChange={(e) => setImportForm((prev) => ({ ...prev, label: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-black focus:ring-black"
                />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500">Feed type</span>
                <select
                  value={importForm.source}
                  onChange={(e) => {
                    const source = e.target.value as CalendarEntry["source"];
                    setImportForm((prev) => ({
                      ...prev,
                      source,
                      color:
                        source === "airbnb"
                          ? SOURCE_COLORS.airbnb
                          : source === "vrbo"
                          ? SOURCE_COLORS.vrbo
                          : SOURCE_COLORS.other,
                    }));
                  }}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-black focus:ring-black"
                >
                  <option value="airbnb">Airbnb</option>
                  <option value="vrbo">Vrbo</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-gray-500">iCal URL</span>
                <input
                  type="url"
                  value={importForm.url}
                  onChange={(e) => setImportForm((prev) => ({ ...prev, url: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-black focus:ring-black"
                />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500">Dot colour</span>
                <input
                  type="color"
                  value={importForm.color}
                  onChange={(e) => setImportForm((prev) => ({ ...prev, color: e.target.value }))}
                  className="mt-1 h-10 w-full rounded-lg border border-gray-300 px-3 py-1 focus:border-black focus:ring-black"
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowFeedModal(false)}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveFeed}
                disabled={importing}
                className="rounded-full bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-gray-900 disabled:opacity-60"
              >
                {importing ? "Saving…" : "Save & sync"}
              </button>
            </div>
            {icalStatus && <p className="mt-2 text-xs text-slate-500">{icalStatus}</p>}
          </div>
        </div>
      )}

      {manualEntries.length > 0 && (
        <section className="mt-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            Existing blocks
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Remove manual holds directly from this list.
          </p>
          <div className="mt-3 divide-y divide-slate-100 text-xs text-slate-700">
            {manualEntries.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between py-2">
                <div>
                  <p className="font-medium">
                    {entry.label || "Blocked"} · {SOURCE_BADGES[entry.source].name}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {entry.start.toLocaleDateString()} – {entry.end.toLocaleDateString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteEntry(entry)}
                  disabled={deletingEntryId === entry.id}
                  className="text-[11px] font-medium text-[#E5484D] hover:text-[#E5484D] disabled:opacity-50"
                >
                  {deletingEntryId === entry.id ? "Removing…" : "Remove"}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {loadError && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
          {loadError}
        </div>
      )}

      <BlockDatesModal
        open={isBlockModalOpen}
        onOpenChange={(open) => {
          setIsBlockModalOpen(open);
          if (!open) {
            setBlockSelection(null);
            setIsAwaitingBlockSelection(false);
            setIsBlockSubmitting(false);
          }
        }}
        listingName={blockListingName || listingDisplayName}
        dateRange={blockSelection?.range ?? null}
        timezone={timezoneLabel}
        isSubmitting={isBlockSubmitting}
        onConfirm={handleConfirmBlockDates}
      />

      {priceModal && (
        <PriceModal
          open
          listingId={priceModal.listingId}
          range={priceModal.range}
          onClose={() => setPriceModal(null)}
          onSave={handleSavePrices}
        />
      )}

      <BookingDrawer
        open={drawerOpen}
        onOpenChange={(open) => {
          setDrawerOpen(open);
          if (!open) setDrawerEvent(null);
        }}
        event={drawerEvent}
        onMessageGuest={(event) => console.debug("Message guest", event.id)}
        onModifyBooking={(event) => console.debug("Modify booking", event.id)}
        onCancelBooking={(event) => handleChangeBookingStatus(event, "cancelled")}
        onDeleteBlock={handleDeleteBlockFromDrawer}
        onSaveBlockNotes={handleSaveBlockNotes}
      />
    </div>
  );
}

type HeroDayButtonProps = DayButtonProps & {
  state: DayState;
};

function HeroDayButton({ day, modifiers, state, ...buttonProps }: HeroDayButtonProps) {
  const date = day.date;
  const isCurrentMonth = !modifiers.outside;
  const isSelected = Boolean(modifiers.selected);
  const isToday = Boolean(modifiers.today);
  const isRangeStart = Boolean(modifiers.range_start);
  const isRangeEnd = Boolean(modifiers.range_end);
  const isRangeMiddle = Boolean(modifiers.range_middle);
  const { className: dayButtonClassName, ...rest } = buttonProps;
  const dayClasses = clsx(
    "relative inline-flex h-10 w-10 items-center justify-center rounded-full text-base font-semibold transition",
    getDayClasses(state),
    !isCurrentMonth && "text-slate-300",
    isCurrentMonth && "text-slate-800",
    isToday && "border border-slate-900",
    isRangeMiddle && "bg-slate-100 text-slate-900 border border-slate-200",
    (isRangeStart || isRangeEnd) && "bg-slate-900 text-white border border-slate-900",
    isSelected && "bg-slate-900 text-white"
  );

  return (
    <button
      type="button"
      {...rest}
      className={clsx(
        "relative flex h-12 w-12 items-center justify-center rounded-full text-xs transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#FEDD02]/60",
        dayButtonClassName
      )}
    >
      <span className={dayClasses}>
        <span className="relative z-10">{date.getDate()}</span>
        {state === "blocked" && (
          <span className="pointer-events-none absolute inset-1 rounded-full bg-[repeating-linear-gradient(135deg,rgba(148,163,184,0.35)_0,rgba(148,163,184,0.35)_3px,transparent_3px,transparent_6px)] opacity-70" />
        )}
      </span>

      {stateDots[state] && (
        <span
          className={clsx(
            "absolute bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full",
            state === "direct_pending" ? "border border-[#0B0D10]" : stateDots[state]
          )}
        />
      )}

      {state === "conflict" && (
        <span className="absolute right-0 top-0 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#E5484D] text-[9px] font-semibold text-white">
          !
        </span>
      )}
    </button>
  );
}
