import Image from "next/image";
import Link from "next/link";

type Props = {
  id: string;
  title: string;
  imageUrl: string;
  badgeText?: string;
  rating?: number;
  ratingLabel?: string;
  reviewCount?: number;
  meta?: string;
};

export default function HomeListingCard({
  id,
  title,
  imageUrl,
  badgeText = "OVERNIGHT",
  rating,
  ratingLabel,
  reviewCount,
  meta,
}: Props) {
  return (
    <Link
      href={`/listing/${id}`}
      className="flex w-[260px] shrink-0 flex-col rounded-3xl border border-neutral-200 bg-white shadow-sm transition hover:shadow-md md:w-[300px]"
    >
      <div className="p-3">
        <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-neutral-100">
          <Image
            src={imageUrl}
            alt={title}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 260px, 300px"
          />
          {badgeText ? (
            <div className="absolute left-3 top-3 rounded-full bg-black px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#FEDD02]">
              {badgeText}
            </div>
          ) : null}
        </div>
      </div>

      <div className="space-y-2 px-4 pb-4">
        <div className="text-lg font-semibold leading-snug text-neutral-900 line-clamp-2">{title}</div>

        {rating != null || ratingLabel || reviewCount != null ? (
          <div className="text-sm text-neutral-700">
            {rating != null ? (
              <span className="font-semibold">{rating.toFixed(1)}</span>
            ) : null}
            {ratingLabel ? <span className="text-neutral-400"> · </span> : null}
            {ratingLabel ? <span>{ratingLabel}</span> : null}
            {reviewCount != null ? <span className="text-neutral-400"> · </span> : null}
            {reviewCount != null ? <span>{reviewCount} reviews</span> : null}
          </div>
        ) : null}

        {meta ? <div className="text-sm text-neutral-500 line-clamp-1">{meta}</div> : null}
      </div>
    </Link>
  );
}
