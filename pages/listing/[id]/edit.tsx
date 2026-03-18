
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { DayPicker, type DateRange } from "react-day-picker";
import { HostShellLayout } from "@/components/host/HostShellLayout";
import { HostPageHeader } from "@/components/host/HostPageHeader";

// Minimal shape for our form based on your `listings` table
type ListingForm = {
  title: string;
  description: string;
  airport_code: string;
  location: string;
  rental_type: string | null;
  booking_unit: "nightly" | "hourly" | null;
  type: "entire place" | "private room";
  price_per_night: number | string;
  price_per_hour: number | string;
  price_per_week: number | string;
  price_per_month: number | string;
  price_overrides: {
    id: string;
    label: string;
    start_date: string;
    end_date: string;
    price: number | string;
  }[];
  bathrooms: number | string;
  has_wifi: boolean;
  has_desk: boolean;
  has_kitchen: boolean;
  has_shower: boolean;
  has_bathtub: boolean;
  has_fridge: boolean;
  has_coffee_maker: boolean;
  has_closet: boolean;
  photos: string[];
};

const RENTAL_TYPE_LABELS: Record<string, string> = {
  overnight_stay: "Overnight stay",
  crashpad: "Extended stay",
  day_use: "Day-use room",
  split_rest: "Split-rest / nap room",
};

const BOOKING_UNIT_LABELS: Record<"nightly" | "hourly", string> = {
  nightly: "Nightly stays",
  hourly: "Hourly stays",
};

const BOOKING_UNIT_COPY: Record<"nightly" | "hourly", string> = {
  nightly: "Guests book by the night with check-in and checkout dates.",
  hourly: "Guests book in hours for a specific day and time window.",
};

const RENTAL_TYPE_AMENITY_LOCKS: Record<string, Array<keyof ListingForm>> = {
  day_use: ["has_kitchen"],
  split_rest: ["has_kitchen"],
};

export default function EditListingPage() {
  const router = useRouter();
  const { id } = router.query as { id?: string };

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ListingForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [overrideRange, setOverrideRange] = useState<DateRange | undefined>();
  const [overrideLabel, setOverrideLabel] = useState("");
  const [overridePrice, setOverridePrice] = useState("");
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      if (!id) return;

      // Auth check
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        router.replace("/login");
        return;
      }
      setOwnerId(user.id);

      // Load listing
      const { data, error } = await supabase
        .from("listings")
        .select("*")
        .eq("id", id)
        .single();

      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }

      // Owner guard
      if (data.user_id !== user.id) {
        setError("You don't have permission to edit this listing.");
        setLoading(false);
        return;
      }

      const rawType = (data.type as string | null) ?? "entire place";
      const normalizedType = rawType === "shared room" ? "private room" : rawType;

      const initial: ListingForm = {
        title: data.title ?? "",
        description: data.description ?? "",
        airport_code: data.airport_code ?? "",
        location: data.location ?? "",
        rental_type: data.rental_type ?? null,
        booking_unit: data.booking_unit ?? null,
        type: normalizedType as ListingForm["type"],
        price_per_night: data.price_per_night ?? "",
        price_per_hour: data.price_per_hour ?? "",
        price_per_week: data.price_per_week ?? "",
        price_per_month: data.price_per_month ?? "",
        price_overrides:
          Array.isArray(data.price_overrides) && data.price_overrides.length > 0
            ? data.price_overrides.map((entry: any) => ({
                id:
                  typeof crypto !== "undefined" && "randomUUID" in crypto
                    ? crypto.randomUUID()
                    : `${Date.now()}-${Math.random()}`,
                label: entry.label ?? "",
                start_date: entry.start_date ?? "",
                end_date: entry.end_date ?? "",
                price: entry.price ?? "",
              }))
            : [],
        bathrooms: data.bathrooms ?? "",
        has_wifi: !!data.has_wifi,
        has_desk: !!data.has_desk,
        has_kitchen: !!data.has_kitchen,
        has_shower: !!data.has_shower,
        has_bathtub: !!data.has_bathtub,
        has_fridge: !!data.has_fridge,
        has_coffee_maker: !!data.has_coffee_maker,
        has_closet: !!data.has_closet,
        photos:
          Array.isArray(data.photos)
            ? (data.photos.filter((p: any) => typeof p === "string") as string[])
            : [],
      };

      setForm(initial);
      setLoading(false);
    };

    run();
  }, [id, router]);

  const onChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value, type, checked } = e.target as any;
    if (!form) return;
    setForm({
      ...form,
      [name]: type === "checkbox" ? checked : value,
    });
  };

  const addOverrideEntry = () => {
    if (!overrideRange?.from || !overrideRange?.to) {
      setOverrideError("Select a date range first.");
      return;
    }
    if (!overridePrice.trim()) {
      setOverrideError("Enter a nightly price.");
      return;
    }
    const priceValue = Number(overridePrice);
    if (!Number.isFinite(priceValue) || priceValue <= 0) {
      setOverrideError("Enter a positive price.");
      return;
    }
    if (!Number.isInteger(priceValue)) {
      setOverrideError("Use whole pounds (no decimals).");
      return;
    }
    setOverrideError(null);
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;
    setForm((prev) =>
      prev
        ? {
            ...prev,
            price_overrides: [
              ...prev.price_overrides,
              {
                id,
                label: overrideLabel,
                start_date: overrideRange.from.toISOString().slice(0, 10),
                end_date: overrideRange.to.toISOString().slice(0, 10),
                price: priceValue,
              },
            ],
          }
        : prev
    );
    setOverrideRange(undefined);
    setOverrideLabel("");
    setOverridePrice("");
  };

  const removeOverrideEntry = (id: string) => {
    setForm((prev) =>
      prev
        ? {
            ...prev,
            price_overrides: prev.price_overrides.filter((entry) => entry.id !== id),
          }
        : prev
    );
  };

  const totalOverrides = useMemo(
    () => form?.price_overrides.length ?? 0,
    [form?.price_overrides]
  );

  const removeExistingPhoto = (index: number) => {
    setForm((prev) =>
      prev
        ? {
            ...prev,
            photos: prev.photos.filter((_, i) => i !== index),
          }
        : prev
    );
  };

  const removeNewPhotoFile = (index: number) => {
    setPhotoFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handlePhotoInputChange = (files: FileList | null) => {
    if (!files) return;
    const incoming = Array.from(files);
    setPhotoFiles((prev) => [...prev, ...incoming]);
  };

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || !id) return;
    setSaving(true);
    setFormError(null);
    const bookingUnit = form.booking_unit === "hourly" ? "hourly" : "nightly";

    const parseMoney = (value: number | string) => {
      if (value === "" || value === null || typeof value === "undefined") return null;
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    };

    const formattedOverrides =
      bookingUnit === "nightly"
        ? form.price_overrides
            .map((entry) => {
              if (!entry.start_date || !entry.end_date || entry.price === "") return null;
              const priceNum = Number(entry.price);
              if (!Number.isFinite(priceNum) || priceNum <= 0) return null;
              if (!Number.isInteger(priceNum)) return null;
              return {
                label: entry.label?.trim() || null,
                start_date: entry.start_date,
                end_date: entry.end_date,
                price: priceNum,
              };
            })
            .filter(Boolean)
        : [];

    let finalPhotos = Array.isArray(form.photos) ? [...form.photos] : [];

    if (photoFiles.length > 0) {
      let uploadOwner = ownerId;
      if (!uploadOwner) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        uploadOwner = session?.user?.id ?? null;
        if (uploadOwner) setOwnerId(uploadOwner);
      }
      const ownerFolder = uploadOwner ?? "shared";
      const uploaded = await Promise.all(
        photoFiles.map(async (file) => {
          const filename = `${ownerFolder}/${Date.now()}-${file.name.replace(/\s+/g, "-")}`;
          const { error: upErr } = await supabase.storage
            .from("listing-photos")
            .upload(filename, file, {
              cacheControl: "3600",
              upsert: false,
              contentType: (file as File).type || "image/jpeg",
            });
          if (upErr) {
            console.error("Upload error:", upErr.message);
            return null;
          }
          const { data: pub } = supabase.storage.from("listing-photos").getPublicUrl(filename);
          return pub?.publicUrl ?? null;
        })
      );
      const newPhotoUrls = uploaded.filter(Boolean) as string[];
      finalPhotos = [...finalPhotos, ...newPhotoUrls];
    }

    if (finalPhotos.length < 5) {
      setSaving(false);
      setFormError("Please keep at least 5 photos attached to this listing.");
      return;
    }

    const payload: Record<string, unknown> = {
      title: form.title,
      description: form.description,
      airport_code: form.airport_code,
      location: form.location,
      type: form.type,
      bathrooms: form.bathrooms === "" ? null : Number(form.bathrooms),
      has_wifi: form.has_wifi,
      has_desk: form.has_desk,
      has_kitchen: form.has_kitchen,
      has_shower: form.has_shower,
      has_bathtub: form.has_bathtub,
      has_fridge: form.has_fridge,
      has_coffee_maker: form.has_coffee_maker,
      has_closet: form.has_closet,
      photos: finalPhotos,
    };

    if (bookingUnit === "nightly") {
      payload.price_per_night = parseMoney(form.price_per_night);
      payload.price_per_week = parseMoney(form.price_per_week);
      payload.price_per_month = parseMoney(form.price_per_month);
      payload.price_overrides = formattedOverrides.length ? formattedOverrides : null;
    }

    const { error } = await supabase
      .from("listings")
      .update(payload)
      .eq("id", id);

    setSaving(false);

    if (error) {
      setFormError(error.message);
      return;
    }

    setPhotoFiles([]);
    alert("Listing updated");
    router.push(`/listing/${id}`);
  };

  const onDelete = async () => {
    if (!id) return;
    const ok = confirm("Delete this listing? This cannot be undone.");
    if (!ok) return;

    const { error } = await supabase.from("listings").delete().eq("id", id);
    if (error) {
      alert(`Delete failed: ${error.message}`);
      return;
    }
    router.push("/host/listings");
  };

  if (loading) {
    return (
      <HostShellLayout title="Edit listing" activeNav="listings" variant="wide">
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-sm text-slate-500">
          Loading listing details…
        </div>
      </HostShellLayout>
    );
  }
  if (error) {
    return (
      <HostShellLayout title="Edit listing" activeNav="listings" variant="wide">
        <div className="space-y-4">
          <Link href="/host/listings" className="text-sm font-medium text-slate-700 hover:underline">
            ← Back to listings
          </Link>
          <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-4 text-sm text-red-700">
            {error}
          </div>
        </div>
      </HostShellLayout>
    );
  }
  if (!form) return null;

  const bookingUnit = form.booking_unit === "hourly" ? "hourly" : "nightly";
  const rentalLabel = RENTAL_TYPE_LABELS[form.rental_type ?? ""] ?? "Custom";
  const bookingLabel = BOOKING_UNIT_LABELS[bookingUnit];
  const amenityLocks = new Set(
    RENTAL_TYPE_AMENITY_LOCKS[form.rental_type ?? ""] ?? []
  );
  const sectionClass = "rounded-2xl border border-slate-200 bg-white p-6";
  const inputClass =
    "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200";
  const labelClass = "text-sm font-medium text-slate-700";

  return (
    <HostShellLayout title="Edit listing" activeNav="listings" variant="wide">
      <div className="mx-auto w-full max-w-6xl space-y-6 pb-10">
        <HostPageHeader
          title="Edit listing"
          description="Update listing details, pricing setup, photos, and amenities from one place."
          actions={
            <>
              <Link
                href={`/listing/${id}`}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                View listing
              </Link>
              <Link
                href={`/host/listings/${id}/pricing`}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Pricing
              </Link>
              <button
                type="button"
                onClick={onDelete}
                className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                Delete
              </button>
            </>
          }
        />

        <form onSubmit={onSave} className="space-y-6">
          <section className={sectionClass}>
            <h2 className="text-lg font-semibold text-slate-900">Booking setup</h2>
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
                  {rentalLabel}
                </div>
                <div className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
                  {bookingLabel}
                </div>
              </div>
              <p className="mt-3 text-sm text-slate-600">{BOOKING_UNIT_COPY[bookingUnit]}</p>
              <p className="mt-2 text-xs text-slate-500">
                This is set when the listing is created and cannot be changed after the first
                booking.
              </p>
            </div>
          </section>

          <section className={sectionClass}>
            <h2 className="text-lg font-semibold text-slate-900">Basics</h2>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={labelClass}>Title</label>
                <input
                  name="title"
                  value={form.title}
                  onChange={onChange}
                  className={inputClass}
                  placeholder="e.g. Bright room near STN"
                />
              </div>
              <div>
                <label className={labelClass}>Airport code</label>
                <input
                  name="airport_code"
                  value={form.airport_code}
                  onChange={onChange}
                  className={inputClass}
                  placeholder="STN / LHR / LGW / LTN"
                />
              </div>
              <div className="md:col-span-2">
                <label className={labelClass}>Location</label>
                <input
                  name="location"
                  value={form.location}
                  onChange={onChange}
                  className={inputClass}
                  placeholder="Address or area"
                />
              </div>
              <div className="md:col-span-2">
                <label className={labelClass}>Description</label>
                <textarea
                  name="description"
                  value={form.description}
                  onChange={onChange}
                  rows={4}
                  className={`${inputClass} resize-y`}
                  placeholder="Tell guests about your place"
                />
              </div>
            </div>
          </section>

          <section className={sectionClass}>
            <h2 className="text-lg font-semibold text-slate-900">Details</h2>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className={labelClass}>Type</label>
                <select
                  name="type"
                  value={form.type}
                  onChange={onChange}
                  className={inputClass}
                >
                  <option value="entire place">Entire place</option>
                  <option value="private room">Private room</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Bathrooms</label>
                <input
                  type="number"
                  name="bathrooms"
                  value={form.bathrooms}
                  onChange={onChange}
                  className={inputClass}
                />
              </div>
            </div>
          </section>

          <section className={sectionClass}>
            <h2 className="text-lg font-semibold text-slate-900">Pricing</h2>
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {bookingUnit === "hourly" ? "Hourly pricing" : "Nightly pricing"}
                  </p>
                  <p className="text-sm text-slate-600">Manage base pricing on the Pricing page.</p>
                </div>
                <Link
                  href={`/host/listings/${id}/pricing`}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Edit pricing
                </Link>
              </div>
            </div>

            {bookingUnit === "nightly" ? (
              <>
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  <div>
                    <label className={labelClass}>Nightly rate (£)</label>
                    <input
                      name="price_per_night"
                      value={form.price_per_night}
                      onChange={onChange}
                      className={inputClass}
                      placeholder="e.g. 120"
                    />
                  </div>
                  <div>
                    <label className={labelClass}>
                      Weekly rate (£){" "}
                      <span className="font-normal text-slate-500">(optional)</span>
                    </label>
                    <input
                      name="price_per_week"
                      value={form.price_per_week}
                      onChange={onChange}
                      className={inputClass}
                      placeholder="e.g. 700"
                    />
                  </div>
                  <div>
                    <label className={labelClass}>
                      Monthly rate (£){" "}
                      <span className="font-normal text-slate-500">(optional)</span>
                    </label>
                    <input
                      name="price_per_month"
                      value={form.price_per_month}
                      onChange={onChange}
                      className={inputClass}
                      placeholder="e.g. 2500"
                    />
                  </div>
                </div>

                <div className="mt-6 rounded-xl border border-dashed border-slate-300 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">Custom date pricing</h3>
                      <p className="text-sm text-slate-600">
                        Select dates to override your nightly rate.
                      </p>
                    </div>
                    <div className="text-sm text-slate-500">
                      {totalOverrides} {totalOverrides === 1 ? "override" : "overrides"}
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <DayPicker
                        className="avyro-range-picker"
                        mode="range"
                        selected={overrideRange}
                        onSelect={setOverrideRange}
                        numberOfMonths={2}
                        weekStartsOn={1}
                        showOutsideDays={false}
                        styles={{
                          months: { gap: 16 },
                          day: { width: 36, height: 36, borderRadius: 0 },
                          day_selected: { backgroundColor: "#0B0D10", color: "#fff", borderRadius: 9999 },
                          day_range_start: { backgroundColor: "#0B0D10", color: "#fff", borderRadius: 9999 },
                          day_range_end: { backgroundColor: "#0B0D10", color: "#fff", borderRadius: 9999 },
                          day_range_middle: {
                            backgroundColor: "rgba(11,13,16,0.08)",
                            color: "#0B0D10",
                            borderRadius: 0,
                          },
                          day_today: { fontWeight: 500 },
                        }}
                      />
                    </div>
                    <div className="space-y-3">
                      <label className={labelClass}>
                        Label (optional)
                        <input
                          value={overrideLabel}
                          onChange={(e) => setOverrideLabel(e.target.value)}
                          className={inputClass}
                          placeholder="e.g. Christmas"
                        />
                      </label>
                      <label className={labelClass}>
                        Nightly price (£)
                        <input
                          value={overridePrice}
                          onChange={(e) => setOverridePrice(e.target.value)}
                          className={inputClass}
                          placeholder="e.g. 180"
                          type="number"
                          min="1"
                          step="1"
                          inputMode="numeric"
                        />
                      </label>
                      {overrideError && <p className="text-sm text-red-600">{overrideError}</p>}
                      <button
                        type="button"
                        onClick={addOverrideEntry}
                        className="w-full rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                      >
                        Add override
                      </button>
                    </div>
                  </div>
                  {form.price_overrides.length > 0 && (
                    <div className="mt-4 space-y-3">
                      {form.price_overrides.map((entry) => (
                        <div
                          key={entry.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm"
                        >
                          <div>
                            <p className="font-semibold text-slate-900">
                              {entry.label || "Custom price"}
                            </p>
                            <p className="text-slate-600">
                              {entry.start_date} to {entry.end_date} - £{entry.price}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeOverrideEntry(entry.id)}
                            className="text-sm font-semibold text-red-600 hover:underline"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="mt-4">
                <label className={labelClass}>Hourly rate (£)</label>
                <input
                  name="price_per_hour"
                  value={form.price_per_hour}
                  readOnly
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-100 px-3 py-2.5 text-sm text-slate-500"
                />
                <p className="mt-2 text-sm text-slate-500">
                  Hourly listings use the pricing page for rate changes.
                </p>
              </div>
            )}
          </section>

          <section className={sectionClass}>
            <h2 className="text-lg font-semibold text-slate-900">Photos</h2>
            <p className="mt-1 text-sm text-slate-500">
              Keep at least 5 photos so guests can see every angle of your place.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {form.photos.length > 0 ? (
                form.photos.map((photo, index) => (
                  <div key={`${photo}-${index}`} className="relative overflow-hidden rounded-xl border border-slate-200">
                    <img src={photo} alt={`Photo ${index + 1}`} className="h-36 w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeExistingPhoto(index)}
                      className="absolute top-2 right-2 rounded-full bg-slate-900/85 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-900"
                    >
                      Remove
                    </button>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 sm:col-span-3">
                  No photos attached yet.
                </div>
              )}
            </div>
            {photoFiles.length > 0 && (
              <div className="mt-6">
                <p className="mb-2 text-sm font-semibold text-slate-700">New uploads</p>
                <div className="grid gap-4 sm:grid-cols-3">
                  {photoFiles.map((file, index) => (
                    <div key={`${file.name}-${index}`} className="relative overflow-hidden rounded-xl border border-slate-200">
                      <img
                        src={URL.createObjectURL(file)}
                        alt={file.name}
                        className="h-36 w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removeNewPhotoFile(index)}
                        className="absolute top-2 right-2 rounded-full bg-slate-900/85 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-900"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <label className="cursor-pointer rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-700">
                Upload photos
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handlePhotoInputChange(e.target.files)}
                />
              </label>
              <p className="text-sm text-slate-500">
                You can add photos in batches. New uploads appear above.
              </p>
            </div>
          </section>

          <section className={sectionClass}>
            <h2 className="text-lg font-semibold text-slate-900">Amenities</h2>
            {amenityLocks.size > 0 && (
              <p className="mt-1 text-sm text-slate-500">
                Some amenities are locked for this space type.
              </p>
            )}
            <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
              {([
                ["has_wifi", "Wi‑Fi"],
                ["has_desk", "Dedicated workspace"],
                ["has_kitchen", "Kitchen"],
                ["has_fridge", "Fridge"],
                ["has_coffee_maker", "Coffee maker"],
                ["has_shower", "Shower"],
                ["has_bathtub", "Bathtub"],
                ["has_closet", "Closet / storage"],
              ] as [keyof ListingForm, string][]).map(([key, label]) => (
                <label
                  key={key as string}
                  className={`flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 ${
                    amenityLocks.has(key) ? "bg-slate-50 opacity-60" : "bg-white"
                  }`}
                >
                  <input
                    type="checkbox"
                    name={key as string}
                    checked={form[key] as unknown as boolean}
                    onChange={onChange}
                    disabled={amenityLocks.has(key)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </section>

          <section className="sticky bottom-0 z-10 rounded-2xl border border-slate-200 bg-white/95 p-4 backdrop-blur">
            {formError && <p className="mb-3 text-sm text-red-600">{formError}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save changes"}
              </button>
              <Link href={`/listing/${id}`} className="text-sm font-medium text-slate-700 hover:underline">
                Cancel
              </Link>
            </div>
          </section>
        </form>
      </div>
    </HostShellLayout>
  );
}
