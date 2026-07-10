-- QuickCart — Phase 1 data layer: Storage bucket + policies
-- Bucket `product-images` (public read). Product images are uploaded by the
-- Express server (Add Product endpoint) and their public URLs are stored in
-- products.images. RLS on storage.objects is already enabled by Supabase.
--
-- PATH CONTRACT (Phase 2 MUST honor this): every object is stored under the
-- path `<seller_id>/<filename>`, i.e. the first path segment is the uploading
-- seller's auth uid. The write policies below enforce owner-per-path so a
-- seller can only insert/update/delete objects inside their own `<seller_id>/`
-- folder — a seller can never overwrite or delete another seller's objects.
-- The Express upload endpoint MUST write to `<seller_id>/<filename>`.

-- Create the public bucket (idempotent).
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = excluded.public;

-- Public read of objects in this bucket.
drop policy if exists product_images_public_read on storage.objects;
create policy product_images_public_read on storage.objects
  for select
  using (bucket_id = 'product-images');

-- Only authenticated sellers may upload, and only into their own <seller_id>/ folder.
drop policy if exists product_images_seller_insert on storage.objects;
create policy product_images_seller_insert on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'product-images'
    and public.is_seller()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Only authenticated sellers may replace/update objects in their own folder.
drop policy if exists product_images_seller_update on storage.objects;
create policy product_images_seller_update on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'product-images'
    and public.is_seller()
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'product-images'
    and public.is_seller()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Only authenticated sellers may delete objects in their own folder.
drop policy if exists product_images_seller_delete on storage.objects;
create policy product_images_seller_delete on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'product-images'
    and public.is_seller()
    and (storage.foldername(name))[1] = auth.uid()::text
  );
