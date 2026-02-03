import type { NextApiRequest, NextApiResponse } from "next";

import { getSupabaseServerClient } from "@/lib/supabaseServer";

type ManualBlockPayload = {
  listingId?: string;
  startDate?: string;
  endDate?: string;
  startAt?: string;
  endAt?: string;
  notes?: string;
  label?: string;
  color?: string;
  createdBy?: string;
};

const toISODate = (value: string) => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

const toISOTimestamp = (value: string) => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString();
};

const isMissingBlockColumn = (error: any) => {
  const code = error?.code;
  const message = String(error?.message ?? "").toLowerCase();
  if (code === "42703" || code === "PGRST204") return true;
  if (message.includes("schema cache") && (message.includes("notes") || message.includes("created_by") || message.includes("start_at") || message.includes("end_at"))) {
    return true;
  }
  return false;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST" && req.method !== "DELETE" && req.method !== "PATCH") {
    res.setHeader("Allow", "POST, DELETE, PATCH");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (req.method === "DELETE") {
    const { id } = (req.body ?? {}) as { id?: string };
    if (!id) {
      return res.status(400).json({ error: "id is required." });
    }

    try {
      const supabase = getSupabaseServerClient();
      const { data, error } = await supabase
        .from("listing_calendar_blocks")
        .delete()
        .eq("id", id)
        .select("id");

      if (error) {
        console.error("[api/manual-blocks] failed to delete manual block", error);
        return res.status(500).json({ error: error.message, details: error });
      }

      if (!data || data.length === 0) {
        return res.status(404).json({ error: "Manual block not found." });
      }

      return res.status(200).json({ ok: true, deleted: data[0] });
    } catch (err) {
      console.error("[api/manual-blocks] unexpected delete error", err);
      return res
        .status(500)
        .json({ error: err?.message ?? "Failed to delete manual block.", details: err });
    }
  }

  if (req.method === "PATCH") {
    const { id, notes, label, color } = (req.body ?? {}) as {
      id?: string;
      notes?: string;
      label?: string;
      color?: string;
    };

    if (!id) {
      return res.status(400).json({ error: "id is required." });
    }

    const updates: Record<string, any> = {};
    if (typeof notes === "string") {
      updates.notes = notes.trim() || null;
    }
    if (typeof label === "string") {
      updates.label = label.trim() || null;
    }
    if (typeof color === "string") {
      updates.color = color;
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: "No updates provided." });
    }

    try {
      const supabase = getSupabaseServerClient();
      const { data, error } = await supabase
        .from("listing_calendar_blocks")
        .update(updates)
        .eq("id", id)
        .select("id, listing_id, start_date, end_date, source, label, color")
        .single();

      if (error) {
        if (isMissingBlockColumn(error)) {
          return res
            .status(400)
            .json({ error: "Notes are not supported yet. Add a notes column." });
        }
        console.error("[api/manual-blocks] failed to update manual block", error);
        return res.status(500).json({ error: error.message, details: error });
      }

      return res.status(200).json({ ok: true, updated: data });
    } catch (err: any) {
      console.error("[api/manual-blocks] unexpected update error", err);
      return res
        .status(500)
        .json({ error: err?.message ?? "Failed to update manual block.", details: err });
    }
  }
  const { listingId, startDate, endDate, startAt, endAt, notes, label, color, createdBy } =
    (req.body ?? {}) as ManualBlockPayload;

  const hasTimeRange = Boolean(startAt && endAt);

  if (!listingId || (!hasTimeRange && (!startDate || !endDate))) {
    return res
      .status(400)
      .json({ error: "listingId and a start/end range are required." });
  }

  const startIso = !hasTimeRange && startDate ? toISODate(startDate) : null;
  const endIso = !hasTimeRange && endDate ? toISODate(endDate) : null;
  const startTimestamp = hasTimeRange && startAt ? toISOTimestamp(startAt) : null;
  const endTimestamp = hasTimeRange && endAt ? toISOTimestamp(endAt) : null;

  if (hasTimeRange) {
    if (!startTimestamp || !endTimestamp) {
      return res.status(400).json({ error: "Invalid startAt or endAt." });
    }
    if (new Date(endTimestamp) <= new Date(startTimestamp)) {
      return res.status(400).json({ error: "endAt must be after startAt." });
    }
  } else {
    if (!startIso || !endIso) {
      return res.status(400).json({ error: "Invalid startDate or endDate." });
    }
    if (new Date(endIso) < new Date(startIso)) {
      return res.status(400).json({ error: "endDate must be on or after startDate." });
    }
  }

  try {
    const supabase = getSupabaseServerClient();
    const insertPayload: Record<string, any> = {
      listing_id: listingId,
      source: "manual",
      label: label?.trim() || "Manual block",
    };

    if (hasTimeRange) {
      insertPayload.start_at = startTimestamp;
      insertPayload.end_at = endTimestamp;
    } else {
      insertPayload.start_date = startIso;
      insertPayload.end_date = endIso;
    }

    if (color) {
      insertPayload.color = color;
    }
    if (notes) {
      insertPayload.notes = notes;
    }
    if (createdBy) {
      insertPayload.created_by = createdBy;
    }

    const insertRow = async (payload: Record<string, any>) =>
      supabase
        .from("listing_calendar_blocks")
        .insert(payload)
        .select("id, listing_id, start_date, end_date, start_at, end_at, source, label, color")
        .single();

    let { data, error } = await insertRow(insertPayload);

    if (error && isMissingBlockColumn(error)) {
      if (hasTimeRange) {
        return res.status(400).json({
          error: "Hourly blocks are not supported yet. Add start_at and end_at columns.",
        });
      }
      const fallbackPayload = { ...insertPayload };
      delete fallbackPayload.notes;
      delete fallbackPayload.created_by;
      ({ data, error } = await insertRow(fallbackPayload));
    }

    if (error) {
      console.error("[api/manual-blocks] failed to create manual block", error);
      return res.status(500).json({ error: error.message, details: error });
    }

    return res.status(200).json({ ok: true, inserted: data });
  } catch (err: any) {
    console.error("[api/manual-blocks] unexpected error", err);
    return res
      .status(500)
      .json({ error: err?.message ?? "Failed to create manual block.", details: err });
  }
}
