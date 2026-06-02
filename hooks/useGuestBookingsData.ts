import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";

import { ensureProfile } from "@/lib/ensureProfile";
import { supabase } from "@/lib/supabaseClient";
import {
  isMissingColumnError,
  resolveBookingCheckIn,
  sortBookingsByCheckIn,
  type GuestBookingRecord,
  type GuestHostRecord,
  type GuestListingRecord,
} from "@/components/guest/bookingUtils";

type UseGuestBookingsDataResult = {
  loading: boolean;
  error: string | null;
  userId: string | null;
  userEmail: string | null;
  bookings: GuestBookingRecord[];
  listingById: Record<string, GuestListingRecord>;
  hostById: Record<string, GuestHostRecord>;
  refresh: () => Promise<void>;
};

const bookingSelects = [
  "id, listing_id, host_id, status, booking_type, shared_group_id, check_in_time, check_out_time, check_in, check_out, guests_total, guest_total_pence, price_total, currency, stripe_status, flex_mode, flex_status, flex_min_nights, flex_max_nights, flex_current_confirmed_end, flex_max_end, flex_rolling_window_days, flex_pricing_multiplier, flex_extension_cutoff_at, flex_extra_night, flex_extra_night_status, flex_extra_night_price_pence, flex_extra_night_cutoff_at, created_at",
  "id, listing_id, host_id, status, booking_type, shared_group_id, check_in_time, check_out_time, check_in, check_out, guests_total, guest_total_pence, price_total, currency, stripe_status, flex_mode, flex_status, flex_min_nights, flex_max_nights, flex_current_confirmed_end, flex_max_end, flex_rolling_window_days, flex_pricing_multiplier, flex_extension_cutoff_at, created_at",
  "id, listing_id, host_id, status, booking_type, shared_group_id, check_in_time, check_out_time, check_in, check_out, guests_total, guest_total_pence, price_total, currency, stripe_status, flex_mode, flex_status, flex_current_confirmed_end, flex_max_end, flex_rolling_window_days, flex_pricing_multiplier, flex_extension_cutoff_at, flex_extra_night, flex_extra_night_status, flex_extra_night_price_pence, flex_extra_night_cutoff_at, created_at",
  "id, listing_id, host_id, status, booking_type, shared_group_id, check_in_time, check_out_time, check_in, check_out, guests_total, guest_total_pence, price_total, currency, stripe_status, flex_mode, flex_status, flex_current_confirmed_end, flex_max_end, flex_extension_cutoff_at, flex_extra_night, flex_extra_night_status, flex_extra_night_price_pence, created_at",
  "id, listing_id, host_id, status, booking_type, shared_group_id, check_in_time, check_out_time, check_in, check_out, guests_total, guest_total_pence, price_total, currency, stripe_status, flex_extra_night, flex_extra_night_status, flex_extra_night_price_pence, created_at",
  "id, listing_id, host_id, status, booking_type, shared_group_id, check_in_time, check_out_time, check_in, check_out, guests_total, guest_total_pence, price_total, currency, stripe_status, flex_extra_night, flex_extra_night_status, created_at",
  "id, listing_id, host_id, status, booking_type, shared_group_id, check_in, check_out, guests_total, guest_total_pence, price_total, currency, stripe_status, created_at",
  "id, listing_id, host_id, status, booking_type, shared_group_id, check_in, check_out, guests_total, price_total, currency, created_at",
] as const;

const listingSelects = [
  "id, title, location, is_shared_stay, shared_total_spots, shared_weekly_price_pence, address, check_in_instructions, check_out_instructions, house_rules",
  "id, title, location, is_shared_stay, shared_total_spots, shared_weekly_price_pence, address, check_in_instructions, check_out_instructions",
  "id, title, location, is_shared_stay, shared_total_spots, shared_weekly_price_pence, address",
  "id, title, location, is_shared_stay, shared_total_spots, shared_weekly_price_pence",
  "id, title, location, address, check_in_instructions, check_out_instructions, house_rules",
  "id, title, location, address, check_in_instructions, check_out_instructions",
  "id, title, location, address",
  "id, title, location",
] as const;

async function loadBookingsForGuest(guestId: string): Promise<GuestBookingRecord[]> {
  let lastError: any = null;

  for (const select of bookingSelects) {
    const { data, error } = await supabase
      .from("bookings")
      .select(select)
      .eq("guest_id", guestId)
      .order("created_at", { ascending: false });

    if (!error) {
      const rows = (Array.isArray(data) ? data : []) as unknown as GuestBookingRecord[];
      return sortBookingsByCheckIn(
        rows.filter(
          (row) => typeof row.id === "string" && typeof row.listing_id === "string"
        )
      );
    }

    lastError = error;
    if (!isMissingColumnError(error)) {
      throw new Error(error.message || "Unable to load bookings.");
    }
  }

  if (lastError) {
    throw new Error(lastError.message || "Unable to load bookings.");
  }

  return [];
}

async function loadListingsForBookings(
  listingIds: string[]
): Promise<Record<string, GuestListingRecord>> {
  if (listingIds.length === 0) return {};

  let lastError: any = null;

  for (const select of listingSelects) {
    const { data, error } = await supabase
      .from("listings")
      .select(select)
      .in("id", listingIds);

    if (!error) {
      const rows = (Array.isArray(data) ? data : []) as unknown as GuestListingRecord[];
      return rows.reduce<Record<string, GuestListingRecord>>((acc, row) => {
        if (!row?.id) return acc;
        acc[row.id] = row;
        return acc;
      }, {});
    }

    lastError = error;
    if (!isMissingColumnError(error)) {
      throw new Error(error.message || "Unable to load listing details.");
    }
  }

  if (lastError) {
    throw new Error(lastError.message || "Unable to load listing details.");
  }

  return {};
}

async function loadHostsForBookings(hostIds: string[]): Promise<Record<string, GuestHostRecord>> {
  if (hostIds.length === 0) return {};

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, avatar_url")
    .in("id", hostIds);

  if (error) {
    throw new Error(error.message || "Unable to load host details.");
  }

  const rows = (Array.isArray(data) ? data : []) as GuestHostRecord[];
  return rows.reduce<Record<string, GuestHostRecord>>((acc, row) => {
    if (!row?.id) return acc;
    acc[row.id] = row;
    return acc;
  }, {});
}

export function useGuestBookingsData(): UseGuestBookingsDataResult {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [bookings, setBookings] = useState<GuestBookingRecord[]>([]);
  const [listingById, setListingById] = useState<Record<string, GuestListingRecord>>({});
  const [hostById, setHostById] = useState<Record<string, GuestHostRecord>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const user = session?.user;
      if (!user?.id) {
        router.replace(`/login?redirect=${encodeURIComponent(router.asPath || "/guest/dashboard")}`);
        return;
      }

      await ensureProfile();

      try {
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("role_guest")
          .eq("id", user.id)
          .maybeSingle();

        if (!profileError && profile && profile.role_guest === false) {
          router.replace("/host/dashboard");
          return;
        }
      } catch {
        // Continue even if role_guest is unavailable.
      }

      const bookingRows = await loadBookingsForGuest(user.id);
      const listingIds = Array.from(
        new Set(bookingRows.map((row) => row.listing_id).filter((value): value is string => Boolean(value)))
      );
      const hostIds = Array.from(
        new Set(bookingRows.map((row) => row.host_id).filter((value): value is string => Boolean(value)))
      );

      const [listingLookup, hostLookup] = await Promise.all([
        loadListingsForBookings(listingIds),
        loadHostsForBookings(hostIds),
      ]);

      setUserId(user.id);
      setUserEmail(user.email ?? null);
      setBookings(bookingRows);
      setListingById(listingLookup);
      setHostById(hostLookup);
    } catch (err: any) {
      setError(err?.message ?? "Unable to load guest dashboard data.");
      setBookings([]);
      setListingById({});
      setHostById({});
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load().catch(() => null);
  }, [load]);

  const normalizedBookings = useMemo(
    () =>
      bookings.map((booking) => ({
        ...booking,
        check_in_time: booking.check_in_time ?? resolveBookingCheckIn(booking),
      })),
    [bookings]
  );

  return {
    loading,
    error,
    userId,
    userEmail,
    bookings: normalizedBookings,
    listingById,
    hostById,
    refresh: load,
  };
}
