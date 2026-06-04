type Props = {
  emailVerified: boolean;
};

const verificationCards = [
  {
    title: "Email Verified",
    description: "Confirms the email attached to your Avyro account.",
  },
  {
    title: "Professional Verification",
    description: "Reserved for a future work-identity flow for crew and business travellers.",
  },
  {
    title: "LinkedIn Verification",
    description: "Reserved for a future professional profile verification flow.",
  },
];

export default function GuestVerificationPanel({ emailVerified }: Props) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-slate-900">Verification</h3>
      <p className="mt-1 text-sm text-slate-500">
        These cards show what is already confirmed on your account and what is planned next.
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {verificationCards.map((card) => {
          const isEmailCard = card.title === "Email Verified";
          const isVerified = isEmailCard ? emailVerified : false;

          return (
            <div
              key={card.title}
              className="rounded-2xl border border-slate-200 bg-slate-50/80 p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-900">{card.title}</p>
                <span
                  className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                    isVerified
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {isEmailCard ? (isVerified ? "Verified" : "Not verified") : "Coming soon"}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-500">{card.description}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
