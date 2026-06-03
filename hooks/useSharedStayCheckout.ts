import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  SharedDateRange,
  SharedGroupOptionsResponse,
} from "@/components/shared-stay/types";

type SharedCheckoutAction = "join" | "start";

type StartSharedCheckoutInput = {
  accessToken: string;
  action: SharedCheckoutAction;
  sharedGroupId?: string;
  checkIn?: string;
  checkOut?: string;
};

type StartSharedCheckoutResult = {
  checkoutUrl: string;
  sharedGroupId: string;
  sharedGroupMemberId: string;
};

type UseSharedStayCheckoutInput = {
  listingId?: string | null;
  selectedDateRange?: SharedDateRange;
  enabled?: boolean;
};

const __DEV__ = process.env.NODE_ENV !== "production";
const ENABLE_SHARED_STAY_DEBUG = process.env.NEXT_PUBLIC_DEBUG_SHARED_STAY === "true";
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const isDateOnly = (value?: string | null) => Boolean(value && DATE_ONLY_PATTERN.test(value));
const INVALID_LISTING_IDS = new Set(["", "undefined", "null"]);

const normalizeListingId = (value?: string | null) => {
  const normalized = typeof value === "string" ? value.trim() : "";
  return INVALID_LISTING_IDS.has(normalized) ? "" : normalized;
};

function debugLog(payload: Record<string, unknown>) {
  if (!__DEV__ || !ENABLE_SHARED_STAY_DEBUG) return;
  console.log("SHARED_STAY_HOOK_DEBUG\n" + JSON.stringify(payload, null, 2));
}

async function parseJsonResponse(response: Response) {
  const raw = await response.text().catch(() => "");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

export function useSharedStayCheckout({
  listingId,
  selectedDateRange,
  enabled = true,
}: UseSharedStayCheckoutInput) {
  const [options, setOptions] = useState<SharedGroupOptionsResponse | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const safeListingId = useMemo(() => normalizeListingId(listingId), [listingId]);
  const cancelledRef = useRef(false);
  const activeRequestKeyRef = useRef<string | null>(null);
  const requestSequenceRef = useRef(0);
  const lastRequestKeyRef = useRef("");
  const loggedEventsRef = useRef<Set<string>>(new Set());

  const checkIn = selectedDateRange?.checkIn ?? "";
  const checkOut = selectedDateRange?.checkOut ?? "";
  const hasValidRange = useMemo(
    () => isDateOnly(checkIn) && isDateOnly(checkOut) && checkOut > checkIn,
    [checkIn, checkOut]
  );
  const shouldFetchOptions = enabled && Boolean(safeListingId);
  const requestKey = useMemo(() => {
    if (!shouldFetchOptions) return "";
    const rangeKey = hasValidRange ? `${checkIn}:${checkOut}` : "open";
    return `${safeListingId}|${rangeKey}`;
  }, [checkIn, checkOut, hasValidRange, safeListingId, shouldFetchOptions]);

  const debugLogOnce = useCallback((phase: string, key: string, payload: Record<string, unknown>) => {
    if (!__DEV__ || !ENABLE_SHARED_STAY_DEBUG || !key) return;
    const eventKey = `${phase}|${key}`;
    if (loggedEventsRef.current.has(eventKey)) return;
    loggedEventsRef.current.add(eventKey);
    debugLog(payload);
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const refreshOptions = useCallback(async (force = false) => {
    if (!shouldFetchOptions) {
      activeRequestKeyRef.current = null;
      lastRequestKeyRef.current = "";
      loggedEventsRef.current.clear();
      setOptions(null);
      setOptionsError(null);
      setOptionsLoading(false);
      debugLog({
        phase: "refresh_skip",
        listingId: safeListingId || listingId || null,
        enabled,
        hasValidRange,
        checkIn: checkIn || null,
        checkOut: checkOut || null,
      });
      return null;
    }

    if (!force && requestKey === lastRequestKeyRef.current) {
      debugLogOnce("refresh_deduped", requestKey, {
        phase: "refresh_deduped",
        requestKey,
        listingId: safeListingId,
        checkIn: hasValidRange ? checkIn : null,
        checkOut: hasValidRange ? checkOut : null,
      });
      return null;
    }

    lastRequestKeyRef.current = requestKey;
    activeRequestKeyRef.current = requestKey;
    const requestId = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestId;
    setOptionsLoading(true);
    setOptionsError(null);

    try {
      const params = new URLSearchParams({ listingId: safeListingId });
      if (hasValidRange) {
        params.set("checkIn", checkIn);
        params.set("checkOut", checkOut);
      }
      debugLogOnce("refresh_start", requestKey, {
        phase: "refresh_start",
        requestKey,
        listingId: safeListingId,
        checkIn: hasValidRange ? checkIn : null,
        checkOut: hasValidRange ? checkOut : null,
      });
      const response = await fetch(`/api/shared-groups/options?${params.toString()}`);
      const payload = await parseJsonResponse(response);
      if (!response.ok) {
        const message =
          (payload &&
            typeof payload === "object" &&
            "error" in payload &&
            typeof (payload as { error?: unknown }).error === "string" &&
            (payload as { error: string }).error) ||
          `Unable to load shared stay options (${response.status}).`;
        debugLogOnce("refresh_error_response", requestKey, {
          phase: "refresh_error_response",
          requestKey,
          listingId: safeListingId,
          checkIn: hasValidRange ? checkIn : null,
          checkOut: hasValidRange ? checkOut : null,
          status: response.status,
          payload,
          message,
        });
        throw new Error(message);
      }
      if (!payload || typeof payload !== "object") {
        const message = "Shared stay options returned an invalid response.";
        debugLogOnce("refresh_invalid_payload", requestKey, {
          phase: "refresh_invalid_payload",
          requestKey,
          listingId: safeListingId,
          checkIn: hasValidRange ? checkIn : null,
          checkOut: hasValidRange ? checkOut : null,
          status: response.status,
          payload,
          message,
        });
        throw new Error(message);
      }
      const typedPayload = payload as SharedGroupOptionsResponse;
      if (
        cancelledRef.current ||
        requestSequenceRef.current !== requestId ||
        activeRequestKeyRef.current !== requestKey
      ) {
        debugLogOnce("refresh_stale_ignored", requestKey, {
          phase: "refresh_stale_ignored",
          requestKey,
          listingId: safeListingId,
          checkIn: hasValidRange ? checkIn : null,
          checkOut: hasValidRange ? checkOut : null,
        });
        return null;
      }
      setOptions(typedPayload);
      debugLogOnce("refresh_success", requestKey, {
        phase: "refresh_success",
        requestKey,
        listingId: safeListingId,
        checkIn: hasValidRange ? checkIn : null,
        checkOut: hasValidRange ? checkOut : null,
        status: response.status,
        groups: Array.isArray(typedPayload.groups) ? typedPayload.groups.length : 0,
      });
      return typedPayload;
    } catch (error: any) {
      if (
        cancelledRef.current ||
        requestSequenceRef.current !== requestId ||
        activeRequestKeyRef.current !== requestKey
      ) {
        return null;
      }
      setOptions(null);
      const message = error?.message ?? "Unable to load shared stay options.";
      setOptionsError(message);
      debugLogOnce("refresh_exception", requestKey, {
        phase: "refresh_exception",
        requestKey,
        listingId: safeListingId || listingId || null,
        checkIn: hasValidRange ? checkIn : null,
        checkOut: hasValidRange ? checkOut : null,
        message,
      });
      return null;
    } finally {
      if (
        !cancelledRef.current &&
        requestSequenceRef.current === requestId &&
        activeRequestKeyRef.current === requestKey
      ) {
        setOptionsLoading(false);
      }
    }
  }, [
    checkIn,
    checkOut,
    debugLogOnce,
    enabled,
    hasValidRange,
    listingId,
    requestKey,
    safeListingId,
    shouldFetchOptions,
  ]);

  useEffect(() => {
    refreshOptions().catch(() => null);
  }, [refreshOptions]);

  const startCheckout = useCallback(
    async ({ accessToken, action, sharedGroupId, checkIn: explicitCheckIn, checkOut: explicitCheckOut }: StartSharedCheckoutInput) => {
      const checkoutCheckIn = explicitCheckIn ?? checkIn;
      const checkoutCheckOut = explicitCheckOut ?? checkOut;

      if (!safeListingId || !enabled || !isDateOnly(checkoutCheckIn) || !isDateOnly(checkoutCheckOut)) {
        throw new Error("Please choose valid shared-stay dates first.");
      }

      const response = await fetch("/api/shared-groups/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          listingId: safeListingId,
          checkIn: checkoutCheckIn,
          checkOut: checkoutCheckOut,
          action,
          sharedGroupId: action === "join" ? sharedGroupId : undefined,
        }),
      });

      const payload = await parseJsonResponse(response);
      if (!response.ok) {
        const message =
          (payload &&
            typeof payload === "object" &&
            "error" in payload &&
            typeof (payload as { error?: unknown }).error === "string" &&
            (payload as { error: string }).error) ||
          `Unable to start shared-stay checkout (${response.status}).`;
        debugLog({
          phase: "checkout_error_response",
          listingId: safeListingId,
          checkIn: checkoutCheckIn,
          checkOut: checkoutCheckOut,
          action,
          sharedGroupId: sharedGroupId ?? null,
          status: response.status,
          payload,
          message,
        });
        const codedError = new Error(message) as Error & { code?: string };
        codedError.code =
          payload && typeof payload === "object" && "code" in payload
            ? ((payload as { code?: string }).code ?? undefined)
            : undefined;
        throw codedError;
      }

      if (
        !payload ||
        typeof payload !== "object" ||
        !("checkoutUrl" in payload) ||
        typeof (payload as { checkoutUrl?: unknown }).checkoutUrl !== "string"
      ) {
        debugLog({
          phase: "checkout_invalid_payload",
          listingId: safeListingId,
          checkIn: checkoutCheckIn,
          checkOut: checkoutCheckOut,
          action,
          sharedGroupId: sharedGroupId ?? null,
          status: response.status,
          payload,
        });
        throw new Error("Shared checkout URL was not returned.");
      }

      debugLog({
        phase: "checkout_success",
        listingId: safeListingId,
        checkIn: checkoutCheckIn,
        checkOut: checkoutCheckOut,
        action,
        sharedGroupId: sharedGroupId ?? null,
        status: response.status,
      });
      return payload as StartSharedCheckoutResult;
    },
    [checkIn, checkOut, enabled, safeListingId]
  );

  return {
    options,
    optionsLoading,
    optionsError,
    hasValidRange,
    refreshOptions,
    startCheckout,
  };
}

export type { SharedCheckoutAction, StartSharedCheckoutInput, StartSharedCheckoutResult };
