-- Run this once in the Supabase SQL editor.
-- The site posts through /api/contact using the service role key.
-- Visitors cannot read these rows.

create table if not exists public.contact_submissions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  budget text not null,
  services text[] not null default '{}',
  message text not null default '',
  created_at timestamptz not null default now()
);

alter table public.contact_submissions enable row level security;

revoke all on table public.contact_submissions from anon, authenticated;
grant insert, select on table public.contact_submissions to service_role;
