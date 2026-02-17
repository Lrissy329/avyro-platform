export interface Listing {
  id: string;
  title: string;
  description: string;
  location: string; // e.g. "Stansted, UK (STN)"
  airportCode: string; // e.g. "STN"
  hostId: string;

  listing_type: "private_room" | "entire_place";
  rental_type?: "overnight_stay" | "crashpad" | "day_use" | "split_rest";
  booking_unit?: "nightly" | "hourly";
  beds: number;
  bathrooms: number;

  price_per_night: number;
  price_per_hour?: number;
  price_per_week?: number;
  price_per_month?: number;

  available_from: string; // ISO date
  available_to: string;

  amenities: string[]; // wifi, kitchen, etc.
  image_url: string;

  /** Map coordinates as [lng, lat]. Optional for items without a location. */
  coords?: [number, number];

  /** Straight-line distance to the linked airport, in km (nullable). */
  distance_km_to_airport?: number | null;
  /** Approx off-peak drive minutes to airport (nullable). */
  drive_minutes_offpeak?: number | null;
  /** Optional peak-time drive minutes to airport (nullable). */
  drive_minutes_peak?: number | null;

  created_at: string;
  updated_at: string;
}
