import type { NextApiRequest, NextApiResponse } from "next";
import { createPagesServerClient } from "@supabase/auth-helpers-nextjs";

import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { isMissingColumnError } from "@/lib/flexStay";

type ReleaseResponse =
  | {
      ok: true;
      booking: {
        id: string;
        flexStatus: string;
      };
    }
  | { error: string };

const bookingSelects = [
  "id, guest_id, host_id, flex_mode, flex_status, flex_extra_night, flex_extra_night_status",
  "id, guest_id, host_id, flex_mode, flex_status",
  "id, guest_id, host_id, flex_extra_night, flex_extra_night_status",
  "id, guest_id, host_id, flex_mode",
  "id, guest_id, host_id",
] as const;

const insertSystemMessage = async ({
  supabase,
  bookingId,
  hostId,
  body,
}: {
  supabase: any;
  bookingId: string;
  hostId?: string | null;
  body: string;
}) => {
  try {
    const { data: conversation } = await supabase
      .from("conversations")
      .select("id")
      .eq("booking_id", bookingId)
      .maybeSingle();
    const conversationId = conversation?.id;
    if (!conversationId) return;

    const primary = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        sender_id: null,
        sender_role: "system",
        body,
      })
      .select("created_at")
      .single();

    if (primary.error) {
      const fallback = await supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          sender_id: hostId ?? null,
          body,
        })
        .select("created_at")
        .single();
      if (fallback.data?.created_at) {
        await supabase
          .from("conversations")
          .update({ last_message_at: fallback.data.created_at })
          .eq("id", conversationId);
      }
      return;
    }

    if (primary.data?.created_at) {
      await supabase
        .from("conversations")
        .update({ last_message_at: primary.data.created_at })
        .eq("id", conversationId);
    }
  } catch (error) {
    console.warn("[api/flex/release] system message failed", error);
  }
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<ReleaseResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authClient = createPagesServerClient({ req, res });
  const {
    data: { session },
    error: sessionError,
  } = await authClient.auth.getSession();

  if (sessionError || !session?.user?.id) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const bookingId = String((req.body as any)?.bookingId ?? "").trim();
  if (!bookingId) {
    return res.status(400).json({ error: "bookingId is required." });
  }

  const supabase = getSupabaseServerClient();

  let booking: any = null;
  let bookingError: any = null;
  for (const select of bookingSelects) {
    const result = await supabase
      .from("bookings")
      .select(select)
      .eq("id", bookingId)
      .maybeSingle();
    booking = result.data ?? null;
    bookingError = result.error;
    if (!bookingError) break;
    if (!isMissingColumnError(bookingError)) break;
  }

  if (bookingError) {
    return res.status(500).json({ error: bookingError.message ?? "Unable to load booking." });
  }
  if (!booking?.id || booking.guest_id !== session.user.id) {
    return res.status(404).json({ error: "Booking not found." });
  }

  const flexMode = String((booking as any).flex_mode ?? "").toLowerCase();
  if (flexMode === "rolling") {
    const heldWindowResult = await supabase
      .from("booking_flex_windows")
      .select("id")
      .eq("booking_id", bookingId)
      .eq("status", "held")
      .order("start_date", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (heldWindowResult.error) {
      return res.status(500).json({ error: heldWindowResult.error.message ?? "Unable to load held window." });
    }

    if (!heldWindowResult.data?.id) {
      return res.status(200).json({
        ok: true,
        booking: {
          id: String(booking.id),
          flexStatus: String((booking as any).flex_status ?? "released"),
        },
      });
    }

    const nowIso = new Date().toISOString();
    const windowUpdate = await supabase
      .from("booking_flex_windows")
      .update({ status: "released", updated_at: nowIso })
      .eq("id", heldWindowResult.data.id)
      .eq("status", "held");

    if (windowUpdate.error) {
      return res.status(500).json({ error: windowUpdate.error.message ?? "Unable to release held window." });
    }

    const bookingUpdate = await supabase
      .from("bookings")
      .update({
        flex_status: "released",
        flex_extension_cutoff_at: null,
      })
      .eq("id", bookingId)
      .eq("guest_id", session.user.id)
      .select("id, flex_status")
      .single();

    if (bookingUpdate.error) {
      return res.status(500).json({ error: bookingUpdate.error.message ?? "Unable to update flex status." });
    }

    await insertSystemMessage({
      supabase,
      bookingId,
      hostId: booking.host_id,
      body:
        "Your flexible continuation has been released. If you still need more nights, check availability to book again.",
    });

    return res.status(200).json({
      ok: true,
      booking: {
        id: String(bookingUpdate.data?.id ?? booking.id),
        flexStatus: String((bookingUpdate.data as any)?.flex_status ?? "released"),
      },
    });
  }

  const status = String(booking.flex_extra_night_status ?? "").toLowerCase();
  if (status !== "reserved") {
    return res.status(200).json({
      ok: true,
      booking: {
        id: String(booking.id),
        flexStatus: status || "released",
      },
    });
  }

  const updatePayload: Record<string, any> = {
    flex_extra_night_status: "released",
    flex_extra_night_released_at: new Date().toISOString(),
  };

  let update = await supabase
    .from("bookings")
    .update(updatePayload)
    .eq("id", bookingId)
    .eq("guest_id", session.user.id)
    .select("id, flex_extra_night_status")
    .single();

  if (update.error && isMissingColumnError(update.error)) {
    const fallbackPayload = { ...updatePayload };
    delete fallbackPayload.flex_extra_night_released_at;
    update = await supabase
      .from("bookings")
      .update(fallbackPayload)
      .eq("id", bookingId)
      .eq("guest_id", session.user.id)
      .select("id")
      .single();
  }

  if (update.error || !update.data?.id) {
    return res.status(500).json({ error: update.error?.message ?? "Unable to release flex night." });
  }

  await insertSystemMessage({
    supabase,
    bookingId,
    hostId: booking.host_id,
    body:
      "Your flexible continuation has been released. If you still need more nights, check availability to book again.",
  });

  return res.status(200).json({
    ok: true,
    booking: {
      id: String(update.data.id),
      flexStatus: String((update.data as any).flex_extra_night_status ?? "released"),
    },
  });
}
