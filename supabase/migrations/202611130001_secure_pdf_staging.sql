-- Browser uploads go first to private Supabase Storage. Edge Functions then
-- validate and transfer each PDF to the contest Google Drive. This prevents
-- a browser from having to use Google Drive's server-created upload URLs.

alter table public.workbook_versions
  add column if not exists staging_path text;

alter table public.submissions
  add column if not exists staging_path text;

create unique index if not exists workbook_versions_staging_path_unique
  on public.workbook_versions (staging_path)
  where staging_path is not null;

create unique index if not exists submissions_staging_path_unique
  on public.submissions (staging_path)
  where staging_path is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portal-staging', 'portal-staging', false, 26214400, array['application/pdf']::text[])
on conflict (id) do update
set public = false,
    file_size_limit = 26214400,
    allowed_mime_types = array['application/pdf']::text[];

drop policy if exists "portal users upload their own staging PDFs" on storage.objects;
create policy "portal users upload their own staging PDFs"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'portal-staging'
  and owner_id = (select auth.uid())::text
  and name like ((select auth.uid())::text || '/%')
);
