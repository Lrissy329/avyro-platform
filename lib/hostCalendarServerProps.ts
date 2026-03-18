import type { GetServerSideProps } from "next";
import { createPagesServerClient } from "@supabase/auth-helpers-nextjs";

import type { LinearCalendarEvent, LinearCalendarListing } from "@/components/calendar/LinearCalendar";
import { mapHostBookingsToLinearEvents, mapHostBlocksToLinearEvents, listingsToLinearCalendar } from "@/lib/calendarMapping";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

type SerializableLinearEvent = Omit<LinearCalendarEvent, "start" | "end"> & {
  start: string;
  end: string;
};

export type HostCalendarPageProps = {
  listings: LinearCalendarListing[];
  events: SerializableLinearEvent[];
  listingLocations: Record<string, string | null>;
  listingRates: Record<string, { price: number; currency: string }>;
};

const isMissingColumn = (error: any) => {
  const code = error?.code;
  const message = String(error?.message ?? "").toLowerCase();
  return code === "42703" || code === "PGRST204" || message.includes("schema cache");
};

export const hostCalendarGetServerSideProps: GetServerSideProps<HostCalendarPageProps> = async (
  ctx
) => {
  const authClient = createPagesServerClient(ctx);
  const {
    data: { session },
    error: sessionError,
  } = await authClient.auth.getSession();

  if (sessionError || !session?.user?.id) {
    return {
      redirect: {
        destination: `/login?redirect=${encodeURIComponent(ctx.resolvedUrl)}`,
        permanent: false,
      },
    };
  }

  const userId = session.user.id;
  const supabase = getSupabaseServerClient();

  let listingRows: any[] = [];
  let listingsError: any = null;

  const listingSelects = [
    "id, title, location, price_per_night, booking_unit, timezone",
    "id, title, location, price_per_night, booking_unit",
    "id, title, price_per_night, booking_unit, timezone",
    "id, title, price_per_night, booking_unit",
    "id, title, price_per_night",
  ];

  for (const select of listingSelects) {
    const result = await supabase
      .from("listings")
      .select(select)
      .eq("user_id", userId)
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

  const listingData = listingRows ?? [];
  const listingIds = listingData.map((listing) => listing.id).filter(Boolean);

  let bookingRows: any[] = [];
  let bookingsError: any = null;
  const bookingSelects = [
    "id, listing_id, check_in_time, check_out_time, channel, status, price_total, currency, host_net_total_pence, guest_full_name, stay_type",
    "id, listing_id, check_in_time, check_out_time, channel, status, price_total, currency, guest_full_name, stay_type",
    "id, listing_id, check_in_time, check_out_time, channel, status, price_total, currency, stay_type",
  ];

  if (listingIds.length > 0) {
    for (const select of bookingSelects) {
      const result = await supabase
        .from("bookings")
        .select(select)
        .in("listing_id", listingIds)
        .order("check_in_time", { ascending: true })
        .limit(200);

      bookingRows = result.data ?? [];
      bookingsError = result.error;

      if (!bookingsError) break;
      if (!isMissingColumn(bookingsError)) break;
    }
  }

  if (bookingsError) {
    console.error("Failed to load bookings for host calendar", bookingsError.message);
  }

  let blockRows = [] as any[];
  let blocksError: any = null;

  if (listingIds.length > 0) {
    const blocksResult = await supabase
      .from("listing_calendar_blocks")
      .select("id, listing_id, start_date, end_date, source, label, color, notes, start_at, end_at")
      .in("listing_id", listingIds)
      .order("start_date", { ascending: true })
      .limit(500);

    blockRows = blocksResult.data ?? [];
    blocksError = blocksResult.error;

    if (blocksError && isMissingColumn(blocksError)) {
      const fallbackResult = await supabase
        .from("listing_calendar_blocks")
        .select("id, listing_id, start_date, end_date, source, label, color")
        .in("listing_id", listingIds)
        .order("start_date", { ascending: true })
        .limit(500);

      blockRows = fallbackResult.data ?? [];
      blocksError = fallbackResult.error;
    }
  }

  if (blocksError) {
    console.error("Failed to load calendar blocks for host calendar", blocksError.message);
  }

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

  const nightlyBookingRows = bookingsData.filter((booking) => !isHourlyBooking(booking));
  const nightlyBlocks = blocksData.filter(
    (block) => block.start_date && block.end_date && !(block.start_at && block.end_at)
  );

  const listings = listingsToLinearCalendar(listingData);
  const bookingEvents = mapHostBookingsToLinearEvents(listingData, nightlyBookingRows);
  const blockEvents = mapHostBlocksToLinearEvents(nightlyBlocks);
  const events = [...bookingEvents, ...blockEvents];

  const serializableEvents: SerializableLinearEvent[] = events.map((event) => ({
    ...event,
    start: event.start.toISOString(),
    end: event.end.toISOString(),
  }));

  const listingLocations = listingData.reduce<Record<string, string | null>>((acc, row) => {
    if (row.id) {
      acc[row.id] = row.location ?? null;
    }
    return acc;
  }, {});

  const listingRates = listingData.reduce<Record<string, { price: number; currency: string }>>(
    (acc, row) => {
      if (!row.id) return acc;
      const raw = row.price_per_night;
      const price = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(price)) return acc;
      acc[row.id] = { price, currency: "GBP" };
      return acc;
    },
    {}
  );

  return {
    props: {
      listings,
      events: serializableEvents,
      listingLocations,
      listingRates,
    },
  };
};
