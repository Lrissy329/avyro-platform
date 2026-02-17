export type ChannelId = "direct" | "airbnb" | "vrbo" | "other" | "blocked";

export interface CalendarEvent {
  id: string;
  listingId: string;
  unitId?: string;
  channel: ChannelId;
  kind: "booking" | "block";
  status?: "confirmed" | "pending" | "cancelled";
  startDate: string;
  endDate: string;
}

export type DayState =
  | "free"
  | "direct_confirmed"
  | "direct_pending"
  | "blocked"
  | "external"
  | "conflict";

export interface DateRange {
  start: Date;
  end: Date;
}

export type BookingStatus =
  | "awaiting_payment"
  | "approved"
  | "confirmed"
  | "paid"
  | "payment_failed"
  | "declined"
  | "cancelled";

export type BookingStayType = "nightly" | "day_use" | "split_rest" | "crashpad";

export type BookingChannel =
  | "direct"
  | "airbnb"
  | "vrbo"
  | "bookingcom"
  | "expedia"
  | "manual"
  | "other";

export type LinearCalendarSource =
  | "booking"
  | "manual"
  | "airbnb"
  | "vrbo"
  | "bookingcom"
  | "expedia"
  | "other";

export type LinearCalendarEvent = {
  id: string;
  listingId: string;
  start: Date;
  end: Date;
  label: string;
  color: string;
  textColor?: string;
  source: LinearCalendarSource;
  visible?: boolean;
  badgeLabel?: string | null;
  meta?: {
    kind?: "booking" | "block";
    isHourly?: boolean;
    status?: BookingStatus;
    nightlyRate?: number | null;
    currency?: string | null;
    nights?: number;
    reason?: string | null;
    total?: number | null;
    externalUrl?: string | null;
    guestName?: string | null;
    guestEmail?: string | null;
    guestPhone?: string | null;
    notes?: string | null;
    reference?: string | null;
    hostPayout?: number | null;
    listingName?: string | null;
    listingShortName?: string | null;
    bookingCode?: string | null;
    stayType?: string | null;
    guests?: number | null;
    payoutNote?: string | null;
  };
};

export type RatesByListingDate = Record<
  string,
  Record<string, { price: number; currency: string }>
>;

export type ParsedIcalEvent = {
  uid?: string | null;
  start: Date;
  end: Date;
  summary?: string | null;
  url?: string | null;
  nights?: number | null;
};
