-- 0001_init.sql enabled RLS and added per-row policies, but never granted the
-- underlying table-level privileges. RLS narrows access; it doesn't replace
-- Postgres's default-deny grant model. Without this, every query from a
-- signed-in user fails with "permission denied for table videos/tags",
-- regardless of how correct the RLS policies are.
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.tags to authenticated;
grant select, insert, update, delete on public.videos to authenticated;
