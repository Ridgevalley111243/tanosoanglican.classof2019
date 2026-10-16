-- Class of 2019 (Tanoso Anglican J.H.S "A") — monthly dues system
-- Migration 1: types and tables.
--
-- Group rules encoded here (confirmed 16 Oct 2026):
--   * Dues are GH₵20 a month; month M is due on the 5th of month M+1.
--   * No partial payments. One payment may cover several whole months.
--   * A payment is approved by two different admins and rejected by two
--     different admins. One admin may send it back for correction.
--   * Expenses need two approvals from admins other than the one who recorded it.
--   * Admins are ordinary members too; nobody reviews their own payment.
--   * Members are identified by a member code issued by an admin.
--   * Members who join late owe every month since the group's dues start.

create extension if not exists pgcrypto with schema extensions;

create type public.account_status as enum ('pending', 'active', 'suspended');
create type public.momo_network   as enum ('mtn', 'telecel', 'airteltigo');
create type public.payment_status as enum ('pending', 'correction_requested', 'approved', 'rejected');
create type public.review_decision as enum ('approve', 'reject', 'request_correction');
create type public.expense_status as enum ('pending', 'approved', 'rejected');

-- One row per Supabase Auth user. Created by trigger on sign-up.
create table public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  full_name      text not null check (length(trim(full_name)) between 2 and 120),
  email          text,
  is_admin       boolean not null default false,
  account_status public.account_status not null default 'pending',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- The class roster. Admins add people here and hand each one their code.
-- A member claims their row by entering the code when they register.
create table public.members (
  id          uuid primary key default gen_random_uuid(),
  member_code text not null unique check (member_code ~ '^C19-[A-HJ-NP-Z2-9]{5}$'),
  full_name   text not null check (length(trim(full_name)) between 2 and 120),
  phone       text check (phone is null or phone ~ '^0[0-9]{9}$'),
  profile_id  uuid unique references public.profiles(id) on delete set null,
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.group_settings (
  id                 smallint primary key default 1 check (id = 1),
  group_name         text not null default 'Class of 2019 · Tanoso Anglican J.H.S "A"',
  monthly_dues       numeric(12,2) not null default 20.00 check (monthly_dues > 0),
  -- Dues for month M fall due on this day of month M+1.
  due_day            smallint not null default 5 check (due_day between 1 and 28),
  -- First month anyone owes. Late joiners owe from here too.
  dues_start         date not null default date '2026-10-01'
                     check (extract(day from dues_start) = 1),
  momo_instructions  text,
  show_balance_to_members boolean not null default true,
  updated_by         uuid references public.profiles(id),
  updated_at         timestamptz not null default now()
);
insert into public.group_settings (id) values (1);

-- One obligation per member per month. amount_due is copied from the setting
-- at creation, so changing the setting never rewrites history.
create table public.dues_months (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id) on delete restrict,
  period      date not null check (extract(day from period) = 1),
  amount_due  numeric(12,2) not null check (amount_due > 0),
  paid_at     timestamptz,
  payment_id  uuid,
  created_at  timestamptz not null default now(),
  unique (member_id, period)
);

create table public.payments (
  id               uuid primary key default gen_random_uuid(),
  member_id        uuid not null references public.members(id) on delete restrict,
  network          public.momo_network not null,
  transaction_id   text not null check (length(trim(transaction_id)) between 4 and 60),
  sender_number    text check (sender_number is null or sender_number ~ '^0[0-9]{9}$'),
  amount           numeric(12,2) not null check (amount > 0),
  paid_on          date not null,
  paid_time        time not null,
  status           public.payment_status not null default 'pending',
  review_round     smallint not null default 1,
  status_note      text,
  submitted_by     uuid not null references public.profiles(id),
  submitted_at     timestamptz not null default now(),
  decided_at       timestamptz,
  updated_at       timestamptz not null default now()
);
create unique index payments_network_txn_uq
  on public.payments (network, upper(trim(transaction_id)));
create index payments_member_idx on public.payments (member_id, submitted_at desc);
create index payments_status_idx on public.payments (status, submitted_at);

alter table public.dues_months
  add constraint dues_months_payment_fk foreign key (payment_id)
  references public.payments(id) on delete restrict;

-- Which months a payment claims. Written at submission; only takes effect on approval.
create table public.payment_allocations (
  payment_id    uuid not null references public.payments(id) on delete cascade,
  dues_month_id uuid not null references public.dues_months(id) on delete restrict,
  amount        numeric(12,2) not null check (amount > 0),
  primary key (payment_id, dues_month_id)
);
create index payment_allocations_month_idx on public.payment_allocations (dues_month_id);

create table public.payment_reviews (
  id          bigint generated always as identity primary key,
  payment_id  uuid not null references public.payments(id) on delete restrict,
  round       smallint not null,
  reviewer_id uuid not null references public.profiles(id) on delete restrict,
  decision    public.review_decision not null,
  note        text check (note is null or length(note) <= 500),
  created_at  timestamptz not null default now(),
  unique (payment_id, round, reviewer_id)
);

create table public.expenses (
  id           uuid primary key default gen_random_uuid(),
  description  text not null check (length(trim(description)) between 2 and 300),
  category     text not null check (length(trim(category)) between 2 and 40),
  amount       numeric(12,2) not null check (amount > 0),
  spent_on     date not null,
  reference    text check (reference is null or length(reference) <= 120),
  recorded_by  uuid not null references public.profiles(id),
  status       public.expense_status not null default 'pending',
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index expenses_status_idx on public.expenses (status, spent_on);

create table public.expense_reviews (
  id          bigint generated always as identity primary key,
  expense_id  uuid not null references public.expenses(id) on delete restrict,
  reviewer_id uuid not null references public.profiles(id) on delete restrict,
  decision    public.review_decision not null check (decision <> 'request_correction'),
  note        text check (note is null or length(note) <= 500),
  created_at  timestamptz not null default now(),
  unique (expense_id, reviewer_id)
);

create sequence public.receipt_seq;
create table public.receipts (
  id             uuid primary key default gen_random_uuid(),
  receipt_number text not null unique,
  payment_id     uuid not null unique references public.payments(id) on delete restrict,
  issued_at      timestamptz not null default now()
);

create table public.notifications (
  id           bigint generated always as identity primary key,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  kind         text not null,
  title        text not null,
  body         text not null,
  payment_id   uuid references public.payments(id) on delete set null,
  -- Stops the reminder job from sending the same notice twice.
  dedupe_key   text,
  read_at      timestamptz,
  created_at   timestamptz not null default now(),
  unique (profile_id, dedupe_key)
);
create index notifications_profile_idx on public.notifications (profile_id, created_at desc);

create table public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles(id) on delete set null,
  action      text not null,
  target_table text not null,
  target_id   text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
