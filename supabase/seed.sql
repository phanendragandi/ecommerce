-- QuickCart — seed data (NOT a migration).
--
-- HOW TO RUN
-- ----------
-- This file follows Supabase's local seeding convention: it is executed
-- automatically after migrations when you run:
--
--     npx supabase db reset          # local: applies migrations + runs seed.sql
--
-- It is idempotent, so you may also run it by hand against any database where
-- the migrations have been applied, e.g.:
--
--     psql "$DATABASE_URL" -f supabase/seed.sql
--
-- WHAT IT DOES
-- ------------
-- Normally you cannot INSERT into auth.users from application SQL. In the LOCAL
-- Supabase stack the seed runs as the postgres superuser, so we seed a demo
-- seller directly into auth.users using a fixed, well-known UUID. The
-- handle_new_user() trigger then creates its profiles row; we promote that
-- profile to role='seller' (a service-role/privileged action) and load the
-- catalog from assets/assets.js. Product images use the original
-- raw.githubusercontent.com URLs from assets.js.
--
-- If you would rather attach the catalog to an EXISTING auth user instead of
-- creating the demo one, skip the auth.users insert below and replace the
-- fixed UUID '00000000-0000-4000-a000-000000000001' with that user's id.

begin;

-- Demo seller identity (fixed so the seed stays idempotent).
-- 00000000-0000-4000-a000-000000000001  → demo seller
-- pgcrypto (for crypt()) ships with Supabase; ensure it is available.
create extension if not exists pgcrypto;

insert into auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-a000-000000000001',
  'authenticated', 'authenticated', 'demo-seller@quickcart.test',
  crypt('demo-seller-password', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"name":"QuickCart Demo Seller"}'::jsonb,
  now(), now()
)
on conflict (id) do nothing;

-- Ensure the profile exists (in case the trigger was not present at insert time)
-- and promote it to seller.
insert into public.profiles (id, name, email, role)
values (
  '00000000-0000-4000-a000-000000000001',
  'QuickCart Demo Seller',
  'demo-seller@quickcart.test',
  'seller'
)
on conflict (id) do update set role = 'seller';

-- Reload the catalog idempotently: clear this seller's products, then insert.
delete from public.products
  where seller_id = '00000000-0000-4000-a000-000000000001';

insert into public.products
  (seller_id, name, description, category, price, offer_price, images, stock, is_active)
values
  ('00000000-0000-4000-a000-000000000001',
   'Apple AirPods Pro 2nd gen',
   'Apple AirPods Pro (2nd Gen) with MagSafe Case (USB-C) provide excellent sound, active noise cancellation, and a comfortable fit. The USB-C case ensures quick charging, and they pair seamlessly with Apple devices for an effortless audio experience.',
   'Earphone', 499.99, 399.99,
   array[
     'https://raw.githubusercontent.com/avinashdm/gs-images/main/quickcart/k4dafzhwhgcn5tnoylrw.webp',
     'https://raw.githubusercontent.com/avinashdm/gs-images/main/quickcart/j212frakb8hdrhvhajhg.webp',
     'https://raw.githubusercontent.com/avinashdm/gs-images/main/quickcart/imwuugqxsajuwqpkegb5.webp',
     'https://raw.githubusercontent.com/avinashdm/gs-images/main/quickcart/k1oqaslw5tb3ebw01vvj.webp'
   ], 50, true),

  ('00000000-0000-4000-a000-000000000001',
   'Bose QuietComfort 45',
   'The Bose QuietComfort 45 headphones are engineered for exceptional sound quality and unparalleled noise cancellation. With a 24-hour battery life and comfortable, lightweight design, these headphones deliver premium audio for any environment. Whether on a flight, in the office, or at home, the Bose QC45 blocks out distractions, offering an immersive listening experience.',
   'Headphone', 429.99, 329.99,
   array['https://raw.githubusercontent.com/avinashdm/gs-images/main/quickcart/m16coelz8ivkk9f0nwrz.webp'],
   50, true),

  ('00000000-0000-4000-a000-000000000001',
   'Samsung Galaxy S23',
   'The Samsung Galaxy S23 offers an all-encompassing mobile experience with its advanced AMOLED display, offering vibrant visuals and smooth interactions. Equipped with top-of-the-line fitness tracking features and cutting-edge technology, this phone delivers outstanding performance. With powerful hardware, a sleek design, and long battery life, the S23 is perfect for those who demand the best in mobile innovation.',
   'Smartphone', 899.99, 799.99,
   array['https://raw.githubusercontent.com/avinashdm/gs-images/main/quickcart/xjd4eprpwqs7odbera1w.webp'],
   50, true),

  ('00000000-0000-4000-a000-000000000001',
   'Garmin Venu 2',
   'The Garmin Venu 2 smartwatch blends advanced fitness tracking with sophisticated design, offering a wealth of features such as heart rate monitoring, GPS, and sleep tracking. Built with a 24-hour battery life, this watch is ideal for fitness enthusiasts and anyone looking to enhance their daily lifestyle. With a stunning AMOLED display and customizable watch faces, the Venu 2 combines technology with style seamlessly.',
   'Earphone', 399.99, 349.99,
   array['https://raw.githubusercontent.com/avinashdm/gs-images/main/quickcart/hdfi4u3fmprazpnrnaga.webp'],
   50, true),

  ('00000000-0000-4000-a000-000000000001',
   'PlayStation 5',
   'The PlayStation 5 takes gaming to the next level with ultra-HD graphics, a powerful 825GB SSD, and ray tracing technology for realistic visuals. Whether you''re into high-action games or immersive storytelling, the PS5 delivers fast loading times, seamless gameplay, and stunning visuals. It''s a must-have for any serious gamer looking for the ultimate gaming experience.',
   'Accessories', 599.99, 499.99,
   array['https://raw.githubusercontent.com/avinashdm/gs-images/main/quickcart/dd3l13vfoartrgbvkkh5.webp'],
   50, true),

  ('00000000-0000-4000-a000-000000000001',
   'Canon EOS R5',
   'The Canon EOS R5 is a game-changing mirrorless camera with a 45MP full-frame sensor, offering ultra-high resolution and the ability to shoot 8K video. Whether you''re capturing professional-quality stills or cinematic video footage, this camera delivers exceptional clarity, speed, and color accuracy. With advanced autofocus and in-body stabilization, the R5 is ideal for photographers and videographers alike.',
   'Camera', 4199.99, 3899.99,
   array['https://raw.githubusercontent.com/avinashdm/gs-images/main/quickcart/r5h370zuujvrw461c6wy.webp'],
   50, true),

  ('00000000-0000-4000-a000-000000000001',
   'MacBook Pro 16',
   'The MacBook Pro 16, powered by Apple''s M2 Pro chip, offers outstanding performance with 16GB RAM and a 512GB SSD. Whether you''re editing high-resolution video, developing software, or multitasking with ease, this laptop can handle the toughest tasks. It features a stunning Retina display with True Tone technology, making it a top choice for professionals in creative industries or anyone who demands premium performance in a portable form.',
   'Laptop', 2799.99, 2499.99,
   array['https://raw.githubusercontent.com/avinashdm/gs-images/main/quickcart/rzri7kytphxalrm9rubd.webp'],
   50, true),

  ('00000000-0000-4000-a000-000000000001',
   'Sony WF-1000XM5',
   'Sony WF-1000XM5 true wireless earbuds deliver immersive sound with Hi-Res Audio and advanced noise cancellation technology. Designed for comfort and quality, they provide a stable, snug fit for a secure listening experience. Whether you''re working out or traveling, these earbuds will keep you connected with the world around you while enjoying rich, clear sound.',
   'Earphone', 349.99, 299.99,
   array['https://raw.githubusercontent.com/avinashdm/gs-images/main/quickcart/e3zjaupyumdkladmytke.webp'],
   50, true),

  ('00000000-0000-4000-a000-000000000001',
   'Samsung Projector 4k',
   'The Samsung 4K Projector offers an immersive cinematic experience with ultra-high-definition visuals and realistic color accuracy. Equipped with a built-in speaker, it delivers rich sound quality to complement its stunning 4K resolution. Perfect for movie nights, gaming, or presentations, this projector is the ultimate choice for creating an at-home theater experience or professional setting.',
   'Accessories', 1699.99, 1499.99,
   array['https://raw.githubusercontent.com/avinashdm/gs-images/main/quickcart/qqdcly8a8vkyciy9g0bw.webp'],
   50, true),

  ('00000000-0000-4000-a000-000000000001',
   'ASUS ROG Zephyrus G16',
   'The ASUS ROG Zephyrus G16 gaming laptop is powered by the Intel Core i9 processor and features an RTX 4070 GPU, delivering top-tier gaming and performance. With 16GB of RAM and a 1TB SSD, this laptop is designed for gamers who demand extreme power, speed, and storage. Equipped with a stunning 16-inch display, it''s built to handle the most demanding titles and applications with ease.',
   'Laptop', 2199.99, 1999.99,
   array['https://raw.githubusercontent.com/avinashdm/gs-images/main/quickcart/wig1urqgnkeyp4t2rtso.webp'],
   50, true);

commit;
