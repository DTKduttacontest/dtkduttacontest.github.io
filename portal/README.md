# DTK Dutta Contest portal — deployment checklist

This folder is an isolated addition to the existing GitHub Pages site. It does
not replace `index.html`, `contest.html`, `mentors.html`, or `archives.html`.
The four existing menus only gain a link to `/portal/`.

The public page is intentionally in **setup mode** until the three public
values in `portal/portal-config.js` are added:

```js
supabaseUrl: "https://YOUR-PROJECT.supabase.co",
supabaseAnonKey: "YOUR_PUBLIC_ANON_KEY",
functionsUrl: "https://YOUR-PROJECT.supabase.co/functions/v1",
```

The anon key is designed to be public. Never put a Supabase service-role key,
Google OAuth secret or refresh token, Apps Script relay secret, or approval-code
pepper in this repository or in `portal-config.js`.

## One-time server setup

1. Create a Supabase project and run
   `supabase/migrations/202611120001_portal_schema.sql` in its SQL editor.
2. Enable email/password sign-up and require email confirmation. The portal
   uses Supabase's confirmation link: a student opens the link in the email,
   returns to the portal, and the profile is created automatically. A custom
   email template is optional; it must preserve Supabase's confirmation URL.
3. Add `https://dtkduttacontest.github.io/portal/` as an allowed redirect URL.
   For a small pilot, Supabase's default confirmation email works. Configure
   production SMTP before a large launch: its sender, branding, and delivery
   limits need to be suitable for the number of student accounts.
4. Deploy every function under `supabase/functions/`, including shared files:
   `complete-profile`, `list-mentor-approvals`, `approve-mentor`,
   `resend-mentor-approval`, `bootstrap-drive`, `start-submission-upload`,
   `finish-submission-upload`, `start-workbook-upload`,
   `finish-workbook-upload`, `mark-submission-reviewed`, and `get-drive-pdf`.
5. Set these Edge Function secrets. Supabase provides its own URL, anon key,
   and service-role key to functions; verify their names match the code if
   your project uses custom secret names.

   ```text
   SUPABASE_URL
   SUPABASE_ANON_KEY
   SUPABASE_SERVICE_ROLE_KEY
   GOOGLE_CLIENT_ID
   GOOGLE_CLIENT_SECRET
   GOOGLE_REFRESH_TOKEN
   MENTOR_APPROVER_EMAIL=dtkduttacontest@gmail.com
   APPROVAL_CODE_PEPPER=<a long random value>
   GOOGLE_APPS_SCRIPT_MAIL_RELAY_URL=<the deployed Apps Script /exec URL>
   GOOGLE_APPS_SCRIPT_MAIL_RELAY_SECRET=<the same long random value stored in Apps Script>
   ```

6. In Google Cloud, create OAuth credentials and authorize an **offline**
   Google Drive refresh token while signed in as `dtkduttacontest@gmail.com`.
   Use the narrow `drive.file` scope. Store the refresh token only as the
   `GOOGLE_REFRESH_TOKEN` Edge Function secret. The portal uses that account
   to own the private Drive files.
7. Deploy `apps-script/mentor-mail-relay/Code.gs` as a Web app owned by
   `dtkduttacontest@gmail.com`, running as that account and available to
   anyone. Set its `DTK_MAIL_RELAY_SECRET_V2` Script Property to the same
   value as `GOOGLE_APPS_SCRIPT_MAIL_RELAY_SECRET`. The separate mentor-
   approval code is sent only to that contest Gmail through this protected
   relay; ordinary student verification emails are sent through Supabase's
   configured SMTP.

## First use

1. Add the three public Supabase values to `portal/portal-config.js` and
   publish the repository.
2. Create and verify an account using exactly
   `dtkduttacontest@gmail.com`. It becomes the only initial super-admin.
3. On the super-admin dashboard, select **Connect Google Drive folders**.
   This creates (or reuses) two private folders in that Gmail account:

   ```text
   DTK Dutta Contest Workbooks
   DTK Dutta Contest Submissions
   ```

   Their IDs are stored server-side; no folder ID needs to be copied into the
   web page or exposed to students.
4. Upload each blank workbook from its subject workspace. The portal currently
   contains no workbook PDFs, so the super-admin or an approved mentor uploads
   the Physics and History versions when ready.
5. New mentors verify their own email, then remain pending until the signed-in
   super-admin enters the separate eight-digit code delivered to the contest
   Gmail. Students never receive that approval code.

## What the portal protects

- Student PDFs can only be uploaded as PDFs of 25 MB or smaller. The server
  checks the final Drive file's parent folder, size, MIME type, and `%PDF-`
  signature before recording the submission time.
- Student files are placed under:
  `Subject / School / Class / Section / Student name--short-ID`.
- Student submissions remain private. A student can view only their own PDFs;
  active mentors can view all submissions; students see only a subject's
  current workbook.
- Student email addresses stay in Supabase Auth and are not stored in the
  browser-readable profile table. The super-admin sees a mentor applicant's
  email only in the approval screen.

Before going live, test with one student account and one mentor account:
verify sign-up, mentor approval, Drive setup, a PDF upload, a comment, PDF
viewing permissions, and workbook replacement.
