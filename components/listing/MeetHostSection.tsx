import ProfileTrustCard from "@/components/listing/ProfileTrustCard";

type Props = {
  hostName: string;
  hostAvatarUrl?: string | null;
  badge: string;
  badgeTone?: "verified" | "default";
  headline?: string | null;
  bio?: string | null;
  reviewFact?: string | null;
  airportLabel?: string | null;
};

export default function MeetHostSection({
  hostName,
  hostAvatarUrl,
  badge,
  badgeTone = "default",
  headline,
  bio,
  reviewFact,
  airportLabel,
}: Props) {
  const defaultDescription = airportLabel
    ? `${hostName} is a Flexivo host offering practical stays for working professionals near ${airportLabel}.`
    : `${hostName} is a Flexivo host offering practical stays for working professionals.`;
  const hostDescription = bio?.trim() || defaultDescription;
  const normalizedHostDescription =
    hostDescription === "Im a Captain based out of STN"
      ? "I’m a Captain based out of STN."
      : hostDescription;

  const hostFacts = [reviewFact, airportLabel ? `Based near ${airportLabel}` : null]
    .filter(Boolean)
    .map((item) => String(item));

  return (
    <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm lg:p-8">
      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <ProfileTrustCard
          name={hostName}
          avatarUrl={hostAvatarUrl}
          eyebrow="Host profile"
          title={hostName}
          subtitle={headline || "Flexivo host"}
          badge={badge}
          badgeTone={badgeTone}
          supportingText="Hosts on Flexivo provide practical stays for professionals working near airports."
          facts={hostFacts}
          className="self-start bg-slate-50/90 p-5"
        />

        <div className="rounded-3xl border border-slate-200 bg-white p-6">
          <h3 className="text-2xl font-semibold text-slate-900">Meet your host</h3>
          <p className="mt-3 text-sm leading-7 text-slate-600">
            {normalizedHostDescription}
          </p>

          <div className="mt-6 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                Host status
              </p>
              <p className="text-sm font-semibold text-slate-900">{reviewFact || "New host"}</p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                Responds within
              </p>
              <p className="text-sm font-semibold text-slate-900">Usually within a few hours</p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                Area
              </p>
              <p className="text-sm font-semibold text-slate-900">
                {airportLabel ? `Near ${airportLabel}` : "Airport-area accommodation"}
              </p>
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
