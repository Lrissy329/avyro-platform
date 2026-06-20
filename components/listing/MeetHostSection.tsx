import ProfileTrustCard from "@/components/listing/ProfileTrustCard";
import TrustBadge from "@/components/trust/TrustBadge";
import { MapPin, ShieldCheck } from "lucide-react";

type Props = {
  hostName: string;
  hostAvatarUrl?: string | null;
  headline?: string | null;
  bio?: string | null;
  reviewFact?: string | null;
  airportLabel?: string | null;
};

export default function MeetHostSection({
  hostName,
  hostAvatarUrl,
  headline,
  bio,
  reviewFact,
  airportLabel,
}: Props) {
  const defaultDescription = airportLabel
    ? `${hostName} hosts on Flexivo and offers practical stays for working professionals near ${airportLabel}.`
    : `${hostName} hosts on Flexivo and offers practical stays for working professionals.`;
  const hostDescription = bio?.trim() || defaultDescription;
  const normalizedHostDescription =
    hostDescription === "Im a Captain based out of STN"
      ? "I’m a Captain based out of STN."
      : hostDescription;

  return (
    <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm lg:p-8">
      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <ProfileTrustCard
          name={hostName}
          avatarUrl={hostAvatarUrl}
          eyebrow="Host profile"
          title={hostName}
          subtitle={headline || "Hosted on Flexivo"}
          supportingText="Hosts on Flexivo provide practical stays for professionals working near airports."
          facts={[]}
          trustBadges={[
            { type: "flexivo_host" },
            ...(airportLabel ? [{ type: "airport_local" as const, label: `Near ${airportLabel}` }] : []),
          ]}
          className="self-start bg-slate-50/90 p-5"
        />

        <div className="rounded-3xl border border-slate-100 bg-white p-6">
          <h3 className="text-2xl font-semibold text-slate-900">Meet your host</h3>
          <p className="mt-3 text-sm leading-7 text-slate-600">
            {normalizedHostDescription}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <TrustBadge type="flexivo_host" />
            {airportLabel ? <TrustBadge type="airport_local" label={`Near ${airportLabel}`} /> : null}
          </div>

          <div className="mt-6 space-y-3">
            <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4">
              <ShieldCheck className="mt-0.5 h-4 w-4 text-slate-500" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-slate-900">Host status</p>
                <p className="text-sm text-slate-600">{reviewFact || "New host"}</p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4">
              <MapPin className="mt-0.5 h-4 w-4 text-slate-500" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {airportLabel ? `Based near ${airportLabel === "STN" ? "Stansted Airport" : airportLabel}` : "Airport-area accommodation"}
                </p>
                <p className="text-sm text-slate-600">Practical stays designed around airport-area access.</p>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled
              className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white opacity-60"
            >
              Message host
            </button>
            <p className="text-sm text-slate-500">
              Questions before booking? Message the host before you reserve.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
