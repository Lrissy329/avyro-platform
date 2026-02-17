import type { GetServerSideProps } from "next";
import { requireOpsStaff } from "@/lib/opsAuth";

type PageProps = {
  staffRole: string;
};

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => {
  const guard = await requireOpsStaff(ctx, { permission: "ops:sales:read" });
  if ("redirect" in guard) return guard;

  return {
    redirect: {
      destination: "/ops/sales/dashboard",
      permanent: false,
    },
  };
};

export default function OpsSales({ staffRole }: PageProps) {
  return null;
}
