export type ListingReadinessStatus = "draft" | "needs_action" | "search_ready";

type ListingReadinessInput = {
  booking_unit?: "nightly" | "hourly" | null;
  rental_type?: string | null;
  price_per_night?: number | null;
  price_per_hour?: number | null;
  is_shared_stay?: boolean | null;
  shared_weekly_price_pence?: number | null;
  airport_code?: string | null;
  photos?: string[] | null;
};

type ListingReadinessOptions = {
  stripeConnected: boolean;
  availabilityConfigured: boolean;
};

export type ListingReadiness = {
  status: ListingReadinessStatus;
  supportedInPublicSearch: boolean;
  minimumPhotosMet: boolean;
  pricingConfigured: boolean;
  airportAssigned: boolean;
  stripeConnected: boolean;
  availabilityConfigured: boolean;
  reasons: string[];
};

const hasPositiveNumber = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

export function evaluateListingReadiness(
  listing: ListingReadinessInput,
  options: ListingReadinessOptions
): ListingReadiness {
  const bookingUnit = listing.booking_unit ?? "nightly";
  const rentalType = String(listing.rental_type ?? "").toLowerCase();
  const supportedInPublicSearch =
    bookingUnit !== "hourly" && rentalType !== "day_use" && rentalType !== "split_rest";
  const photos = Array.isArray(listing.photos) ? listing.photos.filter(Boolean) : [];
  const minimumPhotosMet = photos.length >= 5;
  const airportAssigned = Boolean(String(listing.airport_code ?? "").trim());
  const pricingConfigured = Boolean(
    listing.is_shared_stay
      ? hasPositiveNumber(listing.shared_weekly_price_pence)
      : bookingUnit === "hourly"
      ? hasPositiveNumber(listing.price_per_hour)
      : hasPositiveNumber(listing.price_per_night)
  );
  const stripeConnected = options.stripeConnected;
  const availabilityConfigured = options.availabilityConfigured;

  const reasons: string[] = [];
  if (!supportedInPublicSearch) reasons.push("Not currently visible in public search.");
  if (!minimumPhotosMet) reasons.push("Add at least 5 photos.");
  if (!pricingConfigured) reasons.push("Add pricing.");
  if (!airportAssigned) reasons.push("Assign the nearest airport.");
  if (!stripeConnected) reasons.push("Connect Stripe to receive payouts.");
  if (!availabilityConfigured) reasons.push("Set availability in your calendar.");

  let status: ListingReadinessStatus = "needs_action";
  if (reasons.length === 0) {
    status = "search_ready";
  } else if (!minimumPhotosMet && !pricingConfigured && !airportAssigned) {
    status = "draft";
  }

  return {
    status,
    supportedInPublicSearch,
    minimumPhotosMet,
    pricingConfigured,
    airportAssigned,
    stripeConnected,
    availabilityConfigured,
    reasons,
  };
}
