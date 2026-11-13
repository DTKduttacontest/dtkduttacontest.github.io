# DTK mentor mail relay

This is a deliberately narrow Google Apps Script mail relay for the contest's
mentor-approval code. It needs no custom domain or third-party email account.
It runs as `dtkduttacontest@gmail.com` and sends only to that address.

## Deployment

1. Create a stand-alone Apps Script project while signed in as
   `dtkduttacontest@gmail.com`, and replace the starter code with
   `Code.gs`.
2. In **Project Settings → Script properties**, create
   `DTK_MAIL_RELAY_SECRET_V2` with a newly generated long random value.
   Never place that value in this repository or share it with a browser
   client.
3. Deploy it as a **Web app**. It must run as the contest Gmail and allow
   anyone to access it; the signed-request verification in `Code.gs` keeps
   the public endpoint safe. Copy the deployed `/exec` URL, not the editable
   `/dev` URL.
4. Set these Supabase Edge Function secrets to exactly the corresponding
   values:

   ```text
   GOOGLE_APPS_SCRIPT_MAIL_RELAY_URL=<the deployed /exec URL>
   GOOGLE_APPS_SCRIPT_MAIL_RELAY_SECRET=<the same long random value>
   ```

5. Deploy the mentor functions that share this mail helper:
   `complete-profile`, `resend-mentor-approval`, and
   `list-mentor-approvals`.
6. Test with a mentor applicant. The contest Gmail should receive one
   eight-digit approval code. A failed delivery leaves the verified applicant
   visible in the super-admin approval screen; it does not delete the request.

## Security boundaries

- The browser never sees the relay URL or secret.
- Supabase signs each request with HMAC-SHA-256, a timestamp, and a random
  nonce. The script rejects stale, altered, and replayed requests.
- The recipient is hard-coded to the contest Gmail; no request can choose a
  different recipient.
- The relay is only for mentor approvals. Do not use it for bulk mail.
