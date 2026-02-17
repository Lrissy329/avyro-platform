import type { DateRange } from "@/lib/calendarTypes";
import { formatLocalDate, startOfDay } from "@/lib/dateUtils";

export type BlockDatesPayload = {
  label: string;
  notes?: string;
  color?: string;
};

const buildApiError = async (response: Response, fallbackMessage: string) => {
  const contentType = response.headers.get("content-type") ?? "";
  let errorBody = "";
  let errorMessage = "";

  if (contentType.includes("application/json")) {
    try {
      const parsed = await response.json();
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.error === "string") {
          errorMessage = parsed.error;
        } else if (typeof parsed.message === "string") {
          errorMessage = parsed.message;
        }
        errorBody = JSON.stringify(parsed);
      }
    } catch {
      // ignore parsing errors
    }
  }

  if (!errorBody) {
    try {
      errorBody = await response.text();
    } catch {
      errorBody = "";
    }
  }

  const detail = errorBody || errorMessage || response.statusText;
  return new Error(detail ? fallbackMessage + ": " + detail : fallbackMessage);
};

export async function createManualBlockForRange(
  listingId: string,
  range: DateRange,
  payload: BlockDatesPayload
) {
  const response = await fetch("/api/manual-blocks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      listingId,
      startDate: formatLocalDate(startOfDay(range.start)),
      endDate: formatLocalDate(startOfDay(range.end)),
      notes: payload.notes?.trim() || undefined,
      label: payload.label,
      color: payload.color,
    }),
  });

  if (!response.ok) {
    throw await buildApiError(response, "Failed to create manual block");
  }

  return response.json();
}

export async function createManualBlockForTimes(
  listingId: string,
  startAt: Date,
  endAt: Date,
  payload: BlockDatesPayload
) {
  const response = await fetch("/api/manual-blocks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      listingId,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      notes: payload.notes?.trim() || undefined,
      label: payload.label,
      color: payload.color,
    }),
  });

  if (!response.ok) {
    throw await buildApiError(response, "Failed to create hourly block");
  }

  return response.json();
}

export async function deleteManualBlock(blockId: string) {
  const response = await fetch("/api/manual-blocks", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id: blockId }),
  });

  if (!response.ok) {
    throw await buildApiError(response, "Failed to delete manual block");
  }

  return response.json();
}

export async function updateManualBlockNotes(blockId: string, notes: string) {
  const response = await fetch("/api/manual-blocks", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id: blockId, notes }),
  });

  if (!response.ok) {
    throw await buildApiError(response, "Failed to update manual block notes");
  }

  return response.json();
}
