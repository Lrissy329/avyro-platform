import type { GetServerSideProps } from "next";

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: "/host/calendar",
      permanent: false,
    },
  };
};

export default function HostCalendarLegacyRedirectPage() {
  return null;
}
