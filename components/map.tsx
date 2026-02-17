import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import dynamic from "next/dynamic";
import "mapbox-gl/dist/mapbox-gl.css";
import type { MapRef } from "react-map-gl";

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
  price_per_night?: number;
  pricePerNight?: number;
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

function MarkerDot({
  children,
  active,
  hovered,
}: {
  children: ReactNode;
  active: boolean;
  hovered: boolean;
}) {
  const base =
    "relative inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm transition-transform duration-150 bg-[#FEDD02] text-black border-[#FEDD02]";
  const stateClass = active
    ? "scale-105 ring-1 ring-black/30"
    : hovered
    ? "scale-[1.04] ring-1 ring-black/20"
    : "";
  const pointerClass = "bg-[#FEDD02] border-[#FEDD02]";
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
  const mapRef = useRef<MapRef | null>(null);
  const lastFitRef = useRef<string>("");
  const [mapReady, setMapReady] = useState(false);
  const [viewState, setViewState] = useState(() => ({
    latitude: airportCoords ? airportCoords[1] : latitude,
    longitude: airportCoords ? airportCoords[0] : longitude,
    zoom,
  }));

  useEffect(() => {
    const handler = (event: PromiseRejectionEvent) => {
      const reason = event.reason as any;
      if (!reason || reason.name !== "AbortError") return;
      const stack = String(reason.stack || "");
      if (stack.includes("mapbox-gl") || stack.includes("react-map-gl")) {
        event.preventDefault();
      }
    };
    window.addEventListener("unhandledrejection", handler);
    return () => window.removeEventListener("unhandledrejection", handler);
  }, []);

  const markerPins = useMemo(() => {
    if (!Array.isArray(listings) || listings.length === 0) return [];
    return listings
      .map((pin) => {
        const coords = resolveCoords(pin);
        if (!coords) return null;
        return {
          id: pin.id,
          longitude: coords[0],
          latitude: coords[1],
          title: pin.title || pin.name || "Listing",
          nightly: toNumber(pin.price_per_night ?? pin.pricePerNight ?? (pin as any).price),
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

    if (markerPins.length > 1) {
      const lngs = markerPins.map((p) => p.longitude);
      const lats = markerPins.map((p) => p.latitude);
      const bounds: [[number, number], [number, number]] = [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ];
      map.fitBounds(bounds, { padding: 80, maxZoom: 14, duration: 500 });
      return;
    }

    if (markerPins.length === 1) {
      map.flyTo({
        center: [markerPins[0].longitude, markerPins[0].latitude],
        zoom: 13,
        essential: true,
      });
      return;
    }

    if (airportCoords) {
      map.flyTo({ center: airportCoords, zoom: 11.5, essential: true });
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
      className={`relative h-full w-full rounded-3xl border border-neutral-200 bg-white shadow-md overflow-hidden ${
        className ?? ""
      }`}
      style={resolvedStyle}
    >
      {showAirportLabel && airportCode && airportCoords && (
        <div className="pointer-events-none absolute right-4 top-4 z-20 inline-flex items-center gap-2 rounded-full bg-white/95 px-3.5 py-2 text-sm font-semibold text-neutral-900 shadow-md border border-neutral-200">
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
        viewState={viewState}
        onMoveEnd={handleMoveEnd}
        onError={(evt: any) => {
          const err = evt?.error;
          if (err?.name === "AbortError") return;
          console.error("Map error", err);
        }}
        onLoad={() => setMapReady(true)}
        style={{ width: "100%", height: "100%" }}
        className="w-full h-full"
      >
        <NavigationControl position="top-left" style={{ margin: 16, zIndex: 10 }} />

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
                <MarkerDot active={isActive} hovered={isHover}>
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
            <span className="inline-flex items-center justify-center rounded-full border border-neutral-300 bg-white px-2 py-1 text-[11px] font-semibold text-neutral-700 shadow-sm">
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
              <MarkerDot active hovered>
                {markerPins.length ? "Adjust location" : "You are here"}
              </MarkerDot>
            )}
          </Marker>
        )}
      </MapGL>
    </div>
  );
}
