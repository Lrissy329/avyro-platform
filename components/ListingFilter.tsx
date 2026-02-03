import { useEffect, useState } from "react";
import {
  HomeModernIcon,
  BuildingOfficeIcon,
  UsersIcon,
  WifiIcon,
  FireIcon,
  BriefcaseIcon,
  ClockIcon,
  MoonIcon,
  BellSlashIcon,
  KeyIcon,
} from "@heroicons/react/24/outline";

type FilterPatch = Record<string, string | number | boolean | undefined>;

type ChipProps = {
  label: string;
  icon?: React.ReactNode;
  active?: boolean;
  onClick: () => void;
};

const Chip = ({ label, icon, active, onClick }: ChipProps) => (
  <button
    type="button"
    onClick={onClick}
  className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition ${
      active ? "border-[#FEDD02] bg-[#FEDD02] text-black shadow-sm" : "border-neutral-300 text-neutral-800 hover:border-neutral-500"
    }`}
  >
    {icon}
    <span>{label}</span>
  </button>
);

export default function ListingFilter({
  query,
  onChange,
}: {
  query: Record<string, any>;
  onChange: (patch: FilterPatch) => void;
}) {
  const [airport, setAirport] = useState<string>(query.airport || "");
  const [roomType, setRoomType] = useState<string>(query.roomType || "");
  const [priceBand, setPriceBand] = useState<"" | "budget" | "mid" | "premium">("");
  const [hasWifi, setHasWifi] = useState<boolean>(!!toBool(query.has_wifi));
  const [hasKitchen, setHasKitchen] = useState<boolean>(!!toBool(query.has_kitchen));
  const [hasDesk, setHasDesk] = useState<boolean>(!!toBool(query.has_desk));
  const [isSharedBookingAllowed, setIsSharedBookingAllowed] = useState<boolean>(
    toBool(query.is_shared_booking_allowed) ?? false
  );
  const [commuteMax, setCommuteMax] = useState<"" | 15 | 30>(
    query.commute_max ? (Number(query.commute_max) as 15 | 30) : ""
  );
  const [hasBlackout, setHasBlackout] = useState<boolean>(!!toBool(query.blackout));
  const [hasQuiet, setHasQuiet] = useState<boolean>(!!toBool(query.quiet));
  const [hasAccess247, setHasAccess247] = useState<boolean>(!!toBool(query.access_24_7));
  const [moreOpen, setMoreOpen] = useState(false);

  // modal-local state mirrors the same filters for apply/reset
  const [modalCommute, setModalCommute] = useState<"" | 15 | 30>(
    query.commute_max ? (Number(query.commute_max) as 15 | 30) : ""
  );
  const [modalBlackout, setModalBlackout] = useState(!!toBool(query.blackout));
  const [modalQuiet, setModalQuiet] = useState(!!toBool(query.quiet));
  const [modalAccess, setModalAccess] = useState(!!toBool(query.access_24_7));
  const [modalWifi, setModalWifi] = useState(!!toBool(query.has_wifi));
  const [modalKitchen, setModalKitchen] = useState(!!toBool(query.has_kitchen));
  const [modalDesk, setModalDesk] = useState(!!toBool(query.has_desk));

  // Sync from URL/query
  useEffect(() => {
    setAirport(query.airport || "");
    setRoomType(query.roomType || "");
    setHasWifi(!!toBool(query.has_wifi));
    setHasKitchen(!!toBool(query.has_kitchen));
    setHasDesk(!!toBool(query.has_desk));
    setIsSharedBookingAllowed(!!toBool(query.is_shared_booking_allowed));
    setCommuteMax(query.commute_max ? (Number(query.commute_max) as 15 | 30) : "");
    setHasBlackout(!!toBool(query.blackout));
    setHasQuiet(!!toBool(query.quiet));
    setHasAccess247(!!toBool(query.access_24_7));
    setModalCommute(query.commute_max ? (Number(query.commute_max) as 15 | 30) : "");
    setModalBlackout(!!toBool(query.blackout));
    setModalQuiet(!!toBool(query.quiet));
    setModalAccess(!!toBool(query.access_24_7));
    setModalWifi(!!toBool(query.has_wifi));
    setModalKitchen(!!toBool(query.has_kitchen));
    setModalDesk(!!toBool(query.has_desk));

    const min = Number(query.priceMin ?? NaN);
    const max = Number(query.priceMax ?? NaN);
    if (!Number.isNaN(min) && min >= 150) setPriceBand("premium");
    else if (!Number.isNaN(min) && min >= 75) setPriceBand("mid");
    else if (!Number.isNaN(max) && max <= 75) setPriceBand("budget");
    else setPriceBand("");
  }, [query]);

  const applyPriceBand = (band: "" | "budget" | "mid" | "premium") => {
    setPriceBand(band);
    if (band === "budget") onChange({ priceMin: undefined, priceMax: 75 });
    else if (band === "mid") onChange({ priceMin: 75, priceMax: 150 });
    else if (band === "premium") onChange({ priceMin: 150, priceMax: undefined });
    else onChange({ priceMin: undefined, priceMax: undefined });
  };

  return (
    <div className="w-full border-b border-neutral-200 bg-white/95 px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        {/* Airport */}
        <select
          className="rounded-xl border border-neutral-300 px-3 py-2 text-sm"
          value={airport}
          onChange={(e) => {
            const v = e.target.value;
            setAirport(v);
            onChange({ airport: v || undefined });
          }}
        >
          <option value="">All airports</option>
          <option value="LHR">London Heathrow (LHR)</option>
          <option value="LGW">London Gatwick (LGW)</option>
          <option value="STN">London Stansted (STN)</option>
          <option value="LTN">London Luton (LTN)</option>
        </select>

        {/* Room types */}
        <div className="flex flex-wrap items-center gap-2">
          <Chip
            label="Entire place"
            icon={<HomeModernIcon className="h-4 w-4" />}
            active={roomType === "entire"}
            onClick={() => {
              const next = roomType === "entire" ? "" : "entire";
              setRoomType(next);
              onChange({ roomType: next || undefined });
            }}
          />
          <Chip
            label="Private room"
            icon={<BuildingOfficeIcon className="h-4 w-4" />}
            active={roomType === "private"}
            onClick={() => {
              const next = roomType === "private" ? "" : "private";
              setRoomType(next);
              onChange({ roomType: next || undefined });
            }}
          />
          <Chip
            label="Shared room"
            icon={<UsersIcon className="h-4 w-4" />}
            active={roomType === "shared"}
            onClick={() => {
              const next = roomType === "shared" ? "" : "shared";
              setRoomType(next);
              onChange({ roomType: next || undefined });
            }}
          />
        </div>

        {/* Price bands */}
        <div className="flex flex-wrap items-center gap-2">
          <Chip label="£0–75" active={priceBand === "budget"} onClick={() => applyPriceBand(priceBand === "budget" ? "" : "budget")} />
          <Chip label="£75–150" active={priceBand === "mid"} onClick={() => applyPriceBand(priceBand === "mid" ? "" : "mid")} />
          <Chip label="£150+" active={priceBand === "premium"} onClick={() => applyPriceBand(priceBand === "premium" ? "" : "premium")} />
        </div>

        {/* Amenities / toggles */}
        <div className="flex flex-wrap items-center gap-2">
          <Chip
            label="Wi‑Fi"
            icon={<WifiIcon className="h-4 w-4" />}
            active={hasWifi}
            onClick={() => {
              const next = !hasWifi;
              setHasWifi(next);
              onChange({ has_wifi: next || undefined });
            }}
          />
          <Chip
            label="Kitchen"
            icon={<FireIcon className="h-4 w-4" />}
            active={hasKitchen}
            onClick={() => {
              const next = !hasKitchen;
              setHasKitchen(next);
              onChange({ has_kitchen: next || undefined });
            }}
          />
          <Chip
            label="Desk"
            icon={<BriefcaseIcon className="h-4 w-4" />}
            active={hasDesk}
            onClick={() => {
              const next = !hasDesk;
              setHasDesk(next);
              onChange({ has_desk: next || undefined });
            }}
          />
          <Chip
            label="Shared booking"
            active={isSharedBookingAllowed}
            onClick={() => {
              const next = !isSharedBookingAllowed;
              setIsSharedBookingAllowed(next);
              onChange({ is_shared_booking_allowed: next || undefined });
            }}
          />
        </div>

        {/* Commute time filters */}
        <div className="flex flex-wrap items-center gap-2">
          <Chip
            label="≤ 15 min to airport"
            icon={<ClockIcon className="h-4 w-4" />}
            active={commuteMax === 15}
            onClick={() => {
              const next = commuteMax === 15 ? "" : 15;
              setCommuteMax(next);
              onChange({ commute_max: next || undefined });
            }}
          />
          <Chip
            label="≤ 30 min to airport"
            icon={<ClockIcon className="h-4 w-4" />}
            active={commuteMax === 30}
            onClick={() => {
              const next = commuteMax === 30 ? "" : 30;
              setCommuteMax(next);
              onChange({ commute_max: next || undefined });
            }}
          />
        </div>

        {/* Crew rest toggles */}
        <div className="flex flex-wrap items-center gap-2">
          <Chip
            label="Blackout blinds"
            icon={<MoonIcon className="h-4 w-4" />}
            active={hasBlackout}
            onClick={() => {
              const next = !hasBlackout;
              setHasBlackout(next);
              onChange({ blackout: next || undefined });
            }}
          />
          <Chip
            label="Quiet for rest"
            icon={<BellSlashIcon className="h-4 w-4" />}
            active={hasQuiet}
            onClick={() => {
              const next = !hasQuiet;
              setHasQuiet(next);
              onChange({ quiet: next || undefined });
            }}
          />
          <Chip
            label="24/7 access"
            icon={<KeyIcon className="h-4 w-4" />}
            active={hasAccess247}
            onClick={() => {
              const next = !hasAccess247;
              setHasAccess247(next);
              onChange({ access_24_7: next || undefined });
            }}
          />
        </div>

        {/* To add more crew-specific pills later, follow the pattern above: define state, sync from query, and map to a query param via onChange. */}

        {/* More filters trigger */}
        <div className="flex flex-wrap items-center gap-2">
          <Chip
            label="More filters"
            active={moreOpen}
            onClick={() => setMoreOpen(true)}
          />
        </div>
      </div>

      {/* Lightweight modal (shadcn-style appearance) */}
      {moreOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="relative w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
              <h3 className="text-lg font-semibold text-neutral-900">More filters</h3>
              <button
                onClick={() => setMoreOpen(false)}
                className="rounded-full border border-neutral-200 px-3 py-1 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                Close
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto px-6 py-4 space-y-6">
              {/* Commute options */}
              <section className="space-y-3">
                <h4 className="text-sm font-semibold text-neutral-900">Commute</h4>
                <div className="flex flex-wrap gap-2">
                  {[15, 30].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setModalCommute(modalCommute === m ? "" : (m as 15 | 30))}
                      className={`rounded-full border px-3 py-2 text-sm ${
                        modalCommute === m
                          ? "border-black bg-black text-white"
                          : "border-neutral-300 text-neutral-800 hover:border-neutral-500"
                      }`}
                    >
                      ≤ {m} min to airport
                    </button>
                  ))}
                </div>
              </section>

              {/* Rest options */}
              <section className="space-y-3">
                <h4 className="text-sm font-semibold text-neutral-900">Rest options</h4>
                <div className="flex flex-wrap gap-2">
                  <label className="inline-flex items-center gap-2 text-sm text-neutral-800">
                    <input
                      type="checkbox"
                      checked={modalBlackout}
                      onChange={(e) => setModalBlackout(e.target.checked)}
                      className="rounded border-neutral-300 text-black focus:ring-black"
                    />
                    Blackout blinds
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-neutral-800">
                    <input
                      type="checkbox"
                      checked={modalQuiet}
                      onChange={(e) => setModalQuiet(e.target.checked)}
                      className="rounded border-neutral-300 text-black focus:ring-black"
                    />
                    Quiet for rest
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-neutral-800">
                    <input
                      type="checkbox"
                      checked={modalAccess}
                      onChange={(e) => setModalAccess(e.target.checked)}
                      className="rounded border-neutral-300 text-black focus:ring-black"
                    />
                    24/7 access
                  </label>
                </div>
              </section>

              {/* Amenities placeholder */}
              <section className="space-y-3">
                <h4 className="text-sm font-semibold text-neutral-900">Amenities</h4>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <label className="inline-flex items-center gap-2 text-sm text-neutral-800">
                    <input
                      type="checkbox"
                      checked={modalWifi}
                      onChange={(e) => setModalWifi(e.target.checked)}
                      className="rounded border-neutral-300 text-black focus:ring-black"
                    />
                    Wi‑Fi
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-neutral-800">
                    <input
                      type="checkbox"
                      checked={modalKitchen}
                      onChange={(e) => setModalKitchen(e.target.checked)}
                      className="rounded border-neutral-300 text-black focus:ring-black"
                    />
                    Kitchen
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-neutral-800">
                    <input
                      type="checkbox"
                      checked={modalDesk}
                      onChange={(e) => setModalDesk(e.target.checked)}
                      className="rounded border-neutral-300 text-black focus:ring-black"
                    />
                    Desk
                  </label>
                </div>
              </section>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-neutral-200 px-6 py-4">
              <button
                onClick={() => {
                  setModalCommute("");
                  setModalBlackout(false);
                  setModalQuiet(false);
                  setModalAccess(false);
                  setModalWifi(false);
                  setModalKitchen(false);
                  setModalDesk(false);
                  onChange({
                    commute_max: undefined,
                    blackout: undefined,
                    quiet: undefined,
                    access_24_7: undefined,
                    has_wifi: undefined,
                    has_kitchen: undefined,
                    has_desk: undefined,
                  });
                }}
                className="rounded-full border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800 hover:border-neutral-500"
              >
                Reset
              </button>
              <button
                onClick={() => {
                  onChange({
                    commute_max: modalCommute || undefined,
                    blackout: modalBlackout || undefined,
                    quiet: modalQuiet || undefined,
                    access_24_7: modalAccess || undefined,
                    has_wifi: modalWifi || undefined,
                    has_kitchen: modalKitchen || undefined,
                    has_desk: modalDesk || undefined,
                  });
                  setMoreOpen(false);
                }}
                className="rounded-full bg-black px-5 py-2 text-sm font-semibold text-white hover:bg-black/90"
              >
                Apply filters
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function toBool(v: any): boolean | undefined {
  if (v === true || v === "true" || v === "1" || v === 1) return true;
  if (v === false || v === "false" || v === "0" || v === 0) return false;
  return undefined;
}
