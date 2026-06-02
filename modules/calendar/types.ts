export type HostCalendarView = "scheduler" | "hourly" | "month";

export type CalendarFeedListing = {
  id: string;
  title: string;
  address?: string;
  hourlyEnabled?: boolean;
};

export type CalendarFeedBooking = {
  id: string;
  listingId: string;
  guestName: string | null;
  start: string;
  end: string;
  channel: string;
  status: string;
  totalPence?: number;
  payoutEstimatePence?: number;
  bookingType?: "nightly" | "hourly";
  currency?: string;
  flexMode?: "none" | "extra_night" | "rolling" | null;
  flexCurrentConfirmedEnd?: string | null;
  flexMaxEnd?: string | null;
  flexExtensionCutoffAt?: string | null;
  flexExtraNight?: boolean;
  flexExtraNightStatus?: "reserved" | "used" | "released" | "expired" | null;
  flexExtraNightPricePence?: number | null;
};

export type CalendarFeedBlock = {
  id: string;
  listingId: string;
  start: string;
  end: string;
  reason?: string;
  blockType?: "nightly" | "hourly" | "flex_optional" | "flex_rolling_held" | "shared_group";
  bookingId?: string;
  cutoffAt?: string | null;
  maxEnd?: string | null;
  confirmedEnd?: string | null;
  sharedGroupId?: string;
  sharedTotalSpots?: number;
  sharedFilledSpots?: number;
  sharedPendingSpots?: number;
};

export type CalendarFeed = {
  listings: CalendarFeedListing[];
  bookings: CalendarFeedBooking[];
  blocks: CalendarFeedBlock[];
  rates?: Record<string, Record<string, number>>;
};

export type CalendarSelection = {
  listingId: string;
  start: string;
  end: string;
};

export type ReservationRecord = {
  id: string;
  listingId: string;
  listingTitle: string;
  guestName: string | null;
  start: string;
  end: string;
  channel: string;
  status: string;
  totalPence?: number;
  payoutEstimatePence?: number;
  currency?: string;
  address?: string;
  bookingType?: "nightly" | "hourly";
  isBlock?: boolean;
  flexMode?: "none" | "extra_night" | "rolling" | null;
  flexCurrentConfirmedEnd?: string | null;
  flexMaxEnd?: string | null;
  flexExtensionCutoffAt?: string | null;
  flexExtraNight?: boolean;
  flexExtraNightStatus?: "reserved" | "used" | "released" | "expired" | null;
  flexExtraNightPricePence?: number | null;
  sharedGroupId?: string | null;
  sharedTotalSpots?: number | null;
  sharedFilledSpots?: number | null;
  sharedPendingSpots?: number | null;
};

export type EventMapResult = {
  events: any[];
  reservationsByEventId: Record<string, ReservationRecord>;
};

export type SchedulerEventMapResult = EventMapResult & {
  cellStatesByListingDate: Record<string, "booked" | "blocked">;
};
