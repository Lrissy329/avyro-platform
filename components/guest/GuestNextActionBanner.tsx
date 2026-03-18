import Link from "next/link";

type NextActionButton = {
  label: string;
  href?: string;
  onClick?: () => void;
  tone?: "primary" | "secondary";
};

type NextAction = {
  title: string;
  description: string;
  buttons: NextActionButton[];
};

type GuestNextActionBannerProps = {
  action: NextAction;
};

const buttonClasses = (tone: "primary" | "secondary" = "primary") =>
  tone === "primary"
    ? "inline-flex items-center justify-center rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100"
    : "inline-flex items-center justify-center rounded-lg border border-white/30 px-3 py-2 text-sm font-semibold text-white hover:bg-white/10";

function ActionButton({ button }: { button: NextActionButton }) {
  if (button.href) {
    return (
      <Link href={button.href} className={buttonClasses(button.tone)}>
        {button.label}
      </Link>
    );
  }

  return (
    <button type="button" onClick={button.onClick} className={buttonClasses(button.tone)}>
      {button.label}
    </button>
  );
}

export function GuestNextActionBanner({ action }: GuestNextActionBannerProps) {
  return (
    <section className="rounded-2xl bg-slate-900 p-5 text-white shadow-sm">
      <h2 className="text-lg font-semibold">{action.title}</h2>
      <p className="mt-2 text-sm text-slate-200">{action.description}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {action.buttons.map((button) => (
          <ActionButton key={`${button.label}:${button.href ?? "action"}`} button={button} />
        ))}
      </div>
    </section>
  );
}

export type { NextAction };
