import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import dynamic from "next/dynamic";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  computeGuestTotalMajorFromHostNet,
  computeSharedPerPersonWeeklyPricePence,
} from "@/lib/pricing";

const MapGL = dynamic(() => import("react-map-gl").then((m: any) => m.default ?? m.Map), {
  ssr: false,
}) as any;
const Marker = dynamic(() => import("react-map-gl").then((m: any) => m.Marker), {
  ssr: false,
}) as any;
const NavigationControl = dynamic(
  () => import("react-map-gl").then((m: any) => m.NavigationControl),
  { ssr: false }
) as any;

type ListingPin = {
  id: string;
  coords?: [number, number];
  latitude?: number;
  longitude?: number;
  title?: string;
  name?: string;
  guest_price_for_stay?: number;
  guestPriceForStay?: number;
  guest_price_per_night?: number;
  guestPricePerNight?: number;
  price_per_hour?: number;
  pricePerHour?: number;
  price_per_night?: number;
  pricePerNight?: number;
  is_shared_stay?: boolean;
  isSharedStay?: boolean;
  shared_weekly_price_pence?: number;
  sharedWeeklyPricePence?: number;
  shared_total_spots?: number;
  sharedTotalSpots?: number;
};

type AeronoocMapProps = {
  latitude: number;
  longitude: number;
  zoom?: number;
  airportCode?: string | null;
  airportLabel?: string | null;
  airportCoords?: [number, number] | null;
  showAirportLabel?: boolean;
  mapboxAccessToken?: string;
  mapStyle?: string;
  theme?: "default" | "uber";
  style?: CSSProperties;
  className?: string;
  height?: number;
  listings?: ListingPin[];
  /** id currently hovered (used to style pins) */
  hoverId?: string | null;
  /** id currently active/selected (used to style pins) */
  activeId?: string | null;
  /** allow dragging a center marker even when listings exist (useful for host flows) */
  allowDragWhenListings?: boolean;
  onHover?: (id: string | null) => void;
  onSelect?: (id: string) => void;
  onMove?: (lat: number, lng: number, zoom?: number) => void;
  onMarkerDragEnd?: (lat: number, lng: number) => void;
  onBoundsChange?: (bounds: { north: number; south: number; east: number; west: number }) => void;
  fitToPins?: boolean;
};

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function isValidLat(lat: number | null): lat is number {
  return typeof lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

function isValidLng(lng: number | null): lng is number {
  return typeof lng === "number" && Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

function haversineKm(a: [number, number], b: [number, number]): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(h)));
}

function resolveCoords(pin: ListingPin): [number, number] | null {
  if (Array.isArray(pin.coords) && pin.coords.length >= 2) {
    const lng = toNumber(pin.coords[0]);
    const lat = toNumber(pin.coords[1]);
    if (isValidLng(lng) && isValidLat(lat)) return [lng, lat];
  }
  const lng = toNumber((pin as any).longitude ?? (pin as any).lng);
  const lat = toNumber((pin as any).latitude ?? (pin as any).lat);
  if (isValidLng(lng) && isValidLat(lat)) return [lng, lat];
  return null;
}

function isMapboxAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as { name?: unknown; message?: unknown; stack?: unknown };
  const name = typeof maybeError.name === "string" ? maybeError.name : "";
  const message = typeof maybeError.message === "string" ? maybeError.message : "";
  const stack = typeof maybeError.stack === "string" ? maybeError.stack : "";
  if (name !== "AbortError") return false;
  return (
    message.includes("signal is aborted without reason") ||
    stack.includes("mapbox-gl") ||
    stack.includes("react-map-gl")
  );
}

function MarkerDot({
  children,
  active,
  hovered,
  theme,
}: {
  children: ReactNode;
  active: boolean;
  hovered: boolean;
  theme: "default" | "uber";
}) {
  const base =
    theme === "uber"
      ? "relative inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-xs font-semibold shadow-[0_10px_24px_rgba(11,13,16,0.26)] transition-transform duration-150 bg-white text-[#0B0D10] border-white"
      : "relative inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm transition-transform duration-150 bg-[#FEDD02] text-black border-[#FEDD02]";
  const stateClass =
    theme === "uber"
      ? active
        ? "scale-105 bg-[#0B0D10] text-white border-[#0B0D10] shadow-[0_12px_28px_rgba(11,13,16,0.34)]"
        : hovered
        ? "scale-[1.04] shadow-[0_12px_26px_rgba(11,13,16,0.3)]"
        : ""
      : active
      ? "scale-105 ring-1 ring-black/30"
      : hovered
      ? "scale-[1.04] ring-1 ring-black/20"
      : "";
  const pointerClass =
    theme === "uber"
      ? active
        ? "bg-[#0B0D10] border-[#0B0D10]"
        : "bg-white border-white"
      : "bg-[#FEDD02] border-[#FEDD02]";
  return (
    <span className={`${base} ${stateClass}`}>
      {children}
      <span
        aria-hidden
        className={`absolute -bottom-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border ${pointerClass}`}
      />
    </span>
  );
}

function DragPin() {
  return (
    <div className="cursor-grab active:cursor-grabbing">
      <svg
        viewBox="0 0 24 24"
        width="28"
        height="28"
        aria-hidden
        className="drop-shadow-md"
      >
        <path
          d="M12 22s7-7.5 7-12a7 7 0 1 0-14 0c0 4.5 7 12 7 12z"
          fill="#0B0D10"
        />
        <circle cx="12" cy="10" r="3.5" fill="#FFFFFF" />
      </svg>
    </div>
  );
}

export default function AeronoocMap({
  latitude,
  longitude,
  zoom = 12,
  airportCode = null,
  airportLabel = null,
  airportCoords = null,
  showAirportLabel = true,
  mapboxAccessToken,
  mapStyle = "mapbox://styles/mapbox/navigation-day-v1",
  theme = "default",
  style,
  className,
  height,
  listings,
  hoverId = null,
  activeId = null,
  allowDragWhenListings = false,
  onHover,
  onSelect,
  onMove,
  onMarkerDragEnd,
  onBoundsChange,
  fitToPins = true,
}: AeronoocMapProps) {
  const token = mapboxAccessToken || process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const mapRef = useRef<any>(null);
  const lastFitRef = useRef<string>("");
  const [mapReady, setMapReady] = useState(false);
  const [viewState, setViewState] = useState(() => ({
    latitude: airportCoords ? airportCoords[1] : latitude,
    longitude: airportCoords ? airportCoords[0] : longitude,
    zoom,
  }));

  useEffect(() => {
    const handler = (event: PromiseRejectionEvent) => {
      if (isMapboxAbortError(event.reason)) {
        event.preventDefault();
      }
    };

    const errorHandler = (event: ErrorEvent) => {
      if (isMapboxAbortError(event.error)) {
        event.preventDefault();
      }
    };

    window.addEventListener("unhandledrejection", handler);
    window.addEventListener("error", errorHandler);
    return () => {
      window.removeEventListener("unhandledrejection", handler);
      window.removeEventListener("error", errorHandler);
    };
  }, []);

  const markerPins = useMemo(() => {
    if (!Array.isArray(listings) || listings.length === 0) return [];
    return listings
      .map((pin) => {
        const coords = resolveCoords(pin);
        if (!coords) return null;
        const guestStayTotal = toNumber(
          pin.guest_price_for_stay ?? pin.guestPriceForStay
        );
        const guestNightly = toNumber(
          pin.guest_price_per_night ?? pin.guestPricePerNight
        );
        const hostUnitPrice = toNumber(
          pin.price_per_hour ??
            pin.pricePerHour ??
          pin.price_per_night ?? pin.pricePerNight ?? (pin as any).price
        );
        const isSharedStay = Boolean(pin.isSharedStay ?? pin.is_shared_stay);
        const sharedWeeklyPricePence = toNumber(
          pin.sharedWeeklyPricePence ?? pin.shared_weekly_price_pence
        );
        const sharedTotalSpots = Math.max(
          1,
          Math.round(Number(pin.sharedTotalSpots ?? pin.shared_total_spots ?? 1)) || 1
        );
        const sharedGuestUnitPrice =
          isSharedStay && sharedWeeklyPricePence != null && sharedWeeklyPricePence > 0
            ? computeSharedPerPersonWeeklyPricePence({
                totalWeeklyPricePence: sharedWeeklyPricePence,
                totalSpots: sharedTotalSpots,
              }).rounded_per_person_weekly_pence / 100
            : null;
        const nightly =
          guestStayTotal ??
          sharedGuestUnitPrice ??
          guestNightly ??
          (hostUnitPrice != null
            ? computeGuestTotalMajorFromHostNet(hostUnitPrice, {
                nights: 1,
                isFirstCompletedBooking: false,
              })
            : null);
        return {
          id: pin.id,
          longitude: coords[0],
          latitude: coords[1],
          title: pin.title || pin.name || "Listing",
          nightly,
        };
      })
      .filter(Boolean) as Array<{
      id: string;
      longitude: number;
      latitude: number;
      title: string;
      nightly: number | null;
    }>;
  }, [listings]);

  useEffect(() => {
    if (markerPins.length > 0) return;
    setViewState((prev) => ({
      ...prev,
      latitude: airportCoords ? airportCoords[1] : latitude,
      longitude: airportCoords ? airportCoords[0] : longitude,
      zoom,
    }));
  }, [latitude, longitude, zoom, airportCoords, markerPins.length]);

  const handleHoverIn = useCallback((id: string) => onHover?.(id), [onHover]);
  const handleHoverOut = useCallback(() => onHover?.(null), [onHover]);
  const handleSelect = useCallback((id: string) => onSelect?.(id), [onSelect]);
  const lastFocusRef = useRef<string | null>(null);

  const handleMoveEnd = useCallback(
    (evt: any) => {
      const next = evt?.viewState ?? evt ?? {};
      const nextLat = toNumber(next.latitude) ?? viewState.latitude;
      const nextLng = toNumber(next.longitude) ?? viewState.longitude;
      const nextZoom = toNumber(next.zoom) ?? viewState.zoom;
      if (
        nextLat === viewState.latitude &&
        nextLng === viewState.longitude &&
        nextZoom === viewState.zoom
      ) {
        return;
      }
      setViewState({ latitude: nextLat, longitude: nextLng, zoom: nextZoom });
      onMove?.(nextLat, nextLng, nextZoom);
      const map = mapRef.current?.getMap?.();
      if (map) {
        const bounds = map.getBounds();
        onBoundsChange?.({
          north: bounds.getNorth(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          west: bounds.getWest(),
        });
      }
    },
    [onMove, onBoundsChange, viewState.latitude, viewState.longitude, viewState.zoom]
  );

  const resolvedStyle: CSSProperties = {
    width: "100%",
    height: height ?? 400,
    ...style,
  };


  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap?.();
    if (!map) return;
    if (!fitToPins) return;
    const fitKey = `${markerPins
      .map((pin) => `${pin.id}:${pin.longitude.toFixed(5)}:${pin.latitude.toFixed(5)}`)
      .join("|")}|${airportCoords ? airportCoords.join(",") : "none"}`;
    if (fitKey === lastFitRef.current) return;
    lastFitRef.current = fitKey;

    const framingPins =
      airportCoords != null
        ? markerPins.filter((pin) => haversineKm([pin.longitude, pin.latitude], airportCoords) <= 80)
        : markerPins;
    const pinsForBounds = framingPins.length > 0 ? framingPins : markerPins;
    const framePoints = airportCoords
      ? [...pinsForBounds.map((pin) => [pin.longitude, pin.latitude] as [number, number]), airportCoords]
      : pinsForBounds.map((pin) => [pin.longitude, pin.latitude] as [number, number]);

    if (framePoints.length > 1) {
      const lngs = framePoints.map((point) => point[0]);
      const lats = framePoints.map((point) => point[1]);
      const lngSpan = Math.max(...lngs) - Math.min(...lngs);
      const latSpan = Math.max(...lats) - Math.min(...lats);

      if (airportCoords && (lngSpan > 2.4 || latSpan > 1.8)) {
        map.flyTo({
          center: airportCoords,
          zoom: 9.8,
          essential: true,
        });
        return;
      }

      const bounds: [[number, number], [number, number]] = [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ];
      map.fitBounds(bounds, {
        padding: { top: 72, right: 84, bottom: 72, left: 84 },
        maxZoom: airportCoords ? 12.6 : 13.4,
        duration: 500,
      });
      return;
    }

    if (markerPins.length === 1) {
      if (airportCoords) {
        const singleBounds: [[number, number], [number, number]] = [
          [
            Math.min(markerPins[0].longitude, airportCoords[0]),
            Math.min(markerPins[0].latitude, airportCoords[1]),
          ],
          [
            Math.max(markerPins[0].longitude, airportCoords[0]),
            Math.max(markerPins[0].latitude, airportCoords[1]),
          ],
        ];
        map.fitBounds(singleBounds, {
          padding: { top: 72, right: 84, bottom: 72, left: 84 },
          maxZoom: 12.8,
          duration: 500,
        });
        return;
      }
      map.flyTo({
        center: [markerPins[0].longitude, markerPins[0].latitude],
        zoom: 12.8,
        essential: true,
      });
      return;
    }

    if (airportCoords) {
      map.flyTo({ center: airportCoords, zoom: 10.2, essential: true });
    }
  }, [airportCoords, fitToPins, mapReady, markerPins]);

  useEffect(() => {
    if (!mapReady) return;
    if (!activeId) return;
    if (lastFocusRef.current === activeId) return;
    const target = markerPins.find((pin) => pin.id === activeId);
    if (!target) return;
    const map = mapRef.current?.getMap?.();
    if (!map) return;
    lastFocusRef.current = activeId;
    map.easeTo({
      center: [target.longitude, target.latitude],
      duration: 500,
    });
  }, [activeId, mapReady, markerPins]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current?.getMap?.();
    if (!map) return;
    const bounds = map.getBounds();
    onBoundsChange?.({
      north: bounds.getNorth(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      west: bounds.getWest(),
    });
  }, [mapReady, onBoundsChange]);

  if (!token) {
    return (
      <div
        className={className}
        style={{
          ...resolvedStyle,
          display: "grid",
          placeItems: "center",
          backgroundColor: "rgba(11, 13, 16, 0.04)",
        }}
      >
        <span className="text-sm text-neutral-500">
          Set NEXT_PUBLIC_MAPBOX_TOKEN to enable the map.
        </span>
      </div>
    );
  }

  return (
    <div
      className={
        theme === "uber"
          ? `map-uber relative h-full w-full overflow-hidden ${className ?? ""}`
          : `relative h-full w-full rounded-3xl border border-neutral-200 bg-white shadow-md overflow-hidden ${
              className ?? ""
            }`
      }
      style={resolvedStyle}
    >
      {theme === "uber" && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-20 bg-gradient-to-b from-white/55 to-transparent" />
      )}

      {showAirportLabel && airportCode && airportCoords && (
        <div
          className={
            theme === "uber"
              ? "pointer-events-none absolute right-4 top-4 z-20 inline-flex items-center gap-2 rounded-full bg-white/92 px-3 py-1.5 text-xs font-semibold text-neutral-900 shadow-[0_10px_24px_rgba(15,23,42,0.08)] border border-neutral-200/80 backdrop-blur-sm"
              : "pointer-events-none absolute right-4 top-4 z-20 inline-flex items-center gap-2 rounded-full bg-white/95 px-3.5 py-2 text-sm font-semibold text-neutral-900 shadow-md border border-neutral-200"
          }
        >
          <span className="text-neutral-500">✈</span>
          <span>
            {airportLabel ? (
              <>
                Homes near {airportLabel} (
                <span className="font-mono tabular-nums">{airportCode}</span>)
              </>
            ) : (
              <>
                Homes near <span className="font-mono tabular-nums">{airportCode}</span>
              </>
            )}
          </span>
        </div>
      )}

      <MapGL
        ref={mapRef}
        mapboxAccessToken={token}
        mapStyle={mapStyle}
        reuseMaps
        viewState={viewState}
        onMoveEnd={handleMoveEnd}
        onError={(evt: any) => {
          const err = evt?.error;
          if (isMapboxAbortError(err)) return;
          console.error("Map error", err);
        }}
        onLoad={() => setMapReady(true)}
        style={{ width: "100%", height: "100%" }}
        className="w-full h-full"
      >
        <NavigationControl
          position={theme === "uber" ? "bottom-right" : "top-left"}
          style={{ margin: 16, zIndex: theme === "uber" ? 12 : 10 }}
        />

        {markerPins.map((pin) => {
          const isHover = hoverId === pin.id;
          const isActive = activeId === pin.id;
          return (
            <Marker
              key={pin.id}
              longitude={pin.longitude}
              latitude={pin.latitude}
              anchor="bottom"
            >
              <button
                type="button"
                onMouseEnter={() => handleHoverIn(pin.id)}
                onMouseLeave={handleHoverOut}
                onFocus={() => handleHoverIn(pin.id)}
                onBlur={handleHoverOut}
                onClick={() => handleSelect(pin.id)}
                className="bg-transparent border-0 p-0 cursor-pointer focus:outline-none"
              >
                <MarkerDot active={isActive} hovered={isHover} theme={theme}>
                  <span className="font-mono tabular-nums">
                    {pin.nightly != null ? `£${Math.round(pin.nightly)}` : pin.title}
                  </span>
                </MarkerDot>
              </button>
            </Marker>
          );
        })}

        {/* Airport marker (shown even when no listings) */}
        {airportCoords && airportCode && (
          <Marker longitude={airportCoords[0]} latitude={airportCoords[1]} anchor="bottom">
            <span className="inline-flex items-center justify-center rounded-full border border-neutral-300 bg-white px-2 py-1 text-[11px] font-semibold text-neutral-700 shadow-[0_8px_18px_rgba(15,23,42,0.08)]">
              <span className="font-mono tabular-nums">{airportCode}</span> ✈
            </span>
          </Marker>
        )}

        {onMarkerDragEnd && (markerPins.length === 0 || allowDragWhenListings) && (
          <Marker
            longitude={viewState.longitude}
            latitude={viewState.latitude}
            anchor="bottom"
            draggable={Boolean(onMarkerDragEnd)}
            onDragEnd={(evt: any) => {
              const lat = toNumber(evt?.lngLat?.lat) ?? viewState.latitude;
              const lng = toNumber(evt?.lngLat?.lng) ?? viewState.longitude;
              setViewState((prev) => ({ ...prev, latitude: lat, longitude: lng }));
              onMarkerDragEnd?.(lat, lng);
              onMove?.(lat, lng, viewState.zoom);
            }}
          >
            {onMarkerDragEnd ? (
              <DragPin />
            ) : (
              <MarkerDot active hovered theme={theme}>
                {markerPins.length ? "Adjust location" : "You are here"}
              </MarkerDot>
            )}
          </Marker>
        )}
      </MapGL>
    </div>
  );
}
