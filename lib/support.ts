// One place to change the guest/host-facing support contact address. Prefer
// the env var (so ops can change it without a code deploy) and fall back to
// the known-good literal so this never resolves to an empty string.
export const SUPPORT_EMAIL =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@aeronooc.com";
