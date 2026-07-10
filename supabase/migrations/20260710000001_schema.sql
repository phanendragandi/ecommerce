-- QuickCart — Phase 1 data layer: schema
-- Source of truth: /CLAUDE.md (Database schema section).
-- Fresh project: tables use plain CREATE TABLE (no IF NOT EXISTS).
-- Money columns are numeric(10,2). Timestamps are timestamptz default now().
-- RLS is ENABLED per-table in the RLS migration (20260710000004_rls_policies.sql).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type order_status as enum (
  'pending',
  'paid',
  'processing',
  'shipped',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'refunded'
);

-- ---------------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles  (1:1 with auth.users; rows are created by handle_new_user trigger)
-- ---------------------------------------------------------------------------

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text,
  email      text,
  role       text not null default 'user' check (role in ('user', 'seller')),
  created_at timestamptz not null default now()
);

comment on table public.profiles is 'One row per auth user. Created by handle_new_user() trigger; role is escalated only via service role.';

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------

create table public.products (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid not null references public.profiles (id) on delete cascade,
  name        text not null,
  description text,
  category    text,
  price       numeric(10, 2) not null,
  offer_price numeric(10, 2),
  images      text[] not null default '{}',
  stock       integer not null default 0 check (stock >= 0),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- addresses
-- ---------------------------------------------------------------------------

create table public.addresses (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  full_name  text not null,
  phone      text not null,
  pincode    text not null,
  area       text not null,
  city       text not null,
  state      text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- cart_items  (one row per (user, product))
-- ---------------------------------------------------------------------------

create table public.cart_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  quantity   integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  unique (user_id, product_id)
);

-- ---------------------------------------------------------------------------
-- orders  (all writes are service-role only — see RLS migration)
-- ---------------------------------------------------------------------------

create table public.orders (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id) on delete cascade,
  address_id         uuid references public.addresses (id) on delete set null,
  amount             numeric(10, 2) not null,
  currency           text not null default 'INR',
  status             order_status not null default 'pending',
  payment_status     text not null default 'pending'
                       check (payment_status in ('pending', 'paid', 'failed', 'refunded')),
  razorpay_order_id  text,
  razorpay_payment_id text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- order_items  (price_at_purchase is a snapshot — never join live price)
-- ---------------------------------------------------------------------------

create table public.order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders (id) on delete cascade,
  product_id       uuid not null references public.products (id) on delete restrict,
  quantity         integer not null check (quantity > 0),
  price_at_purchase numeric(10, 2) not null
);

-- ---------------------------------------------------------------------------
-- order_events  (order-tracking timeline; one row per status change)
-- ---------------------------------------------------------------------------

create table public.order_events (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders (id) on delete cascade,
  status     order_status not null,
  note       text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes: every FK used in list queries + products(category) + orders(status)
-- ---------------------------------------------------------------------------

create index idx_products_category  on public.products (category);
create index idx_products_seller_id on public.products (seller_id);
create index idx_addresses_user_id  on public.addresses (user_id);
create index idx_cart_items_user_id on public.cart_items (user_id);
create index idx_orders_user_id     on public.orders (user_id);
create index idx_orders_status      on public.orders (status);
create index idx_order_items_order_id   on public.order_items (order_id);
create index idx_order_items_product_id on public.order_items (product_id);
create index idx_order_events_order_id  on public.order_events (order_id);

-- Razorpay order id is unique when present (one Razorpay order per orders row).
create unique index uq_orders_razorpay_order_id
  on public.orders (razorpay_order_id)
  where razorpay_order_id is not null;

-- Idempotency lookup for webhook/capture reconciliation. Partial unique so a
-- captured payment id can never be applied to two orders rows.
create unique index uq_orders_razorpay_payment_id
  on public.orders (razorpay_payment_id)
  where razorpay_payment_id is not null;
