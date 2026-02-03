import type { NextApiRequest, NextApiResponse } from "next";

type ParsedEvent = {
  uid?: string | null;
  start: string;
  end: string;
  summary?: string | null;
  url?: string | null;
  nights?: number | null;
};

const parseICalDate = (value: string | undefined | null): string | null => {
  if (!value) return null;
  const raw = value.trim();
  const dateMatch = raw.match(/(\d{4})(\d{2})(\d{2})(T(\d{2})(\d{2})(\d{2})Z)?/);
  if (!dateMatch) return null;

  const [, year, month, day, hasTime, hours, minutes, seconds] = dateMatch;
  if (hasTime) {
    return new Date(
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hours),
        Number(minutes),
        Number(seconds)
      )
    ).toISOString();
  }
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).toISOString();
};

const normalizeEnd = (iso: string | null) => {
  if (!iso) return null;
  const date = new Date(iso);
  // iCal DTEND is exclusive; subtract 1 day so the block includes the final day.
  date.setDate(date.getDate() - 1);
  return date.toISOString();
};

const computeNights = (startIso: string, endIso: string) => {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const diffMs = end.getTime() - start.getTime();
  const nights = Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1;
  return Number.isFinite(nights) && nights > 0 ? nights : 1;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { url } = req.body as { url?: string };

  if (!url) {
    return res.status(400).json({ error: "Missing iCal URL" });
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(response.status).json({ error: "Unable to fetch iCal feed." });
    }
    const payload = await response.text();
    const blocks = payload.split("BEGIN:VEVENT").slice(1);
    const events: ParsedEvent[] = [];

    blocks.forEach((chunk) => {
      const body = chunk.split("END:VEVENT")[0];
      const dtStartLine = body.match(/DTSTART[^:]*:(.*)/);
      const dtEndLine = body.match(/DTEND[^:]*:(.*)/);
      const summaryLine = body.match(/SUMMARY[^:]*:(.*)/);
      const uidLine = body.match(/UID[^:]*:(.*)/);
      const urlLine = body.match(/URL[^:]*:(.*)/);
      const start = parseICalDate(dtStartLine?.[1]);
      const end = normalizeEnd(parseICalDate(dtEndLine?.[1]));
      if (start && end) {
        events.push({
          uid: uidLine?.[1]?.trim() ?? null,
          start,
          end,
          summary: summaryLine?.[1]?.trim() ?? null,
          url: urlLine?.[1]?.trim() ?? null,
          nights: computeNights(start, end),
        });
      }
    });

    return res.status(200).json({ events });
  } catch (err: any) {
    console.error("[ical] import error", err?.message ?? err);
    return res.status(500).json({ error: "Failed to import iCal feed." });
  }
}
