-- QuickCart — Phase 1 data layer: Storage bucket + policies
-- Bucket `product-images` (public read). Product images are uploaded by the
-- Express server (Add Product endpoint) and their public URLs are stored in
-- products.images. RLS on storage.objects is already enabled by Supabase.

-- Create the public bucket (idempotent).
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = excluded.public;

-- Public read of objects in this bucket.
drop policy if exists product_images_public_read on storage.objects;
create policy product_images_public_read on storage.objects
  for select
  using (bucket_id = 'product-images');

-- Only authenticated sellers may upload.
drop policy if exists product_images_seller_insert on storage.objects;
create policy product_images_seller_insert on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'product-images' and public.is_seller());

-- Only authenticated sellers may replace/update.
drop policy if exists product_images_seller_update on storage.objects;
create policy product_images_seller_update on storage.objects
  for update
  to authenticated
  using (bucket_id = 'product-images' and public.is_seller())
  with check (bucket_id = 'product-images' and public.is_seller());

-- Only authenticated sellers may delete.
drop policy if exists product_images_seller_delete on storage.objects;
create policy product_images_seller_delete on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'product-images' and public.is_seller());
