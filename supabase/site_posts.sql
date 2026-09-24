-- Blog posts written in the CRM and shown on the public blog and post pages.
-- Run once in the Supabase SQL editor (same project as contact_submissions).

create table if not exists public.site_posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  excerpt text not null default '',
  body text not null default '',
  cover_image_url text not null default '',
  second_image_url text not null default '',
  read_minutes integer not null default 1,
  published boolean not null default true,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.site_posts enable row level security;

revoke all on table public.site_posts from anon, authenticated;
grant select, insert, update, delete on table public.site_posts to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-posts',
  'site-posts',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Public read site post images'
  ) then
    create policy "Public read site post images"
    on storage.objects
    for select
    to public
    using (bucket_id = 'site-posts');
  end if;
end $$;
