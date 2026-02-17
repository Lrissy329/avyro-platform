import type { GetServerSideProps } from "next";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import OpsLayout from "@/components/ops/OpsLayout";
import { requireOpsStaff } from "@/lib/opsAuth";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { hasOpsPermission, type OpsRole } from "@/lib/opsRbac";

type AreaRow = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius_km: number;
  hosts_needed: number | null;
  target_date: string | null;
};

type ListingRow = {
  id: string;
  latitude?: number | null;
  longitude?: number | null;
  coords?: unknown;
};

type BookingRow = {
  id: string;
  listing_id: string | null;
  check_in_time: string | null;
  created_at: string | null;
};

type HeatRow = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius_km: number;
  hosts_needed: number | null;
  target_date: string | null;
  supply: number;
  demand: number;
  heat_index: number;
  status: "undersupplied" | "balanced" | "oversupplied";
};

type PageProps = {
  staffRole: OpsRole;
  areas: HeatRow[];
  horizonDays: number;
  staff: { user_id: string; role: string; active: boolean }[];
  staffUserId: string;
};

const STATUS_STYLES: Record<HeatRow["status"], string> = {
  undersupplied: "border-rose-500/50 bg-rose-500/15 text-rose-100",
  balanced: "border-amber-400/50 bg-amber-400/15 text-amber-100",
  oversupplied: "border-emerald-400/50 bg-emerald-400/15 text-emerald-100",
};

const STATUS_LABEL: Record<HeatRow["status"], string> = {
  undersupplied: "Undersupplied",
  balanced: "Balanced",
  oversupplied: "Oversupplied",
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const parseCoords = (coords: unknown): [number, number] | null => {
  if (Array.isArray(coords) && coords.length >= 2) {
    const lng = toNumber(coords[0]);
    const lat = toNumber(coords[1]);
    if (lng != null && lat != null) return [lng, lat];
  }
  if (typeof coords === "string") {
    const matches = coords.match(/-?\\d+\\.?\\d*/g) ?? [];
    if (matches.length >= 2) {
      const lng = toNumber(matches[0]);
      const lat = toNumber(matches[1]);
      if (lng != null && lat != null) return [lng, lat];
    }
  }
  return null;
};

const resolveListingCoords = (listing: ListingRow): { lat: number; lng: number } | null => {
  const lat = toNumber(listing.latitude);
  const lng = toNumber(listing.longitude);
  if (lat != null && lng != null) return { lat, lng };
  const coords = parseCoords(listing.coords);
  if (coords) return { lng: coords[0], lat: coords[1] };
  return null;
};

const toRad = (deg: number) => (deg * Math.PI) / 180;

const distanceKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

const computeStatus = (supply: number, demand: number, heatIndex: number): HeatRow["status"] => {
  if (supply === 0 && demand > 0) return "undersupplied";
  if (heatIndex >= 1.2) return "undersupplied";
  if (heatIndex <= 0.8) return "oversupplied";
  return "balanced";
};

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const guard = await requireOpsStaff(ctx, { permission: "ops:dashboard:ops" });
  if ("redirect" in guard) return guard;

  const admin = getSupabaseServerClient();
  const horizonDays = 30;
  const since = new Date(Date.now() - horizonDays * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: areasRaw }, { data: listingsRaw }, { data: bookingsRaw }, { data: staff }] =
    await Promise.all([
      admin
        .from("areas")
        .select("id, name, lat, lng, radius_km, hosts_needed, target_date")
        .order("name", {
          ascending: true,
        }),
      admin.from("listings").select("id, latitude, longitude, coords").limit(5000),
      admin
        .from("bookings")
        .select("id, listing_id, check_in_time, created_at")
        .or(`check_in_time.gte.${since},created_at.gte.${since}`)
        .limit(5000),
      admin.from("staff_users").select("user_id, role, active").order("user_id", {
        ascending: true,
      }),
    ]);

  const areas = (areasRaw ?? []) as AreaRow[];
  const listings = (listingsRaw ?? []) as ListingRow[];
  const bookings = (bookingsRaw ?? []) as BookingRow[];

  const listingCoordMap = new Map<string, { lat: number; lng: number }>();
  listings.forEach((listing) => {
    const coords = resolveListingCoords(listing);
    if (coords && listing.id) listingCoordMap.set(listing.id, coords);
  });

  const mappedAreas: HeatRow[] = areas.map((area) => {
    const areaCenter = { lat: area.lat, lng: area.lng };
    const supply = listings.reduce((count, listing) => {
      const coords = resolveListingCoords(listing);
      if (!coords) return count;
      return distanceKm(areaCenter, coords) <= area.radius_km ? count + 1 : count;
    }, 0);

    const demand = bookings.reduce((count, booking) => {
      if (!booking.listing_id) return count;
      const coords = listingCoordMap.get(booking.listing_id);
      if (!coords) return count;
      return distanceKm(areaCenter, coords) <= area.radius_km ? count + 1 : count;
    }, 0);

    const heatIndex = supply > 0 ? demand / supply : demand > 0 ? demand : 0;
    const status = computeStatus(supply, demand, heatIndex);

    return {
      id: area.id,
      name: area.name,
      lat: area.lat,
      lng: area.lng,
      radius_km: area.radius_km,
      hosts_needed: area.hosts_needed ?? null,
      target_date: area.target_date ?? null,
      supply,
      demand,
      heat_index: heatIndex,
      status,
    };
  });

  return {
    props: {
      staffRole: guard.staff.role as OpsRole,
      staffUserId: guard.staff.user_id,
      areas: mappedAreas,
      horizonDays,
      staff: staff ?? [],
    },
  };
};

export default function OpsHeatmap({
  staffRole,
  areas,
  horizonDays,
  staff,
  staffUserId,
}: PageProps) {
  const [activeId, setActiveId] = useState<string | null>(areas[0]?.id ?? null);
  const canCreateLead = hasOpsPermission(staffRole, "ops:sales:write");
  const [assignStatus, setAssignStatus] = useState<string | null>(null);

  const staffOptions = useMemo(() => {
    const eligible = staff.filter(
      (member) => member.role === "sales_agent" || member.role === "admin"
    );
    if (staffRole !== "sales_agent") return eligible;
    return eligible.filter((member) => member.user_id === staffUserId);
  }, [staff, staffRole, staffUserId]);

  const bounds = useMemo(() => {
    const latValues = areas.map((area) => area.lat);
    const lngValues = areas.map((area) => area.lng);
    const minLat = Math.min(...latValues, 51.0);
    const maxLat = Math.max(...latValues, 54.0);
    const minLng = Math.min(...lngValues, -5.0);
    const maxLng = Math.max(...lngValues, 1.5);
    const latPad = (maxLat - minLat) * 0.15 || 0.5;
    const lngPad = (maxLng - minLng) * 0.15 || 0.5;
    return {
      minLat: minLat - latPad,
      maxLat: maxLat + latPad,
      minLng: minLng - lngPad,
      maxLng: maxLng + lngPad,
    };
  }, [areas]);

  const nodes = useMemo(() => {
    return areas.map((area) => {
      const x =
        (area.lng - bounds.minLng) / Math.max(0.0001, bounds.maxLng - bounds.minLng);
      const y =
        1 -
        (area.lat - bounds.minLat) / Math.max(0.0001, bounds.maxLat - bounds.minLat);
      const size = Math.min(58, Math.max(28, 24 + area.demand * 3 + area.supply));
      return { ...area, x, y, size };
    });
  }, [areas, bounds]);

  const activeArea = areas.find((area) => area.id === activeId) ?? areas[0];
  const [assignedTo, setAssignedTo] = useState(staffOptions[0]?.user_id ?? "");
  const [hostsNeeded, setHostsNeeded] = useState<number>(activeArea?.hosts_needed ?? 5);
  const [targetDate, setTargetDate] = useState<string>(
    activeArea?.target_date ??
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  );

  useEffect(() => {
    if (!activeArea) return;
    setHostsNeeded(activeArea.hosts_needed ?? 5);
    setTargetDate(
      activeArea.target_date ??
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    );
  }, [activeArea?.id]);

  useEffect(() => {
    if (staffOptions.length === 0) return;
    setAssignedTo((prev) => prev || staffOptions[0]?.user_id || "");
  }, [staffOptions]);

  const assignTarget = async () => {
    if (!activeArea) return;
    setAssignStatus("Assigning target...");
    try {
      const resp = await fetch("/api/ops/sales/targets/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          areaId: activeArea.id,
          staffUserId: assignedTo,
          hostsNeeded,
          targetDate,
          autoCreateLeads: true,
        }),
      });
      const payload = await resp.json();
      if (!resp.ok) throw new Error(payload?.error ?? "Assignment failed");
      setAssignStatus(
        `Assigned. Created ${payload?.leadsCreated ?? 0} leads.`
      );
    } catch (err: any) {
      setAssignStatus(err?.message ?? "Assignment failed");
    }
  };

  return (
    <OpsLayout title="Supply vs demand heatmap" role={staffRole}>
      <div className="grid gap-6 lg:grid-cols-[2.2fr_1fr]">
        <div className="space-y-4">
          <div className="rounded-3xl border border-[var(--ops-border)] bg-[var(--ops-panel)] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
                  Directional heatmap
                </p>
                <p className="mt-1 text-sm text-white">
                  Demand uses bookings from the past {horizonDays} days.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-[var(--ops-muted)]">
                <span className="inline-flex items-center gap-2 rounded-full border border-[var(--ops-border)] px-3 py-1">
                  <span className="h-2 w-2 rounded-full bg-rose-400" /> Undersupplied
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-[var(--ops-border)] px-3 py-1">
                  <span className="h-2 w-2 rounded-full bg-amber-300" /> Balanced
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-[var(--ops-border)] px-3 py-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-300" /> Oversupplied
                </span>
              </div>
            </div>
            <div className="relative mt-5 aspect-[16/9] w-full overflow-hidden rounded-3xl border border-[var(--ops-border)] bg-[#0b1220]">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(39,51,74,0.8),_rgba(9,15,25,0.95))]" />
              <div className="absolute inset-0 opacity-40" style={{
                backgroundImage:
                  "linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(180deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
                backgroundSize: "48px 48px",
              }} />
              <div className="absolute inset-0">
                {nodes.map((node) => (
                  <button
                    key={node.id}
                    onClick={() => setActiveId(node.id)}
                    className={`absolute flex items-center justify-center rounded-full border text-xs font-semibold uppercase tracking-[0.18em] transition ${
                      STATUS_STYLES[node.status]
                    } ${activeId === node.id ? "ring-2 ring-white/60" : "hover:scale-105"}`}
                    style={{
                      left: `${node.x * 100}%`,
                      top: `${node.y * 100}%`,
                      width: node.size,
                      height: node.size,
                      transform: "translate(-50%, -50%)",
                    }}
                  >
                    {node.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-[var(--ops-border)] bg-[var(--ops-panel)] p-5">
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
              Selected area
            </p>
            {activeArea ? (
              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-lg font-semibold text-white">{activeArea.name}</p>
                  <span
                    className={`mt-2 inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${
                      STATUS_STYLES[activeArea.status]
                    }`}
                  >
                    {STATUS_LABEL[activeArea.status]}
                  </span>
                </div>
                <div className="grid gap-3 rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4 text-sm text-[var(--ops-muted)]">
                  <div className="flex items-center justify-between">
                    <span>Active listings</span>
                    <span className="text-white">{activeArea.supply}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Bookings ({horizonDays}d)</span>
                    <span className="text-white">{activeArea.demand}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Heat index</span>
                    <span className="text-white">{activeArea.heat_index.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Hosts needed</span>
                    <span className="text-white">{activeArea.hosts_needed ?? "—"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Target date</span>
                    <span className="text-white">
                      {activeArea.target_date ? activeArea.target_date : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Radius</span>
                    <span className="text-white">{activeArea.radius_km} km</span>
                  </div>
                </div>
                {canCreateLead && (
                  <div className="space-y-3 rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-panel-2)] p-4">
                    <p className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
                      Assign target
                    </p>
                    <div>
                      <label className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
                        Sales agent
                      </label>
                      <select
                        value={assignedTo}
                        onChange={(event) => setAssignedTo(event.target.value)}
                        className="mt-2 w-full rounded-xl border border-[var(--ops-border)] bg-white px-3 py-2 text-sm text-slate-900"
                      >
                        {staffOptions.map((member) => (
                          <option key={member.user_id} value={member.user_id}>
                            {member.user_id}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
                          Hosts needed
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={hostsNeeded}
                          onChange={(event) => setHostsNeeded(Number(event.target.value))}
                          className="mt-2 w-full rounded-xl border border-[var(--ops-border)] bg-white px-3 py-2 text-sm text-slate-900"
                        />
                      </div>
                      <div>
                        <label className="text-xs uppercase tracking-[0.3em] text-[var(--ops-muted)]">
                          Target date
                        </label>
                        <input
                          type="date"
                          value={targetDate}
                          onChange={(event) => setTargetDate(event.target.value)}
                          className="mt-2 w-full rounded-xl border border-[var(--ops-border)] bg-white px-3 py-2 text-sm text-slate-900"
                        />
                      </div>
                    </div>
                    <button
                      onClick={assignTarget}
                      disabled={!assignedTo}
                      className="w-full rounded-xl border border-[var(--ops-border)] bg-slate-900 hover:bg-slate-800 px-4 py-2 text-sm font-semibold !text-white"
                    >
                      Assign target + create leads
                    </button>
                    {assignStatus && (
                      <p className="text-xs text-[var(--ops-muted)]">{assignStatus}</p>
                    )}
                  </div>
                )}
                <Link
                  href={`/ops/sales/leads?prefillArea=${encodeURIComponent(activeArea.name)}`}
                  className="inline-flex w-full items-center justify-center rounded-xl border border-[var(--ops-border)] bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
                >
                  Create lead in this area
                </Link>
              </div>
            ) : (
              <p className="mt-3 text-sm text-[var(--ops-muted)]">No area selected.</p>
            )}
          </div>
        </div>
      </div>
    </OpsLayout>
  );
}
