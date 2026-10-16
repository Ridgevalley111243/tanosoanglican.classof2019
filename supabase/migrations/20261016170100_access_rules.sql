-- Migration 2: helper functions and row level security.
--
-- The browser only ever reads tables. Every write goes through a function in
-- migration 3, which checks who is calling. Helpers live in the `private`
-- schema so they can't be called through the API as RPCs.

create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.today()
returns date language sql stable set search_path = ''
as $$ select (now() at time zone 'Africa/Accra')::date $$;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.is_admin
      and p.account_status = 'active'
  )
$$;

-- The roster row of the signed-in member, if their account and roster entry are active.
create or replace function private.my_member_id()
returns uuid language sql stable security definer set search_path = ''
as $$
  select m.id
  from public.members m
  join public.profiles p on p.id = m.profile_id
  where p.id = (select auth.uid())
    and p.account_status = 'active'
    and m.is_active
$$;

create or replace function private.is_active_user()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.account_status = 'active'
  )
$$;

revoke all on function private.today(), private.is_admin(), private.my_member_id(),
  private.is_active_user() from public, anon;
grant execute on function private.today(), private.is_admin(), private.my_member_id(),
  private.is_active_user() to authenticated;

-- Row level security on every table.
alter table public.profiles            enable row level security;
alter table public.members             enable row level security;
alter table public.group_settings      enable row level security;
alter table public.dues_months         enable row level security;
alter table public.payments            enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.payment_reviews     enable row level security;
alter table public.expenses            enable row level security;
alter table public.expense_reviews     enable row level security;
alter table public.receipts            enable row level security;
alter table public.notifications       enable row level security;
alter table public.audit_logs          enable row level security;

-- Read access only. There are deliberately no insert/update/delete policies.
create policy "own profile or admin" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()));

create policy "own roster entry or admin" on public.members
  for select to authenticated
  using (profile_id = (select auth.uid()) or (select private.is_admin()));

create policy "signed-in users read settings" on public.group_settings
  for select to authenticated using (true);

create policy "own dues or admin" on public.dues_months
  for select to authenticated
  using (member_id = (select private.my_member_id()) or (select private.is_admin()));

create policy "own payments or admin" on public.payments
  for select to authenticated
  using (member_id = (select private.my_member_id()) or (select private.is_admin()));

create policy "allocations of own payments or admin" on public.payment_allocations
  for select to authenticated
  using (
    (select private.is_admin())
    or exists (select 1 from public.payments p
               where p.id = payment_id and p.member_id = (select private.my_member_id()))
  );

create policy "admins read payment reviews" on public.payment_reviews
  for select to authenticated using ((select private.is_admin()));

create policy "admins read expenses" on public.expenses
  for select to authenticated using ((select private.is_admin()));

create policy "admins read expense reviews" on public.expense_reviews
  for select to authenticated using ((select private.is_admin()));

create policy "own receipts or admin" on public.receipts
  for select to authenticated
  using (
    (select private.is_admin())
    or exists (select 1 from public.payments p
               where p.id = payment_id and p.member_id = (select private.my_member_id()))
  );

create policy "own notifications" on public.notifications
  for select to authenticated using (profile_id = (select auth.uid()));

create policy "admins read audit log" on public.audit_logs
  for select to authenticated using ((select private.is_admin()));

-- Table privileges: nobody writes directly, signed-in users may only select
-- (RLS then filters rows). Anonymous visitors get nothing.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;
