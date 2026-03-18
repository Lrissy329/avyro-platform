import { useCallback, useEffect, useState } from "react";
import { HostShellLayout } from "@/components/host/HostShellLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabaseClient";
import { ensureProfile } from "@/lib/ensureProfile";
import { HostPageHeader } from "@/components/host/HostPageHeader";

type HostSettingsRow = {
  host_id: string;
  email_notifications: boolean | null;
  sms_notifications: boolean | null;
  instant_book_enabled: boolean | null;
  cancellation_policy: string | null;
  updated_at?: string | null;
};

const isMissingTable = (error: any) => {
  const code = error?.code;
  const message = String(error?.message ?? "").toLowerCase();
  return code === "42p01" || message.includes("relation") || message.includes("host_settings");
};

export default function HostSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsAvailable, setSettingsAvailable] = useState(true);
  const [hostId, setHostId] = useState<string | null>(null);

  const [emailNotifications, setEmailNotifications] = useState(true);
  const [smsNotifications, setSmsNotifications] = useState(false);
  const [instantBookEnabled, setInstantBookEnabled] = useState(false);
  const [cancellationPolicy, setCancellationPolicy] = useState("flexible");

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      setLoading(false);
      return;
    }

    setHostId(user.id);
    await ensureProfile();

    const { data, error: settingsError } = await supabase
      .from("host_settings")
      .select(
        "host_id, email_notifications, sms_notifications, instant_book_enabled, cancellation_policy, updated_at"
      )
      .eq("host_id", user.id)
      .maybeSingle();

    if (settingsError) {
      if (isMissingTable(settingsError)) {
        setSettingsAvailable(false);
      } else {
        setError(settingsError.message ?? "Unable to load settings.");
      }
      setLoading(false);
      return;
    }

    const row = data as HostSettingsRow | null;
    if (row) {
      setEmailNotifications(row.email_notifications ?? true);
      setSmsNotifications(row.sms_notifications ?? false);
      setInstantBookEnabled(row.instant_book_enabled ?? false);
      setCancellationPolicy(row.cancellation_policy ?? "flexible");
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSave = useCallback(async () => {
    if (!hostId || !settingsAvailable) return;
    setSaving(true);
    setError(null);

    const payload = {
      host_id: hostId,
      email_notifications: emailNotifications,
      sms_notifications: smsNotifications,
      instant_book_enabled: instantBookEnabled,
      cancellation_policy: cancellationPolicy,
      updated_at: new Date().toISOString(),
    };

    const { error: saveError } = await supabase
      .from("host_settings")
      .upsert(payload, { onConflict: "host_id" });

    if (saveError) {
      setError(saveError.message ?? "Unable to save settings.");
    }

    setSaving(false);
  }, [
    hostId,
    settingsAvailable,
    emailNotifications,
    smsNotifications,
    instantBookEnabled,
    cancellationPolicy,
  ]);

  return (
    <HostShellLayout title="Settings" activeNav="settings">
      <div className="space-y-8">
        <HostPageHeader
          title="Settings"
          description="Manage notifications, instant book, and cancellation defaults."
        />

        {!settingsAvailable ? (
          <Card className="rounded-2xl border-amber-200 bg-amber-50 px-6 py-4 text-sm text-amber-700">
            Host settings storage is not configured. Create the `host_settings` table to enable
            these preferences.
          </Card>
        ) : null}

        <Card className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {loading ? (
            <p className="text-sm text-slate-500">Loading settings…</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Email notifications</p>
                  <p className="text-xs text-slate-500">Receive booking updates by email.</p>
                </div>
                <input
                  type="checkbox"
                  checked={emailNotifications}
                  onChange={(event) => setEmailNotifications(event.target.checked)}
                  className="h-5 w-5 rounded border-slate-300 text-slate-900"
                  disabled={!settingsAvailable}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-900">SMS notifications</p>
                  <p className="text-xs text-slate-500">Get urgent alerts by text message.</p>
                </div>
                <input
                  type="checkbox"
                  checked={smsNotifications}
                  onChange={(event) => setSmsNotifications(event.target.checked)}
                  className="h-5 w-5 rounded border-slate-300 text-slate-900"
                  disabled={!settingsAvailable}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Instant Book</p>
                  <p className="text-xs text-slate-500">
                    Allow verified guests to book without approval (where supported).
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={instantBookEnabled}
                  onChange={(event) => setInstantBookEnabled(event.target.checked)}
                  className="h-5 w-5 rounded border-slate-300 text-slate-900"
                  disabled={!settingsAvailable}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Cancellation policy</p>
                  <p className="text-xs text-slate-500">Choose a default for new listings.</p>
                </div>
                <select
                  value={cancellationPolicy}
                  onChange={(event) => setCancellationPolicy(event.target.value)}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900"
                  disabled={!settingsAvailable}
                >
                  <option value="flexible">Flexible · Full refund up to 24 hours</option>
                  <option value="moderate">Moderate · 50% refund up to 5 days</option>
                </select>
              </div>

              {error ? <p className="text-sm text-rose-600">{error}</p> : null}

              <div className="flex items-center gap-3">
                <Button
                  onClick={handleSave}
                  disabled={saving || !settingsAvailable}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-white hover:bg-slate-800"
                >
                  {saving ? "Saving…" : "Save settings"}
                </Button>
                <Button
                  onClick={loadSettings}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-slate-800 hover:bg-slate-50"
                >
                  Reset
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </HostShellLayout>
  );
}
