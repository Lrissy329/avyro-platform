import type { NextApiRequest, NextApiResponse } from "next";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import type { CreateBookingPayload } from "@/lib/apiTypes";
import type { BookingStayType, BookingChannel } from "@/lib/calendarTypes";
import { differenceInCalendarDays } from "date-fns";

const STAY_TYPES: BookingStayType[] = ["nightly", "day_use", "split_rest", "crashpad"];
const CHANNELS: BookingChannel[] = [
  "direct",
  "airbnb",
  "vrbo",
  "bookingcom",
  "expedia",
  "manual",
  "other",
];

const isValidStayType = (value: any): value is BookingStayType => STAY_TYPES.includes(value);
const isValidChannel = (value: any): value is BookingChannel => CHANNELS.includes(value);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase = getSupabaseServerClient();
  const body = req.body as Partial<CreateBookingPayload>;

  const {
    listingId,
    guestId,
    checkInTime,
    checkOutTime,
    stayType,
    channel,
    guests,
  } = body;

  if (!listingId || !guestId || !checkInTime || !checkOutTime) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  if (stayType && !isValidStayType(stayType)) {
    return res.status(400).json({ error: "Invalid stayType." });
  }

  if (!isValidChannel(channel)) {
    return res.status(400).json({ error: "Invalid channel." });
  }

  const checkIn = new Date(checkInTime);
  const checkOut = new Date(checkOutTime);

  if (!Number.isFinite(checkIn.getTime()) || !Number.isFinite(checkOut.getTime())) {
    return res.status(400).json({ error: "Invalid timestamps." });
  }

  if (checkOut <= checkIn) {
    return res.status(400).json({ error: "checkOutTime must be after checkInTime." });
  }

  const { data: listingRow, error: listingError } = await supabase
    .from("listings")
    .select("id, user_id, rental_type, booking_unit")
    .eq("id", listingId)
    .maybeSingle();

  if (listingError) {
    console.error("[api/bookings] failed to fetch listing", listingError);
    return res.status(500).json({ error: "Unable to load listing" });
  }

  if (!listingRow?.user_id) {
    return res.status(404).json({ error: "Listing not found." });
  }

  const expectedStayType: BookingStayType =
    (listingRow?.rental_type === "day_use" && "day_use") ||
    (listingRow?.rental_type === "split_rest" && "split_rest") ||
    (listingRow?.rental_type === "crashpad" && "crashpad") ||
    (listingRow?.booking_unit === "hourly" && "day_use") ||
    "nightly";

  if (stayType && stayType !== expectedStayType) {
    return res.status(400).json({ error: "Stay type not available for this listing." });
  }

  const payload: Record<string, any> = {
    listing_id: listingId,
    host_id: listingRow.user_id,
    guest_id: guestId,
    check_in_time: checkIn.toISOString(),
    check_out_time: checkOut.toISOString(),
    stay_type: expectedStayType,
    channel,
    status: "awaiting_payment",
  };

  const diffDays = differenceInCalendarDays(checkOut, checkIn);
  if (expectedStayType === "nightly" || expectedStayType === "crashpad") {
    if (diffDays < 1) {
      return res.status(400).json({
        error: "Nightly stays must be at least one night. Select a later check‑out date.",
      });
    }
  }

  if (typeof guests === "number") {
    payload.guests_total = guests;
  }
  const { data, error } = await supabase.from("bookings").insert(payload).select().single();

  if (error) {
    console.error("[api/bookings] failed to create booking", error);
    return res.status(400).json({ error: error.message });
  }

  return res.status(201).json({ booking: data });
}
