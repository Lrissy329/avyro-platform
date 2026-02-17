import type { GetServerSideProps } from "next";
import { requireOpsStaff } from "@/lib/opsAuth";
import { getDefaultOpsRoute } from "@/lib/opsRbac";

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const guard = await requireOpsStaff(ctx);
  if ("redirect" in guard) return guard;

  return {
    redirect: {
      destination: getDefaultOpsRoute(guard.staff.role),
      permanent: false,
    },
  };
};

export default function OpsIndex() {
  return null;
}
