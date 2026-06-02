import { useCallback, useEffect, useMemo, useState } from "react";
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
  listingId: string;
  selectedDateRange?: SharedDateRange;
  enabled?: boolean;
};

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const isDateOnly = (value?: string | null) => Boolean(value && DATE_ONLY_PATTERN.test(value));

export function useSharedStayCheckout({
  listingId,
  selectedDateRange,
  enabled = true,
}: UseSharedStayCheckoutInput) {
  const [options, setOptions] = useState<SharedGroupOptionsResponse | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  const checkIn = selectedDateRange?.checkIn ?? "";
  const checkOut = selectedDateRange?.checkOut ?? "";
  const hasValidRange = useMemo(
    () => isDateOnly(checkIn) && isDateOnly(checkOut) && checkOut > checkIn,
    [checkIn, checkOut]
  );

  const refreshOptions = useCallback(async () => {
    if (!enabled || !listingId || !hasValidRange) {
      setOptions(null);
      setOptionsError(null);
      setOptionsLoading(false);
      return null;
    }

    setOptionsLoading(true);
    setOptionsError(null);

    try {
      const params = new URLSearchParams({
        listingId,
        checkIn,
        checkOut,
      });
      const response = await fetch(`/api/shared-groups/options?${params.toString()}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to load shared stay options.");
      }
      const typedPayload = payload as SharedGroupOptionsResponse;
      setOptions(typedPayload);
      return typedPayload;
    } catch (error: any) {
      setOptions(null);
      setOptionsError(error?.message ?? "Unable to load shared stay options.");
      return null;
    } finally {
      setOptionsLoading(false);
    }
  }, [checkIn, checkOut, enabled, hasValidRange, listingId]);

  useEffect(() => {
    refreshOptions().catch(() => null);
  }, [refreshOptions]);

  const startCheckout = useCallback(
    async ({ accessToken, action, sharedGroupId, checkIn: explicitCheckIn, checkOut: explicitCheckOut }: StartSharedCheckoutInput) => {
      const checkoutCheckIn = explicitCheckIn ?? checkIn;
      const checkoutCheckOut = explicitCheckOut ?? checkOut;

      if (!listingId || !isDateOnly(checkoutCheckIn) || !isDateOnly(checkoutCheckOut)) {
        throw new Error("Please choose valid shared-stay dates first.");
      }

      const response = await fetch("/api/shared-groups/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          listingId,
          checkIn: checkoutCheckIn,
          checkOut: checkoutCheckOut,
          action,
          sharedGroupId: action === "join" ? sharedGroupId : undefined,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload?.error ?? "Unable to start shared-stay checkout.";
        const codedError = new Error(message) as Error & { code?: string };
        codedError.code = payload?.code;
        throw codedError;
      }

      if (!payload?.checkoutUrl || typeof payload.checkoutUrl !== "string") {
        throw new Error("Shared checkout URL was not returned.");
      }

      return payload as StartSharedCheckoutResult;
    },
    [checkIn, checkOut, listingId]
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
