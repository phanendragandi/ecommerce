-- QuickCart — Phase 1 data layer: auth signup trigger
-- Creates a public.profiles row automatically when an auth.users row is inserted.
-- SECURITY DEFINER so it can write to public.profiles regardless of caller;
-- search_path is pinned to '' (fully-qualified names) to avoid hijacking.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name, email, role)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'name', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    new.email,
    'user'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is 'Creates a profiles row on auth signup. Role is always seeded as user; escalation to seller is a privileged (service-role) operation.';

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
