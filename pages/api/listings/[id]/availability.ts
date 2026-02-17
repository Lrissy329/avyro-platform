import type { NextApiRequest, NextApiResponse } from "next";

import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { addDays } from "@/lib/dateUtils";

type AvailabilityResponse = {
  listing_id: string;
  from: string;
  to: string;
  booked: string[];
  blocked: string[];
  generated_at: string;
};

const MAX_RANGE_DAYS = 120;

const toISODate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseISODate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
};

const clampRange = (start: Date, end: Date, windowStart: Date, windowEnd: Date) => {
  const clampedStart = start > windowStart ? start : windowStart;
  const clampedEnd = end < windowEnd ? end : windowEnd;
  return { clampedStart, clampedEnd };
};

const expandNights = (
  start: Date,
  end: Date,
  windowStart: Date,
  windowEnd: Date,
  target: Set<string>
) => {
  const { clampedStart, clampedEnd } = clampRange(start, end, windowStart, windowEnd);
  let cursor = new Date(clampedStart);
  while (cursor < clampedEnd) {
    target.add(toISODate(cursor));
    cursor = addDays(cursor, 1);
  }
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AvailabilityResponse | { error: string }>
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { id } = req.query;
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Listing id is required." });
  }

  const fromParam = typeof req.query.from === "string" ? req.query.from : null;
  const toParam = typeof req.query.to === "string" ? req.query.to : null;

  if (!fromParam || !toParam) {
    return res.status(400).json({ error: "`from` and `to` are required." });
  }

  const windowStart = parseISODate(fromParam);
  const windowEnd = parseISODate(toParam);

  if (!windowStart || !windowEnd) {
    return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD." });
  }

  if (windowEnd <= windowStart) {
    return res.status(400).json({ error: "`to` must be after `from`." });
  }

  const diffDays = Math.ceil((windowEnd.getTime() - windowStart.getTime()) / 86400000);
  if (diffDays > MAX_RANGE_DAYS) {
    return res.status(400).json({ error: "Date window too large." });
  }

  try {
    const supabase = getSupabaseServerClient();
    const windowStartIso = windowStart.toISOString();
    const windowEndIso = windowEnd.toISOString();

    const [{ data: bookings, error: bookingsError }, { data: blocks, error: blocksError }] =
      await Promise.all([
        supabase
          .from("bookings")
          .select("check_in_time, check_out_time, stay_type, status")
          .eq("listing_id", id)
          .lt("check_in_time", windowEndIso)
          .gt("check_out_time", windowStartIso)
          .in("stay_type", ["nightly", "crashpad"])
          .in("status", ["pending", "awaiting_payment", "approved", "confirmed", "paid"]),
        supabase
          .from("listing_calendar_blocks")
          .select("start_date, end_date")
          .eq("listing_id", id)
          .not("start_date", "is", null)
          .not("end_date", "is", null)
          .lt("start_date", toParam)
          .gt("end_date", fromParam),
      ]);

    if (bookingsError || blocksError) {
      const msg = bookingsError?.message ?? blocksError?.message ?? "Failed to load availability.";
      return res.status(500).json({ error: msg });
    }

    const booked = new Set<string>();
    const blocked = new Set<string>();

    (bookings ?? []).forEach((booking: any) => {
      if (!booking.check_in_time || !booking.check_out_time) return;
      const startDate = new Date(booking.check_in_time);
      const endDate = new Date(booking.check_out_time);
      if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) return;
      expandNights(startDate, endDate, windowStart, windowEnd, booked);
    });

    (blocks ?? []).forEach((block: any) => {
      if (!block.start_date || !block.end_date) return;
      const startDate = parseISODate(block.start_date);
      const endDate = parseISODate(block.end_date);
      if (!startDate || !endDate) return;
      const temp = new Set<string>();
      expandNights(startDate, endDate, windowStart, windowEnd, temp);
      temp.forEach((night) => {
        if (!booked.has(night)) {
          blocked.add(night);
        }
      });
    });

    return res.status(200).json({
      listing_id: id,
      from: fromParam,
      to: toParam,
      booked: Array.from(booked).sort(),
      blocked: Array.from(blocked).sort(),
      generated_at: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? "Failed to load availability." });
  }
}
