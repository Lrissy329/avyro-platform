import { HostShellLayout } from "@/components/host/HostShellLayout";
import { Card } from "@/components/ui/card";

export default function HostPayoutsPage() {
  return (
    <HostShellLayout title="Payouts" activeNav="payouts">
      <Card className="rounded-2xl border-slate-200 px-6 py-5">
        <h2 className="text-sm font-semibold text-slate-900">Payouts</h2>
        <p className="mt-2 text-sm text-slate-500">
          Payout settings and history are coming soon.
        </p>
      </Card>
    </HostShellLayout>
  );
}
