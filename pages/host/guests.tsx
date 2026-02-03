import { HostShellLayout } from "@/components/host/HostShellLayout";
import { Card } from "@/components/ui/card";

export default function HostGuestsPage() {
  return (
    <HostShellLayout title="Guests" activeNav="guests">
      <Card className="rounded-2xl border-slate-200 px-6 py-5">
        <h2 className="text-sm font-semibold text-slate-900">Guests</h2>
        <p className="mt-2 text-sm text-slate-500">
          Guest management is coming soon.
        </p>
      </Card>
    </HostShellLayout>
  );
}
