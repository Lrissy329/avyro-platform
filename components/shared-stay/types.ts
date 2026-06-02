export type SharedJoinMode = "open" | "approval";

export type SharedGroupOption = {
  id: string;
  listingId: string;
  startDate: string;
  endDate: string;
  totalSpots: number;
  filledSpots: number;
  activeHolds: number;
  spotsRemaining: number;
  status: "open" | "full" | "closed" | "cancelled";
  canJoin: boolean;
};

export type SharedGroupOptionsResponse = {
  listingId?: string;
  checkIn?: string;
  checkOut?: string;
  sharedEnabled: boolean;
  joinMode: SharedJoinMode;
  weeks: number;
  minWeeks: number;
  maxWeeks: number;
  perPersonWeeklyPricePence: number | null;
  totalPricePence: number | null;
  groups: SharedGroupOption[];
  suggestedJoinGroupId: string | null;
  reason?: string;
};

export type SharedDateRange = {
  checkIn?: string | null;
  checkOut?: string | null;
};
