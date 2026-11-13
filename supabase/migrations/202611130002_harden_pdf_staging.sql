-- Tighten the already-created staging bucket. A browser may upload only to a
-- server-created, short-lived path belonging to its own active upload record.

create or replace function private.can_stage_portal_pdf(candidate_path text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.submissions
    where student_id = auth.uid()
      and status = 'uploading'
      and drive_file_id is null
      and staging_path = candidate_path
      and created_at > now() - interval '2 hours'
  ) or exists (
    select 1
    from public.workbook_versions
    where uploaded_by = auth.uid()
      and is_current = false
      and drive_file_id is null
      and staging_path = candidate_path
      and created_at > now() - interval '2 hours'
  );
$$;

revoke all on function private.can_stage_portal_pdf(text) from public;
grant execute on function private.can_stage_portal_pdf(text) to authenticated;

drop policy if exists "portal users upload their own staging PDFs" on storage.objects;
create policy "portal users upload their own staging PDFs"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'portal-staging'
  and owner_id = (select auth.uid())::text
  and name like ((select auth.uid())::text || '/%')
  and (select private.can_stage_portal_pdf(name))
);
