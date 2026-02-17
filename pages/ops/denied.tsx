import OpsLayout from "@/components/ops/OpsLayout";

export default function OpsDenied() {
  return (
    <OpsLayout title="Access denied">
      <div className="mx-auto max-w-xl rounded-3xl border border-[var(--ops-border)] bg-[var(--ops-panel)] p-6">
        <h1 className="text-lg font-semibold text-white">Access denied</h1>
        <p className="mt-2 text-sm text-[var(--ops-muted)]">
          Your account is not authorized for the Ops Console. Contact an admin to request access.
        </p>
      </div>
    </OpsLayout>
  );
}
