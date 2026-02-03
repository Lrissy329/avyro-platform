import type { ComponentType, SVGProps } from "react";
import {
  ArchiveBoxIcon,
  ArrowPathIcon,
  BeakerIcon,
  BellAlertIcon,
  BookOpenIcon,
  BoltIcon,
  BuildingOffice2Icon,
  ClockIcon,
  ComputerDesktopIcon,
  DocumentTextIcon,
  FireIcon,
  HomeModernIcon,
  KeyIcon,
  LifebuoyIcon,
  LockClosedIcon,
  MapIcon,
  MapPinIcon,
  MoonIcon,
  PhoneIcon,
  ShieldCheckIcon,
  SparklesIcon,
  SpeakerXMarkIcon,
  SunIcon,
  TruckIcon,
  VideoCameraIcon,
  WifiIcon,
} from "@heroicons/react/24/outline";

export type AmenitySchema = {
  code: string;
  label: string;
  icon: string;
  required: boolean;
  group: string;
  editable?: boolean;
};

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export type AmenityDescriptor = AmenitySchema & {
  Icon: IconComponent;
};

export const AMENITY_SCHEMA: AmenitySchema[] = [
  { code: "wifi", label: "Wi‑Fi (speed shown)", icon: "wifi", required: true, group: "Connectivity & Work" },
  { code: "dedicated_workspace", label: "Dedicated workspace", icon: "computer-desktop", required: true, group: "Connectivity & Work" },
  { code: "power_usb", label: "Power & USB", icon: "bolt", required: true, group: "Connectivity & Work" },
  { code: "quiet_environment", label: "Low-noise environment", icon: "speaker-x-mark", required: false, group: "Sleep & Comfort" },
  { code: "quality_mattress", label: "Quality mattress", icon: "sparkles", required: false, group: "Sleep & Comfort" },
  { code: "blackout_blinds", label: "Blackout blinds / curtains", icon: "moon", required: false, group: "Sleep & Comfort" },
  { code: "heating", label: "Heating", icon: "fire", required: true, group: "Sleep & Comfort" },
  { code: "air_conditioning", label: "Air conditioning", icon: "sun", required: false, group: "Sleep & Comfort" },
  { code: "private_bathroom", label: "Private bathroom", icon: "droplet", required: true, group: "Sleep & Comfort" },
  { code: "hot_water", label: "Hot water", icon: "fire", required: true, group: "Sleep & Comfort" },
  { code: "quality_linens", label: "Quality linens & towels", icon: "sparkles", required: true, group: "Sleep & Comfort" },
  { code: "kitchen_access", label: "Kitchen access", icon: "home", required: false, group: "Kitchen & Laundry" },
  { code: "fridge", label: "Fridge", icon: "archive-box", required: false, group: "Kitchen & Laundry" },
  { code: "microwave", label: "Microwave", icon: "bolt", required: false, group: "Kitchen & Laundry" },
  { code: "tea_coffee", label: "Tea & coffee", icon: "beaker", required: false, group: "Kitchen & Laundry" },
  { code: "laundry", label: "Laundry", icon: "arrow-path", required: false, group: "Kitchen & Laundry" },
  { code: "self_check_in", label: "Self check-in", icon: "key", required: true, group: "Access & Autonomy" },
  { code: "access_24_7", label: "24/7 access", icon: "clock", required: false, group: "Access & Autonomy" },
  { code: "late_check_in", label: "Late check-in", icon: "clock", required: false, group: "Access & Autonomy" },
  { code: "early_check_out", label: "Early check-out", icon: "clock", required: false, group: "Access & Autonomy" },
  { code: "host_guidebook", label: "Host guidebook", icon: "book-open", required: false, group: "Access & Autonomy" },
  { code: "house_rules", label: "House rules", icon: "document-text", required: true, group: "Access & Autonomy" },
  { code: "smoke_co_alarms", label: "Smoke / CO alarms", icon: "bell-alert", required: true, group: "Safety & Security" },
  { code: "first_aid", label: "First aid kit", icon: "lifebuoy", required: true, group: "Safety & Security" },
  { code: "lockable_room", label: "Lockable room / door", icon: "lock-closed", required: false, group: "Safety & Security" },
  { code: "cctv", label: "CCTV", icon: "video-camera", required: false, group: "Safety & Security" },
  { code: "emergency_contact", label: "Emergency contact", icon: "phone", required: true, group: "Safety & Security" },
  { code: "verified_host", label: "Verified host", icon: "shield-check", required: false, group: "Safety & Security", editable: false },
  { code: "verified_address", label: "Verified address", icon: "shield-check", required: false, group: "Safety & Security", editable: false },
  { code: "distance_to_airport", label: "Distance to airport", icon: "map-pin", required: true, group: "Logistics & Location", editable: false },
  { code: "transport_info", label: "Transport information", icon: "map", required: true, group: "Logistics & Location", editable: false },
  { code: "parking", label: "Parking", icon: "truck", required: false, group: "Logistics & Location" },
  { code: "shared_property", label: "Shared property", icon: "home", required: false, group: "Property Context" },
  { code: "host_on_site", label: "Host on site", icon: "building", required: false, group: "Property Context" },
  { code: "building_type_house", label: "House", icon: "home", required: false, group: "Property Context" },
  { code: "building_type_apartment", label: "Apartment", icon: "building", required: false, group: "Property Context" },
  { code: "building_type_guesthouse", label: "Guesthouse", icon: "home", required: false, group: "Property Context" },
];

const ICON_MAP: Record<string, IconComponent> = {
  "wifi": WifiIcon,
  "computer-desktop": ComputerDesktopIcon,
  moon: MoonIcon,
  fire: FireIcon,
  sun: SunIcon,
  droplet: BeakerIcon,
  sparkles: SparklesIcon,
  key: KeyIcon,
  clock: ClockIcon,
  "bell-alert": BellAlertIcon,
  lifebuoy: LifebuoyIcon,
  "lock-closed": LockClosedIcon,
  "video-camera": VideoCameraIcon,
  "speaker-x-mark": SpeakerXMarkIcon,
  "map-pin": MapPinIcon,
  map: MapIcon,
  "arrow-path": ArrowPathIcon,
  home: HomeModernIcon,
  building: BuildingOffice2Icon,
  "archive-box": ArchiveBoxIcon,
  bolt: BoltIcon,
  beaker: BeakerIcon,
  "shield-check": ShieldCheckIcon,
  truck: TruckIcon,
  "book-open": BookOpenIcon,
  "document-text": DocumentTextIcon,
  phone: PhoneIcon,
};

const DEFAULT_ICON = BuildingOffice2Icon;
const schemaByCode = new Map(AMENITY_SCHEMA.map((entry) => [entry.code, entry]));

const AMENITY_ALIASES: Record<string, string> = {
  fast_wi_fi: "wifi",
  fast_wifi: "wifi",
  wi_fi: "wifi",
  wifi: "wifi",
  has_wifi: "wifi",
  dedicated_workspace: "dedicated_workspace",
  has_desk: "dedicated_workspace",
  desk: "dedicated_workspace",
  blackout_blinds: "blackout_blinds",
  blackout_curtains: "blackout_blinds",
  curtains: "blackout_blinds",
  heating: "heating",
  radiator: "heating",
  air_conditioning: "air_conditioning",
  ac: "air_conditioning",
  private_bathroom: "private_bathroom",
  ensuite: "private_bathroom",
  hot_water: "hot_water",
  quality_linens: "quality_linens",
  towels: "quality_linens",
  self_check_in: "self_check_in",
  self_checkin: "self_check_in",
  smart_lock: "self_check_in",
  access_24_7: "access_24_7",
  access_anytime: "access_24_7",
  smoke_alarms: "smoke_co_alarms",
  co_alarms: "smoke_co_alarms",
  first_aid: "first_aid",
  first_aid_kit: "first_aid",
  lockable_room: "lockable_room",
  locking_door: "lockable_room",
  cctv: "cctv",
  quiet_environment: "quiet_environment",
  quiet: "quiet_environment",
  low_noise: "quiet_environment",
  low_noise_environment: "quiet_environment",
  quality_mattress: "quality_mattress",
  mattress: "quality_mattress",
  late_check_in: "late_check_in",
  late_checkin: "late_check_in",
  early_check_out: "early_check_out",
  early_checkout: "early_check_out",
  distance_to_airport: "distance_to_airport",
  airport_transfer: "distance_to_airport",
  transport_info: "transport_info",
  transportation: "transport_info",
  laundry: "laundry",
  washer_dryer: "laundry",
  kitchen_access: "kitchen_access",
  kitchen: "kitchen_access",
  fridge: "fridge",
  refrigerator: "fridge",
  microwave: "microwave",
  tea_coffee: "tea_coffee",
  tea: "tea_coffee",
  coffee: "tea_coffee",
  power_usb: "power_usb",
  charging: "power_usb",
  parking: "parking",
  host_guidebook: "host_guidebook",
  guidebook: "host_guidebook",
  house_rules: "house_rules",
  emergency_contact: "emergency_contact",
  shared_property: "shared_property",
  shared: "shared_property",
  host_on_site: "host_on_site",
  onsite_host: "host_on_site",
  building_type_house: "building_type_house",
  building_type_apartment: "building_type_apartment",
  building_type_guesthouse: "building_type_guesthouse",
  verified_host: "verified_host",
  verified_address: "verified_address",
};

const toSlug = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

const humanize = (value: string) =>
  value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

export const getAmenityIcon = (icon: string): IconComponent => ICON_MAP[icon] ?? DEFAULT_ICON;

export function resolveAmenity(rawValue: string): AmenityDescriptor {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    const fallback = AMENITY_SCHEMA[0];
    return { ...fallback, Icon: getAmenityIcon(fallback.icon) };
  }
  const slug = toSlug(trimmed.replace(/^has_/, ""));
  const code = AMENITY_ALIASES[slug] || slug;
  const schema = schemaByCode.get(code);
  if (schema) {
    return { ...schema, Icon: getAmenityIcon(schema.icon) };
  }
  return {
    code,
    label: humanize(trimmed),
    icon: "building",
    required: false,
    group: "Other",
    Icon: DEFAULT_ICON,
  };
}

export function mapAmenities(values: Array<string | null | undefined>): AmenityDescriptor[] {
  const seen = new Set<string>();
  const descriptors: AmenityDescriptor[] = [];
  values.forEach((value) => {
    if (!value) return;
    const descriptor = resolveAmenity(value);
    if (seen.has(descriptor.code)) return;
    seen.add(descriptor.code);
    descriptors.push(descriptor);
  });
  return descriptors;
}
