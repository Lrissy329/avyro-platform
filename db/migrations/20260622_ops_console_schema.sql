create extension if not exists pgcrypto;

create or replace function public.touch_guest_verifications_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.staff_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('sales_agent', 'support_agent', 'ops_manager', 'admin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.staff_users enable row level security;

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_staff_user_id uuid references public.staff_users (user_id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_log enable row level security;

create index if not exists audit_log_entity_idx
  on public.audit_log (entity_type, entity_id, created_at desc);

create index if not exists audit_log_actor_idx
  on public.audit_log (actor_staff_user_id, created_at desc);

create table if not exists public.guest_verifications (
  user_id uuid primary key references auth.users (id) on delete cascade,
  work_email text,
  work_email_verified_at timestamptz,
  document_url text,
  document_type text,
  status text not null default 'unverified'
    check (status in ('unverified', 'pending', 'approved', 'rejected')),
  review_notes text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  work_email_token text,
  work_email_token_expires_at timestamptz
);

alter table public.guest_verifications enable row level security;

drop trigger if exists set_guest_verifications_updated_at on public.guest_verifications;

create trigger set_guest_verifications_updated_at
before update on public.guest_verifications
for each row
execute function public.touch_guest_verifications_updated_at();

create unique index if not exists guest_verifications_work_email_token_key
  on public.guest_verifications (work_email_token)
  where work_email_token is not null;

create index if not exists guest_verifications_status_idx
  on public.guest_verifications (status, created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'guest_verifications'
      and policyname = 'guest_verifications_select_own'
  ) then
    create policy guest_verifications_select_own
      on public.guest_verifications
      for select
      to authenticated
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'guest_verifications'
      and policyname = 'guest_verifications_insert_own'
  ) then
    create policy guest_verifications_insert_own
      on public.guest_verifications
      for insert
      to authenticated
      with check (
        auth.uid() = user_id
        and status in ('unverified', 'pending')
        and review_notes is null
        and reviewed_at is null
        and work_email_verified_at is null
        and work_email_token is null
        and work_email_token_expires_at is null
      );
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'guest_verifications'
      and policyname = 'guest_verifications_update_own'
  ) then
    create policy guest_verifications_update_own
      on public.guest_verifications
      for update
      to authenticated
      using (auth.uid() = user_id)
      with check (
        auth.uid() = user_id
        and status in ('unverified', 'pending')
        and review_notes is null
        and reviewed_at is null
        and work_email_verified_at is null
        and work_email_token is null
        and work_email_token_expires_at is null
      );
  end if;
end
$$;

create table if not exists public.booking_notes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  staff_user_id uuid not null references public.staff_users (user_id),
  note text not null,
  created_at timestamptz not null default now()
);

alter table public.booking_notes enable row level security;

create index if not exists booking_notes_booking_idx
  on public.booking_notes (booking_id, created_at desc);

create index if not exists booking_notes_staff_idx
  on public.booking_notes (staff_user_id, created_at desc);

create table if not exists public.cases (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'open'
    check (status in ('open', 'pending', 'resolved', 'closed')),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  assigned_to uuid references public.staff_users (user_id) on delete set null,
  booking_id uuid references public.bookings (id) on delete set null,
  guest_id uuid references auth.users (id) on delete set null,
  host_id uuid references auth.users (id) on delete set null,
  listing_id uuid references public.listings (id) on delete set null,
  subject text,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.cases enable row level security;

create index if not exists cases_status_idx
  on public.cases (status, last_activity_at desc);

create index if not exists cases_priority_idx
  on public.cases (priority, last_activity_at desc);

create index if not exists cases_assigned_to_idx
  on public.cases (assigned_to, last_activity_at desc);

create index if not exists cases_booking_idx
  on public.cases (booking_id);

create index if not exists cases_guest_idx
  on public.cases (guest_id);

create index if not exists cases_host_idx
  on public.cases (host_id);

create index if not exists cases_listing_idx
  on public.cases (listing_id);

create table if not exists public.case_notes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id) on delete cascade,
  staff_user_id uuid not null references public.staff_users (user_id),
  note text not null,
  created_at timestamptz not null default now()
);

alter table public.case_notes enable row level security;

create index if not exists case_notes_case_idx
  on public.case_notes (case_id, created_at desc);

create index if not exists case_notes_staff_idx
  on public.case_notes (staff_user_id, created_at desc);

create table if not exists public.host_leads (
  id uuid primary key default gen_random_uuid(),
  full_name text,
  email text,
  phone text,
  status text not null default 'lead_new'
    check (status in ('lead_new', 'invited', 'claimed', 'live', 'lost')),
  assigned_sales_agent_id uuid references public.staff_users (user_id) on delete set null,
  area_target text,
  commission_plan text,
  converted_host_user_id uuid references auth.users (id) on delete set null,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.host_leads enable row level security;

create index if not exists host_leads_status_idx
  on public.host_leads (status, last_activity_at desc);

create index if not exists host_leads_assignee_idx
  on public.host_leads (assigned_sales_agent_id, last_activity_at desc);

create index if not exists host_leads_area_target_idx
  on public.host_leads (area_target);

create index if not exists host_leads_converted_host_idx
  on public.host_leads (converted_host_user_id);

create table if not exists public.host_invites (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.host_leads (id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  email text,
  created_by uuid references public.staff_users (user_id) on delete set null,
  claimed_by uuid references auth.users (id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.host_invites enable row level security;

create index if not exists host_invites_lead_idx
  on public.host_invites (lead_id, created_at desc);

create index if not exists host_invites_claimed_by_idx
  on public.host_invites (claimed_by);

create table if not exists public.host_lead_notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.host_leads (id) on delete cascade,
  staff_user_id uuid not null references public.staff_users (user_id),
  note text not null,
  created_at timestamptz not null default now()
);

alter table public.host_lead_notes enable row level security;

create index if not exists host_lead_notes_lead_idx
  on public.host_lead_notes (lead_id, created_at desc);

create index if not exists host_lead_notes_staff_idx
  on public.host_lead_notes (staff_user_id, created_at desc);

create table if not exists public.areas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lat double precision not null,
  lng double precision not null,
  radius_km double precision not null default 10
    check (radius_km > 0),
  hosts_needed integer not null default 0
    check (hosts_needed >= 0),
  target_date date
);

alter table public.areas enable row level security;

create unique index if not exists areas_name_key
  on public.areas (name);

create table if not exists public.sales_targets (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references public.areas (id) on delete cascade,
  staff_user_id uuid references public.staff_users (user_id) on delete set null,
  hosts_needed integer not null default 0
    check (hosts_needed >= 0),
  target_date date,
  created_at timestamptz not null default now()
);

alter table public.sales_targets enable row level security;

create index if not exists sales_targets_area_idx
  on public.sales_targets (area_id, target_date);

create index if not exists sales_targets_staff_idx
  on public.sales_targets (staff_user_id, target_date);

alter table public.profiles
  add column if not exists full_name text,
  add column if not exists email text,
  add column if not exists avatar_url text,
  add column if not exists stripe_account_id text,
  add column if not exists stripe_onboarding_status text,
  add column if not exists role_host boolean not null default false,
  add column if not exists verification_level integer not null default 0,
  add column if not exists verification_status text not null default 'unverified',
  add column if not exists referred_by_sales_agent uuid references public.staff_users (user_id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_verification_status_check'
  ) then
    alter table public.profiles
      add constraint profiles_verification_status_check
      check (verification_status in ('unverified', 'pending', 'verified', 'rejected'));
  end if;
end
$$;
