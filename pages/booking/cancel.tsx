import Link from "next/link";
import { useRouter } from "next/router";

export default function BookingCancelPage() {
  const router = useRouter();
  const { booking: bookingId } = router.query;

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-xl px-6 py-16">
        <div className="rounded-3xl bg-white shadow-xl border border-slate-200 px-8 py-10">
          <div className="flex items-center gap-3 text-red-600">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100">
              !
            </span>
            <h1 className="text-2xl font-semibold text-gray-900">Checkout cancelled</h1>
          </div>
          <p className="mt-4 text-sm text-gray-600">
            No charges were made. You can return to the listing to try again or adjust your booking
            details.
          </p>
          {bookingId && (
            <p className="mt-2 text-xs text-gray-500">
              Booking reference: <code className="font-mono">{bookingId}</code>
            </p>
          )}

          <div className="mt-10 flex flex-wrap gap-3">
            {bookingId ? (
              <Link
                href={`/listing/${bookingId}`}
                className="inline-flex items-center rounded-full bg-black px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-900"
              >
                Return to listing
              </Link>
            ) : (
              <Link
                href="/"
                className="inline-flex items-center rounded-full bg-black px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-900"
              >
                Back to home
              </Link>
            )}
            <Link
              href="/guest/dashboard"
              className="inline-flex items-center rounded-full border border-gray-300 px-5 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-100"
            >
              Go to your dashboard
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
