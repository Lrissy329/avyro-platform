import type { GetServerSideProps } from "next";

export const getServerSideProps: GetServerSideProps = async (context) => {
  const query = new URLSearchParams();

  Object.entries(context.query).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => query.append(key, String(entry)));
      return;
    }
    if (value != null) {
      query.set(key, String(value));
    }
  });

  const destination = query.toString()
    ? `/booking/success?${query.toString()}`
    : "/booking/success";

  return {
    redirect: {
      destination,
      permanent: false,
    },
  };
};

export default function LegacySuccessRedirectPage() {
  return null;
}
