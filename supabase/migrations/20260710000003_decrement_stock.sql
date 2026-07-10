-- QuickCart — Phase 1 data layer: atomic stock decrement RPC
--
-- Failure semantics (CHOSEN): decrement_stock RAISES an exception on
-- insufficient stock (SQLSTATE 'P0001'), it does NOT return false. Callers
-- (Express payment-capture path) must treat the raised error as "out of stock"
-- and fail the capture / trigger a refund. The function returns the new stock
-- level on success.
--
-- Concurrency: correctness relies on the single UPDATE ... WHERE stock >= p_qty.
-- The row is locked for the duration of the UPDATE, so two concurrent calls
-- cannot both pass the guard. NEVER read-then-write stock from JS.

create or replace function public.decrement_stock(p_product_id uuid, p_quantity int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_stock int;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'decrement_stock: quantity must be a positive integer (got %)', p_quantity
      using errcode = 'P0001';
  end if;

  update public.products
     set stock = stock - p_quantity
   where id = p_product_id
     and stock >= p_quantity
  returning stock into v_new_stock;

  if not found then
    raise exception 'decrement_stock: insufficient stock for product % (requested %)', p_product_id, p_quantity
      using errcode = 'P0001';
  end if;

  return v_new_stock;
end;
$$;

comment on function public.decrement_stock(uuid, int) is 'Atomically decrements product stock. Raises P0001 on insufficient stock. Service-role only.';

-- Privileged operation: only the service role may call this. Clients must go
-- through the Express server (payment-capture path).
revoke all on function public.decrement_stock(uuid, int) from public;
revoke execute on function public.decrement_stock(uuid, int) from anon, authenticated;
grant  execute on function public.decrement_stock(uuid, int) to service_role;
