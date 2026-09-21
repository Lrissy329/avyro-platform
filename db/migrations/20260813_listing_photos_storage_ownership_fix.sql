-- Listing-photos storage policy hardening -- Step 6 (additive only).
--
-- Fixes the confirmed live gap: objects_insert_listing_photos_auth_only's
-- WITH CHECK is `bucket_id = 'listing-photos'` only -- any authenticated
-- user can upload to any path in this bucket, regardless of who they are
-- or which listing the path is meant for.
--
-- Path convention, confirmed by reading the actual upload code:
--   pages/host/create-listing.tsx:810  filename = `${userId}/${timestamp}-${name}`
--   pages/listing/[id]/edit.tsx:375    filename = `${ownerFolder}/${timestamp}-${name}`
--     (ownerFolder is the uploading session user's own id, falling back to
--     the literal string "shared" only if no session id could be resolved)
--
-- The object path carries the UPLOADER's own user id as its first folder
-- segment -- it does not carry a listing id anywhere. This rules out the
-- preferred public.listings.user_id = auth.uid() join approach entirely,
-- not just as a style choice: in create-listing.tsx, photos are uploaded
-- BEFORE the listings row is inserted ("Upload photos first so we can
-- store them with the insert"), so no listing id exists yet at upload
-- time for that flow -- there is nothing to join against.
--
-- Given that, the achievable and correct fix is the same pattern already
-- used for the avatars bucket: restrict INSERT to the caller's own
-- user-id folder. This closes the actual exploitable gap (any
-- authenticated user writing into any other user's path) using exactly
-- what the path already reliably carries.
--
-- Does NOT touch: public read access (both existing SELECT policies are
-- untouched), the existing owner-scoped UPDATE/DELETE policies (already
-- correctly scoped to owner = auth.uid(), left alone since not necessary
-- to change), or the avatars bucket in any way.
--
-- Rollback (manual; re-opens the unrestricted-upload gap this closes):
--   drop policy if exists objects_insert_listing_photos_owner on storage.objects;
--   create policy objects_insert_listing_photos_auth_only
--     on storage.objects for insert to authenticated
--     with check (bucket_id = 'listing-photos');

begin;

drop policy if exists objects_insert_listing_photos_auth_only on storage.objects;
drop policy if exists objects_insert_listing_photos_owner on storage.objects;

create policy objects_insert_listing_photos_owner
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

commit;
