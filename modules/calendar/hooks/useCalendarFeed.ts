import { useCallback, useEffect, useMemo, useState } from "react";
import { formatLocalDate } from "@/lib/dateUtils";
import type { CalendarFeed } from "@/modules/calendar/types";

type UseCalendarFeedParams = {
  start: Date;
  end: Date;
  listingId?: string;
  includeCancelled?: boolean;
};

type UseCalendarFeedResult = {
  feed: CalendarFeed;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
};

const EMPTY_FEED: CalendarFeed = {
  listings: [],
  bookings: [],
  blocks: [],
  rates: {},
};

export function useCalendarFeed({
  start,
  end,
  listingId,
  includeCancelled,
}: UseCalendarFeedParams): UseCalendarFeedResult {
  const [feed, setFeed] = useState<CalendarFeed>(EMPTY_FEED);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({
      start: formatLocalDate(start),
      end: formatLocalDate(end),
      includeCancelled: includeCancelled ? "1" : "0",
    });
    if (listingId && listingId !== "all") {
      params.set("listingId", listingId);
    }
    return params.toString();
  }, [start, end, listingId, includeCancelled]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/host/calendar/feed?${query}`);
      const payload = await response.json();

      if (!response.ok) {
        setError(payload?.error ?? "Failed to load calendar feed.");
        setFeed(EMPTY_FEED);
        return;
      }

      setFeed({
        listings: Array.isArray(payload?.listings) ? payload.listings : [],
        bookings: Array.isArray(payload?.bookings) ? payload.bookings : [],
        blocks: Array.isArray(payload?.blocks) ? payload.blocks : [],
        rates: payload?.rates ?? {},
      });
    } catch (err: any) {
      setError(err?.message ?? "Failed to load calendar feed.");
      setFeed(EMPTY_FEED);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load().catch(() => null);
  }, [load]);

  return {
    feed,
    loading,
    error,
    refetch: load,
  };
}
