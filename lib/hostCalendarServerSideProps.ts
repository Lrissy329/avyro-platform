import type { GetServerSideProps } from "next";
import { createPagesServerClient } from "@supabase/auth-helpers-nextjs";

export const getHostCalendarServerSideProps: GetServerSideProps = async (ctx) => {
  const authClient = createPagesServerClient(ctx);
  const {
    data: { session },
    error: sessionError,
  } = await authClient.auth.getSession();

  if (sessionError || !session?.user?.id) {
    return {
      redirect: {
        destination: `/login?redirect=${encodeURIComponent(ctx.resolvedUrl)}`,
        permanent: false,
      },
    };
  }

  return { props: {} };
};

