-- DTK Dutta Contest student and mentor portal.
-- All privileged writes occur in Edge Functions using the service role. Browser
-- clients receive only the anon key and remain constrained by the policies below.

create extension if not exists pgcrypto;

do $$ begin
  create type public.portal_role as enum ('student', 'mentor_pending', 'mentor', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.submission_status as enum ('uploading', 'submitted', 'reviewed', 'needs_revision');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.approval_status as enum ('pending', 'approved', 'expired', 'rejected');
exception when duplicate_object then null; end $$;

create table if not exists public.subjects (
  slug text primary key,
  label text not null,
  display_order smallint not null unique,
  created_at timestamptz not null default now(),
  constraint subjects_slug_check check (slug in (
    'history', 'geography', 'biology', 'physics', 'chemistry',
    'computer-science', 'english-literature', 'hindi-literature'
  ))
);

insert into public.subjects (slug, label, display_order) values
  ('history', 'History', 1),
  ('geography', 'Geography', 2),
  ('biology', 'Biology', 3),
  ('physics', 'Physics', 4),
  ('chemistry', 'Chemistry', 5),
  ('computer-science', 'Computer Science', 6),
  ('english-literature', 'English Literature', 7),
  ('hindi-literature', 'Hindi Literature', 8)
on conflict (slug) do update set label = excluded.label, display_order = excluded.display_order;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role public.portal_role not null default 'student',
  school text,
  class_level smallint,
  section char(1),
  drive_folder_slug text unique,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_name_length check (char_length(trim(display_name)) between 2 and 90),
  constraint profile_school_check check (school is null or school in (
    'St. Joseph''s Bhagalpur',
    'Mt. Carmel Bhagalpur',
    'St. Teresa''s Aligunj',
    'St. Teresa''s Bypass',
    'St. Paul''s Bhagalpur',
    'Don Bosco Bhagalpur'
  )),
  constraint profile_class_check check (class_level is null or class_level in (8, 9)),
  constraint profile_section_check check (section is null or section in ('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H')),
  constraint student_profile_details_check check (
    (role = 'student' and school is not null and class_level is not null and section is not null)
    or role <> 'student'
  )
);

create table if not exists public.workbook_versions (
  id uuid primary key default gen_random_uuid(),
  subject_slug text not null references public.subjects(slug) on update cascade,
  version_number integer not null,
  drive_file_id text unique,
  drive_folder_id text,
  original_filename text not null,
  byte_size bigint,
  uploaded_by uuid not null references public.profiles(id),
  uploaded_at timestamptz not null default now(),
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  constraint workbook_version_number_check check (version_number > 0),
  constraint workbook_byte_size_check check (byte_size is null or byte_size between 1 and 26214400)
);
create unique index if not exists one_current_workbook_per_subject
  on public.workbook_versions (subject_slug) where is_current;

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id),
  subject_slug text not null references public.subjects(slug) on update cascade,
  workbook_version_id uuid references public.workbook_versions(id) on delete set null,
  drive_file_id text unique,
  drive_folder_id text,
  drive_path text,
  original_filename text not null,
  byte_size bigint,
  status public.submission_status not null default 'uploading',
  submitted_at timestamptz,
  student_display_name text not null,
  school text not null,
  class_level smallint not null,
  section char(1) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint submission_byte_size_check check (byte_size is null or byte_size between 1 and 26214400),
  constraint submitted_file_required check ((status = 'uploading') or (drive_file_id is not null and submitted_at is not null))
);
create index if not exists submissions_student_subject_created_idx
  on public.submissions (student_id, subject_slug, created_at desc);
create index if not exists submissions_subject_status_idx
  on public.submissions (subject_slug, status, submitted_at desc);

create table if not exists public.submission_comments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles(id),
  author_display_name text not null default '',
  author_role public.portal_role not null default 'student',
  body text not null,
  created_at timestamptz not null default now(),
  constraint comment_body_length check (char_length(trim(body)) between 1 and 2000)
);
create index if not exists submission_comments_submission_created_idx
  on public.submission_comments (submission_id, created_at asc);

create table if not exists public.mentor_approval_requests (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null unique references public.profiles(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  failed_attempts smallint not null default 0,
  status public.approval_status not null default 'pending',
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint approval_attempts_check check (failed_attempts between 0 and 5)
);
create index if not exists mentor_approvals_status_expiry_idx
  on public.mentor_approval_requests (status, expires_at);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.portal_settings (
  setting_key text primary key,
  setting_value text not null,
  updated_at timestamptz not null default now(),
  constraint portal_settings_key_check check (setting_key in ('google_drive_submissions_root_id', 'google_drive_workbooks_root_id'))
);

create schema if not exists private;

create or replace function private.current_portal_role()
returns public.portal_role
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function private.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce((select private.current_portal_role() in ('mentor', 'admin')), false)
$$;

create or replace function private.can_view_submission(target_submission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select private.is_active_staff()
    or exists (select 1 from public.submissions where id = target_submission_id and student_id = auth.uid())
$$;

create or replace function private.can_comment_on_submission(target_submission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select private.is_active_staff()
    or exists (select 1 from public.submissions where id = target_submission_id and student_id = auth.uid())
$$;

create or replace function private.set_comment_author()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  current_profile public.profiles%rowtype;
begin
  select * into current_profile from public.profiles where id = auth.uid();
  if current_profile.id is null then
    raise exception 'A portal profile is required before posting a comment';
  end if;
  new.author_id := current_profile.id;
  new.author_display_name := current_profile.display_name;
  new.author_role := current_profile.role;
  new.body := trim(new.body);
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists set_submission_comment_author on public.submission_comments;
create trigger set_submission_comment_author
before insert on public.submission_comments
for each row execute function private.set_comment_author();

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_profile_updated_at on public.profiles;
create trigger touch_profile_updated_at before update on public.profiles
for each row execute function private.touch_updated_at();

drop trigger if exists touch_submission_updated_at on public.submissions;
create trigger touch_submission_updated_at before update on public.submissions
for each row execute function private.touch_updated_at();

-- Publishing is one transaction. Without this function, two mentors finishing
-- uploads at almost the same time could briefly leave a subject with no
-- current workbook or overwrite each other's version unpredictably.
create or replace function public.publish_workbook_version(
  target_workbook_id uuid,
  actor_profile_id uuid
)
returns public.workbook_versions
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  target public.workbook_versions%rowtype;
begin
  select * into target
  from public.workbook_versions
  where id = target_workbook_id
  for update;
  if target.id is null then
    raise exception 'Workbook upload was not found';
  end if;
  if target.uploaded_by <> actor_profile_id then
    raise exception 'Only the mentor who started this workbook upload may publish it';
  end if;
  if target.is_current then
    raise exception 'This workbook is already current';
  end if;
  perform pg_advisory_xact_lock(hashtext('dtk-workbook:' || target.subject_slug));
  update public.workbook_versions
  set is_current = false
  where subject_slug = target.subject_slug and is_current = true;
  update public.workbook_versions
  set is_current = true, uploaded_at = now()
  where id = target_workbook_id
  returning * into target;
  return target;
end;
$$;

revoke all on schema private from public;
grant usage on schema private to authenticated;
grant execute on function private.current_portal_role() to authenticated;
grant execute on function private.is_active_staff() to authenticated;
grant execute on function private.can_view_submission(uuid) to authenticated;
grant execute on function private.can_comment_on_submission(uuid) to authenticated;
revoke all on function public.publish_workbook_version(uuid, uuid) from public;
grant execute on function public.publish_workbook_version(uuid, uuid) to service_role;

alter table public.subjects enable row level security;
alter table public.profiles enable row level security;
alter table public.workbook_versions enable row level security;
alter table public.submissions enable row level security;
alter table public.submission_comments enable row level security;
alter table public.mentor_approval_requests enable row level security;
alter table public.audit_events enable row level security;
alter table public.portal_settings enable row level security;

create policy "authenticated users can read subjects"
on public.subjects for select to authenticated using (true);

create policy "users can read their own profile and staff can read profiles"
on public.profiles for select to authenticated
using (id = auth.uid() or private.is_active_staff());

create policy "students read current workbooks and staff read all workbook versions"
on public.workbook_versions for select to authenticated
using (
  (select private.current_portal_role()) in ('student', 'mentor', 'admin')
  and (is_current or private.is_active_staff())
);

create policy "students read their submissions and staff read all submissions"
on public.submissions for select to authenticated
using (student_id = auth.uid() or private.is_active_staff());

create policy "users read comments on accessible submissions"
on public.submission_comments for select to authenticated
using (private.can_view_submission(submission_id));

create policy "users comment only on accessible submissions"
on public.submission_comments for insert to authenticated
with check (private.can_comment_on_submission(submission_id));

-- There are intentionally no client insert/update/delete policies for profiles,
-- submissions, workbooks, approval requests, audit events, or portal settings. Edge Functions
-- with server-side validation perform those operations.
