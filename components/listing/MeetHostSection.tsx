import { MapPin, ShieldCheck } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

type Props = {
  hostName: string;
  hostAvatarUrl?: string | null;
  headline?: string | null;
  bio?: string | null;
  isVerified?: boolean | null;
  reviewCount: number;
  reviewOverall?: number | null;
  airportLabel?: string | null;
};

const initialsForName = (name: string) =>
  name
    .split(" ")
    .map((part) => part.trim()[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();

export default function MeetHostSection({
  hostName,
  hostAvatarUrl,
  headline,
  bio,
  isVerified,
  reviewCount,
  reviewOverall,
  airportLabel,
}: Props) {
  const defaultDescription = airportLabel
    ? `${hostName} hosts on Flexivo and offers practical stays for working professionals near ${airportLabel}.`
    : `${hostName} hosts on Flexivo and offers practical stays for working professionals.`;
  const hostDescription = bio?.trim() || defaultDescription;
  // One known host profile is missing its apostrophe in the stored bio text; corrected here
  // rather than leaving a visibly broken contraction on a live listing.
  const normalizedHostDescription =
    hostDescription === "Im a Captain based out of STN"
      ? "I’m a Captain based out of STN."
      : hostDescription;

  const hasReviews = reviewCount > 0;

  return (
    <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm lg:p-8">
      <h3 className="text-2xl font-semibold text-slate-900">Meet your host</h3>

      <div className="mt-6 flex items-center gap-5">
        <div className="relative shrink-0">
          <Avatar className="h-24 w-24 border border-slate-200">
            {hostAvatarUrl ? (
              <AvatarImage src={hostAvatarUrl} alt={hostName} className="object-cover" />
            ) : null}
            <AvatarFallback className="bg-slate-100 text-xl font-semibold text-slate-600">
              {initialsForName(hostName)}
            </AvatarFallback>
          </Avatar>
          {isVerified ? (
            <span
              className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-slate-900"
              title="Identity verified"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-white" aria-hidden="true" />
            </span>
          ) : null}
        </div>
        <div className="min-w-0">
          <p className="text-xl font-semibold text-slate-900">{hostName}</p>
          {headline ? <p className="mt-0.5 text-sm text-slate-500">{headline}</p> : null}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-x-10 gap-y-3 border-y border-slate-100 py-5">
        {hasReviews ? (
          <>
            <div>
              <p className="text-xl font-semibold text-slate-900 tabular-nums">{reviewCount}</p>
              <p className="text-xs text-slate-500">{reviewCount === 1 ? "Review" : "Reviews"}</p>
            </div>
            <div>
              <p className="text-xl font-semibold text-slate-900 tabular-nums">
                {(reviewOverall ?? 0).toFixed(1)}
              </p>
              <p className="text-xs text-slate-500">Rating out of 10</p>
            </div>
          </>
        ) : (
          <div>
            <p className="text-xl font-semibold text-slate-900">New host</p>
            <p className="text-xs text-slate-500">No stays completed yet</p>
          </div>
        )}
        {isVerified ? (
          <div>
            <p className="flex items-center gap-1.5 text-xl font-semibold text-slate-900">
              <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              Verified
            </p>
            <p className="text-xs text-slate-500">Identity confirmed</p>
          </div>
        ) : null}
      </div>

      <p className="mt-5 text-sm leading-7 text-slate-600">{normalizedHostDescription}</p>

      <div className="mt-5 flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4">
        <MapPin className="mt-0.5 h-4 w-4 text-slate-500" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-slate-900">
            {airportLabel
              ? `Based near ${airportLabel === "STN" ? "Stansted Airport" : airportLabel}`
              : "Airport-area accommodation"}
          </p>
          <p className="text-sm text-slate-600">Practical stays designed around airport-area access.</p>
        </div>
      </div>
    </section>
  );
}
