-- BearlessNotes: cloud sync schema (videos + tags), scoped per-user via RLS.
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

create table if not exists public.tags (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  parent_id text references public.tags (id) on delete set null,
  icon text not null,
  color text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.videos (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  url text not null,
  title text not null,
  thumbnail_url text,
  duration_sec integer not null default 0,
  source text not null default 'unknown',
  status text not null,
  tag_ids text[] not null default '{}',
  comment text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tags_user_id_idx on public.tags (user_id);
create index if not exists videos_user_id_idx on public.videos (user_id);

alter table public.tags enable row level security;
alter table public.videos enable row level security;

create policy "tags_select_own" on public.tags for select using (auth.uid() = user_id);
create policy "tags_insert_own" on public.tags for insert with check (auth.uid() = user_id);
create policy "tags_update_own" on public.tags for update using (auth.uid() = user_id);
create policy "tags_delete_own" on public.tags for delete using (auth.uid() = user_id);

create policy "videos_select_own" on public.videos for select using (auth.uid() = user_id);
create policy "videos_insert_own" on public.videos for insert with check (auth.uid() = user_id);
create policy "videos_update_own" on public.videos for update using (auth.uid() = user_id);
create policy "videos_delete_own" on public.videos for delete using (auth.uid() = user_id);

-- Keep updated_at current on every row change (used for future conflict handling).
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists tags_set_updated_at on public.tags;
create trigger tags_set_updated_at before update on public.tags
  for each row execute function public.set_updated_at();

drop trigger if exists videos_set_updated_at on public.videos;
create trigger videos_set_updated_at before update on public.videos
  for each row execute function public.set_updated_at();
