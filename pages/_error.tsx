import type { NextPageContext } from "next";

type ErrorPageProps = {
  statusCode?: number;
};

function ErrorPage({ statusCode }: ErrorPageProps) {
  const title =
    statusCode && statusCode >= 500
      ? "Something went wrong on our side."
      : "The page could not be loaded.";

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center px-6 text-center">
      <p className="text-sm uppercase tracking-[0.18em] text-slate-400">Error {statusCode ?? 500}</p>
      <h1 className="mt-3 text-2xl font-semibold text-slate-900">{title}</h1>
      <p className="mt-2 text-sm text-slate-600">
        Please refresh the page. If the issue continues, try again in a moment.
      </p>
    </main>
  );
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext) => {
  const statusCode = res?.statusCode ?? err?.statusCode ?? 500;
  return { statusCode };
};

export default ErrorPage;
