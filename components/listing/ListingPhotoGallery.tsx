import Image from "next/image";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PhotoIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

type Props = {
  photos: string[];
  title: string;
  commuteBadge?: string | null;
  className?: string;
};

const joinClasses = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(" ");

const showAllLabel = (count: number) => {
  if (count <= 0) return "No photos yet";
  if (count === 1) return "View photo";
  return `View all photos (${count})`;
};

function GalleryImage({
  src,
  alt,
  priority = false,
}: {
  src: string;
  alt: string;
  priority?: boolean;
}) {
  return (
    <Image
      src={src}
      alt={alt}
      fill
      priority={priority}
      sizes="(max-width: 1023px) 85vw, 50vw"
      className="object-cover transition duration-500 group-hover:scale-[1.03]"
    />
  );
}

function GalleryButton({
  src,
  alt,
  onClick,
  className,
  priority = false,
  overlay,
}: {
  src: string;
  alt: string;
  onClick: () => void;
  className?: string;
  priority?: boolean;
  overlay?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={joinClasses(
        "group relative w-full overflow-hidden bg-slate-100 text-left",
        "transition duration-200 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-slate-900/20",
        className
      )}
    >
      <GalleryImage
        src={src}
        alt={alt}
        priority={priority}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/20 via-slate-950/6 to-transparent opacity-0 transition duration-200 group-hover:opacity-100" />
      {overlay}
    </button>
  );
}

function EmptyGallery({ title }: { title: string }) {
  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eef2f7_45%,#f8fafc_100%)] shadow-sm">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(250,204,21,0.18),transparent_32%)]" />
      <div className="relative flex min-h-[20rem] flex-col items-center justify-center gap-4 px-6 py-10 text-center lg:min-h-[32rem]">
        <div className="rounded-full border border-slate-200 bg-white/90 p-4 text-slate-500 shadow-sm">
          <PhotoIcon className="h-8 w-8" aria-hidden="true" />
        </div>
        <div className="space-y-2">
          <p className="text-lg font-semibold text-slate-900">Photo gallery coming soon</p>
          <p className="mx-auto max-w-md text-sm leading-6 text-slate-600">
            {title} does not have published photos yet. Hosts can still keep the stay live while
            the gallery is being prepared.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function ListingPhotoGallery({
  photos,
  title,
  commuteBadge,
  className,
}: Props) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const galleryPhotos = useMemo(
    () => photos.filter((photo, index) => typeof photo === "string" && photo.trim() && photos.indexOf(photo) === index),
    [photos]
  );

  const photoCount = galleryPhotos.length;
  const hasPhotos = photoCount > 0;

  useEffect(() => {
    if (activeIndex == null) return;

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveIndex(null);
        return;
      }
      if (photoCount <= 1) return;
      if (event.key === "ArrowRight") {
        setActiveIndex((current) => (current == null ? 0 : (current + 1) % photoCount));
      }
      if (event.key === "ArrowLeft") {
        setActiveIndex((current) =>
          current == null ? 0 : (current - 1 + photoCount) % photoCount
        );
      }
    };

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [activeIndex, photoCount]);

  const openPhoto = (index: number) => {
    if (!hasPhotos) return;
    setActiveIndex(index);
  };

  const currentPhoto = activeIndex != null ? galleryPhotos[activeIndex] : null;
  const currentCountLabel =
    activeIndex != null ? `${activeIndex + 1} / ${photoCount}` : `${photoCount} photos`;
  const heroCommuteBadge = commuteBadge ? (
    <div className="pointer-events-none absolute bottom-4 left-4 z-10">
      <span className="inline-flex items-center rounded-full border border-white/12 bg-slate-950/60 px-3 py-1.5 text-xs font-semibold text-white shadow-sm backdrop-blur-md">
        {commuteBadge}
      </span>
    </div>
  ) : null;

  const desktopGallery = () => {
    if (!hasPhotos) return <EmptyGallery title={title} />;
    if (photoCount === 1) {
      return (
        <div className="hidden lg:block">
          <GalleryButton
            src={galleryPhotos[0]}
            alt={`${title} photo 1`}
            onClick={() => openPhoto(0)}
            priority
            className="h-[30rem] rounded-[2rem]"
            overlay={heroCommuteBadge}
          />
        </div>
      );
    }

    const remaining = galleryPhotos.slice(1, 5);

    return (
      <div className="hidden lg:grid lg:h-[30rem] lg:grid-cols-[minmax(0,2.35fr)_minmax(0,1fr)] lg:gap-3">
        <GalleryButton
          src={galleryPhotos[0]}
          alt={`${title} photo 1`}
          onClick={() => openPhoto(0)}
          priority
          className="h-full rounded-[2rem]"
          overlay={heroCommuteBadge}
        />
        {photoCount === 2 ? (
          <GalleryButton
            src={galleryPhotos[1]}
            alt={`${title} photo 2`}
            onClick={() => openPhoto(1)}
            className="h-full rounded-[2rem]"
          />
        ) : photoCount === 3 ? (
          <div className="grid h-full grid-rows-2 gap-3">
            {remaining.map((photo, index) => (
              <GalleryButton
                key={photo}
                src={photo}
                alt={`${title} photo ${index + 2}`}
                onClick={() => openPhoto(index + 1)}
                className="h-full rounded-[1.6rem]"
              />
            ))}
          </div>
        ) : photoCount === 4 ? (
          <div className="grid h-full grid-cols-2 grid-rows-2 gap-3">
            <GalleryButton
              src={galleryPhotos[1]}
              alt={`${title} photo 2`}
              onClick={() => openPhoto(1)}
              className="col-span-2 h-full rounded-[1.6rem]"
            />
            <GalleryButton
              src={galleryPhotos[2]}
              alt={`${title} photo 3`}
              onClick={() => openPhoto(2)}
              className="h-full rounded-[1.6rem]"
            />
            <GalleryButton
              src={galleryPhotos[3]}
              alt={`${title} photo 4`}
              onClick={() => openPhoto(3)}
              className="h-full rounded-[1.6rem]"
            />
          </div>
        ) : (
          <div className="grid h-full grid-cols-2 grid-rows-2 gap-3">
            {remaining.map((photo, index) => (
              <GalleryButton
                key={photo}
                src={photo}
                alt={`${title} photo ${index + 2}`}
                onClick={() => openPhoto(index + 1)}
                className="h-full rounded-[1.6rem]"
                overlay={
                  index === 3 && photoCount > 5 ? (
                    <div className="absolute inset-0 flex items-end justify-end bg-black/20 p-4">
                      <span className="rounded-full bg-white/92 px-3 py-1.5 text-xs font-semibold text-slate-900 shadow-sm">
                        +{photoCount - 5} more
                      </span>
                    </div>
                  ) : null
                }
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <section className={joinClasses("relative", className)}>
        {hasPhotos ? (
          <>
            <div className="lg:hidden">
              <div className="relative -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:-mx-6 sm:px-6">
                {galleryPhotos.map((photo, index) => (
                  <GalleryButton
                    key={`${photo}-${index}`}
                    src={photo}
                    alt={`${title} photo ${index + 1}`}
                    onClick={() => openPhoto(index)}
                    priority={index === 0}
                    className={joinClasses(
                      "h-[20rem] min-w-[86%] snap-center rounded-[2rem]",
                      photoCount === 1 && "min-w-full"
                    )}
                    overlay={index === 0 ? heroCommuteBadge : null}
                  />
                ))}
              </div>
              <div className="pointer-events-none absolute inset-x-4 top-4 flex items-start justify-between sm:inset-x-6">
                <span className="rounded-full border border-white/60 bg-white/78 px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm backdrop-blur-md">
                  {photoCount} photo{photoCount === 1 ? "" : "s"}
                </span>
              </div>
            </div>
            {desktopGallery()}
            <button
              type="button"
              onClick={() => openPhoto(0)}
              className="absolute bottom-4 right-4 inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/78 px-3.5 py-2 text-sm font-semibold text-slate-900 shadow-lg backdrop-blur-md transition hover:bg-white/90"
            >
              <PhotoIcon className="h-4 w-4" aria-hidden="true" />
              <span>{showAllLabel(photoCount)}</span>
            </button>
          </>
        ) : (
          <EmptyGallery title={title} />
        )}
      </section>

      {currentPhoto ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/92 p-4 sm:p-6">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close photo gallery"
            onClick={() => setActiveIndex(null)}
          />
          <div className="relative z-10 flex w-full max-w-6xl flex-col gap-4">
            <div className="flex items-center justify-between gap-3 text-white">
              <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-sm font-medium backdrop-blur">
                {currentCountLabel}
              </span>
              <button
                type="button"
                onClick={() => setActiveIndex(null)}
                className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/20"
              >
                <XMarkIcon className="h-5 w-5" aria-hidden="true" />
                Close
              </button>
            </div>

            <div className="relative flex min-h-[20rem] items-center justify-center overflow-hidden rounded-[2rem] bg-black/30 shadow-2xl">
              {photoCount > 1 ? (
                <button
                  type="button"
                  onClick={() =>
                    setActiveIndex((current) =>
                      current == null ? 0 : (current - 1 + photoCount) % photoCount
                    )
                  }
                  className="absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/15 bg-white/10 p-3 text-white backdrop-blur transition hover:bg-white/20"
                  aria-label="Previous photo"
                >
                  <ChevronLeftIcon className="h-5 w-5" aria-hidden="true" />
                </button>
              ) : null}

              <Image
                src={currentPhoto}
                alt={`${title} photo ${activeIndex + 1}`}
                width={1600}
                height={1200}
                priority
                sizes="100vw"
                className="max-h-[78vh] w-auto max-w-full object-contain"
              />

              {photoCount > 1 ? (
                <button
                  type="button"
                  onClick={() =>
                    setActiveIndex((current) =>
                      current == null ? 0 : (current + 1) % photoCount
                    )
                  }
                  className="absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/15 bg-white/10 p-3 text-white backdrop-blur transition hover:bg-white/20"
                  aria-label="Next photo"
                >
                  <ChevronRightIcon className="h-5 w-5" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
