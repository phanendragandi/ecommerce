-- QuickCart — Phase 1 data layer: Row Level Security
--
-- RLS is ENABLED on every table. Summary of intent:
--   profiles      : owner reads/updates own row (role cannot be self-escalated).
--   products      : public reads active rows; sellers CRUD their own rows.
--   addresses     : owner-only ALL.
--   cart_items    : owner-only ALL.
--   orders        : owner reads; sellers read orders containing their products.
--   order_items   : owner reads; sellers read their own product lines.
--   order_events  : owner reads; sellers read events for their product orders.
--   ALL writes to orders/order_items/order_events happen via the SERVICE ROLE
--   on the Express server. There are deliberately NO client insert/update/delete
--   policies on those three tables (service_role bypasses RLS entirely).

-- ---------------------------------------------------------------------------
-- Helper: is the current user a seller?  SECURITY DEFINER so it reads
-- profiles.role without being blocked by (or recursing through) profiles RLS.
-- ---------------------------------------------------------------------------

create or replace function public.is_seller()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'seller'
  );
$$;

revoke all on function public.is_seller() from public;
grant execute on function public.is_seller() to anon, authenticated, service_role;

-- Helper: does the current user own this order?  SECURITY DEFINER so the check
-- bypasses orders RLS (prevents mutual-recursion between orders and order_items
-- policies: "infinite recursion detected in policy").
create or replace function public.is_order_owner(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.orders o
    where o.id = p_order_id and o.user_id = auth.uid()
  );
$$;

revoke all on function public.is_order_owner(uuid) from public;
grant execute on function public.is_order_owner(uuid) to authenticated, service_role;

-- Helper: does the current (seller) user own the product on this line item?
create or replace function public.is_product_seller(p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.products p
    where p.id = p_product_id and p.seller_id = auth.uid()
  );
$$;

revoke all on function public.is_product_seller(uuid) from public;
grant execute on function public.is_product_seller(uuid) to authenticated, service_role;

-- Helper: does this order contain at least one product owned by the current
-- (seller) user?  SECURITY DEFINER so it bypasses order_items/products RLS.
create or replace function public.order_has_seller_product(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    where oi.order_id = p_order_id and p.seller_id = auth.uid()
  );
$$;

revoke all on function public.order_has_seller_product(uuid) from public;
grant execute on function public.order_has_seller_product(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

-- Owner may read own profile.
create policy profiles_select_own on public.profiles
  for select
  using (auth.uid() = id);

-- Owner may update own profile. Role-change protection is enforced by the
-- trigger below (RLS WITH CHECK cannot reference the OLD row).
create policy profiles_update_own on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- No INSERT policy: rows are created by handle_new_user() (SECURITY DEFINER).
-- No DELETE policy: profiles are removed via auth.users cascade.

-- Prevent privilege escalation: a non-service-role caller cannot change role.
-- auth.role() = 'service_role' for server-side (service key) connections.
create or replace function public.prevent_profile_role_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role is distinct from old.role and auth.role() <> 'service_role' then
    raise exception 'role can only be changed by the service role'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.prevent_profile_role_change();

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------

alter table public.products enable row level security;

-- Public (anon + authenticated) may read active products.
create policy products_select_active on public.products
  for select
  using (is_active = true);

-- Sellers may read their own products even when inactive.
create policy products_select_own on public.products
  for select
  to authenticated
  using (seller_id = auth.uid() and public.is_seller());

-- Sellers may create products they own.
create policy products_insert_own on public.products
  for insert
  to authenticated
  with check (seller_id = auth.uid() and public.is_seller());

-- Sellers may update their own products (cannot reassign ownership).
create policy products_update_own on public.products
  for update
  to authenticated
  using (seller_id = auth.uid() and public.is_seller())
  with check (seller_id = auth.uid() and public.is_seller());

-- Sellers may delete their own products.
create policy products_delete_own on public.products
  for delete
  to authenticated
  using (seller_id = auth.uid() and public.is_seller());

-- ---------------------------------------------------------------------------
-- addresses  (owner-only ALL)
-- ---------------------------------------------------------------------------

alter table public.addresses enable row level security;

create policy addresses_all_own on public.addresses
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- cart_items  (owner-only ALL)
-- ---------------------------------------------------------------------------

alter table public.cart_items enable row level security;

create policy cart_items_all_own on public.cart_items
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- orders  (read-only for clients; ALL writes are service-role only)
-- ---------------------------------------------------------------------------

alter table public.orders enable row level security;

-- Owner may read their own orders.
create policy orders_select_own on public.orders
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Sellers may read orders that contain one of their products.
create policy orders_select_seller on public.orders
  for select
  to authenticated
  using (public.is_seller() and public.order_has_seller_product(id));

-- NO insert/update/delete policies. Writes happen only via the service role
-- (service_role bypasses RLS) in the Express checkout/payment path.

-- ---------------------------------------------------------------------------
-- order_items  (read-only for clients; writes are service-role only)
-- ---------------------------------------------------------------------------

alter table public.order_items enable row level security;

-- Owner (buyer) may read line items of their own orders.
create policy order_items_select_own on public.order_items
  for select
  to authenticated
  using (public.is_order_owner(order_id));

-- Sellers may read the line items that reference their own products.
create policy order_items_select_seller on public.order_items
  for select
  to authenticated
  using (public.is_seller() and public.is_product_seller(product_id));

-- NO insert/update/delete policies. Service-role only.

-- ---------------------------------------------------------------------------
-- order_events  (read-only for clients; writes are service-role only)
-- ---------------------------------------------------------------------------

alter table public.order_events enable row level security;

-- Owner (buyer) may read the tracking timeline for their own orders.
create policy order_events_select_own on public.order_events
  for select
  to authenticated
  using (public.is_order_owner(order_id));

-- Sellers may read events for orders that contain their products.
create policy order_events_select_seller on public.order_events
  for select
  to authenticated
  using (public.is_seller() and public.order_has_seller_product(order_id));

-- NO insert/update/delete policies. Service-role only.
