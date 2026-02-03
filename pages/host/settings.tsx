import { HostShellLayout } from "@/components/host/HostShellLayout";
import { Card } from "@/components/ui/card";

export default function HostSettingsPage() {
  return (
    <HostShellLayout title="Settings" activeNav="settings">
      <Card className="rounded-2xl border-slate-200 px-6 py-5">
        <h2 className="text-sm font-semibold text-slate-900">Settings</h2>
        <p className="mt-2 text-sm text-slate-500">
          Host account settings are coming soon.
        </p>
      </Card>
    </HostShellLayout>
  );
}
