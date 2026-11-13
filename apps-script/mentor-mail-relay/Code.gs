/**
 * DTK Dutta Contest mentor-approval mail relay.
 *
 * This file belongs in a stand-alone Google Apps Script project owned by
 * dtkduttacontest@gmail.com. It is deliberately narrow: it can mail an
 * approval code only to that same contest inbox. Requests are short-lived,
 * HMAC signed, and protected against replay.
 */

const CONTEST_EMAIL = 'dtkduttacontest@gmail.com';
const RELAY_SECRET_PROPERTY = 'DTK_MAIL_RELAY_SECRET_V2';
const NONCE_PREFIX = 'dtk_mail_relay_nonce_';
const MAX_AGE_SECONDS = 5 * 60;

function doGet() {
  return jsonResponse({ ok: true, service: 'dtk-mentor-mail-relay' });
}

function doPost(event) {
  try {
    const payload = parsePayload(event);
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - payload.timestamp) > MAX_AGE_SECONDS) {
      throw new Error('This request has expired.');
    }

    const secret = PropertiesService.getScriptProperties().getProperty(RELAY_SECRET_PROPERTY);
    if (!secret) throw new Error('Mail relay is not configured.');
    const expected = hmacHex(secret, canonicalRequest(payload));
    if (!timingSafeEqual(expected, payload.signature)) throw new Error('The request signature is invalid.');

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) throw new Error('The relay is busy. Please try again.');
    try {
      const properties = PropertiesService.getScriptProperties();
      removeExpiredNonces(properties, now);
      const nonceKey = NONCE_PREFIX + payload.nonce;
      if (properties.getProperty(nonceKey)) throw new Error('This request has already been used.');

      // Reserve the nonce before sending. If a caller retries after a
      // network timeout, this prevents it from generating duplicate emails.
      properties.setProperty(nonceKey, String(now));
      try {
        MailApp.sendEmail({
          to: CONTEST_EMAIL,
          subject: 'DTK Dutta Contest: mentor approval code',
          body: plainTextEmail(payload),
          htmlBody: htmlEmail(payload),
          name: 'DTK Dutta Contest',
        });
      } catch (error) {
        // Do not permanently consume a code if Apps Script knows it did not
        // send. An ambiguous network failure is intentionally not retried by
        // the portal; the mentor can request a new code instead.
        properties.deleteProperty(nonceKey);
        throw error;
      }
    } finally {
      lock.releaseLock();
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    // Apps Script web apps return a 200 response even for an application
    // error. The Supabase function requires this explicit flag before it
    // treats a message as delivered.
    console.log('Mentor mail relay rejected a request: ' + (error && error.message ? error.message : 'unknown error'));
    return jsonResponse({ ok: false });
  }
}

function parsePayload(event) {
  if (!event || !event.postData || !event.postData.contents) throw new Error('Missing request body.');
  let payload;
  try {
    payload = JSON.parse(event.postData.contents);
  } catch (_) {
    throw new Error('Invalid JSON request.');
  }

  const requiredText = ['request_id', 'applicant_name', 'applicant_email', 'code', 'nonce', 'signature'];
  requiredText.forEach(function (key) {
    if (typeof payload[key] !== 'string' || !payload[key]) throw new Error('Missing request value.');
  });
  if (!/^[0-9]{8}$/.test(payload.code)) throw new Error('Invalid approval code.');
  if (!/^[A-Za-z0-9_-]{24,128}$/.test(payload.nonce)) throw new Error('Invalid nonce.');
  if (!/^[a-f0-9]{64}$/.test(payload.signature)) throw new Error('Invalid signature.');
  if (!Number.isInteger(payload.timestamp)) throw new Error('Invalid timestamp.');
  if (payload.request_id.length > 100 || payload.applicant_name.length > 180 || payload.applicant_email.length > 254) {
    throw new Error('Request value is too long.');
  }
  return payload;
}

function canonicalRequest(payload) {
  return [
    'v1',
    payload.request_id,
    payload.applicant_name,
    payload.applicant_email,
    payload.code,
    String(payload.timestamp),
    payload.nonce,
  ].map(function (value) { return encodeURIComponent(value); }).join('\n');
}

function hmacHex(secret, value) {
  const bytes = Utilities.computeHmacSha256Signature(value, secret, Utilities.Charset.UTF_8);
  return bytes.map(function (byte) {
    return ((byte + 256) % 256).toString(16).padStart(2, '0');
  }).join('');
}

function timingSafeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

function removeExpiredNonces(properties, now) {
  const all = properties.getProperties();
  Object.keys(all).forEach(function (key) {
    if (!key.startsWith(NONCE_PREFIX)) return;
    if (Number(all[key]) < now - MAX_AGE_SECONDS) properties.deleteProperty(key);
  });
}

function plainTextEmail(payload) {
  return 'Mentor approval requested\n\n'
    + payload.applicant_name + ' (' + payload.applicant_email + ') has verified their own email and requested mentor access.\n\n'
    + 'Enter this code inside the signed-in super-admin portal within 15 minutes:\n\n'
    + payload.code + '\n\n'
    + 'Do not forward this code to the applicant.';
}

function htmlEmail(payload) {
  return '<h2>Mentor approval requested</h2>'
    + '<p><strong>' + escapeHtml(payload.applicant_name) + '</strong> (' + escapeHtml(payload.applicant_email) + ') has verified their own email and requested mentor access.</p>'
    + '<p>Enter this code inside the signed-in super-admin portal within 15 minutes:</p>'
    + '<p style="font-size:28px;letter-spacing:4px;font-weight:700">' + payload.code + '</p>'
    + '<p>Do not forward this code to the applicant.</p>';
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function jsonResponse(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
