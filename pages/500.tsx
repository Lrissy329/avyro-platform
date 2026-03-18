export default function ServerErrorPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center px-6 text-center">
      <p className="text-sm uppercase tracking-[0.18em] text-slate-400">500</p>
      <h1 className="mt-3 text-2xl font-semibold text-slate-900">Server error</h1>
      <p className="mt-2 text-sm text-slate-600">
        We hit a temporary issue while loading this page. Please try again.
      </p>
    </main>
  );
}
