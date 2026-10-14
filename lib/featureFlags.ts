// Single switch for the Shared Stay feature (one listing split into individual spaces, each guest books and
// pays for their own). It is OFF for launch and is hidden, not removed: every gated block is tagged
//   SHARED_STAYS (disabled for launch): see docs/shared-stays-hidden.md
// so `grep -rn "SHARED_STAYS" .` lists them all.
//
// The variable must be NEXT_PUBLIC_ so browser code can read it. Next.js bakes it in at BUILD time, so
// changing it needs a rebuild/redeploy (a dev-server restart locally). Anything other than the exact string
// "true" (including unset) means OFF.
export const SHARED_STAYS_ENABLED = process.env.NEXT_PUBLIC_SHARED_STAYS_ENABLED === "true";

// Returned by the shared-stay API routes while the feature is off.
export const SHARED_STAYS_DISABLED_BODY = {
  error: "Shared stays are not available.",
  code: "SHARED_STAYS_DISABLED",
} as const;
