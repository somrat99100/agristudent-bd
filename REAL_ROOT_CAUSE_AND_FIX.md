# Why the earlier storage.rules / accessUntil fix didn't solve it

Short version: that fix was correct on its own terms, but it patched a
Firebase Storage code path that this project **never actually uses**. I
verified this directly — there is no `getStorage`, `uploadBytes`,
`getDownloadURL`, or any Firebase Storage SDK call anywhere in the project.
Every file (resources, student ID photos, avatars, blog images) is uploaded
straight to **Cloudinary** (`uploadFileToCloudinary`, see `js/registration.js`
and `js/resources.js`). `storage.rules` and the `accessUntil` field it reads
from `registrations/{id}` govern a Firebase Storage bucket that nothing in
the app talks to, so no matter how correct that sync is, it can't change
what you see on `slides-notes.html` / `previous-questions.html` /
`resources.html`.

## Where "Unlock → reload → Locked again" actually happens

The real gate is in `js/resources.js` (shared by all three of those pages).
On every page load (and every 15s after) it re-queries Firestore directly —
`getResourceAccessState()` → `computeResourceAccessStatus()` in
`js/access.js` — and recomputes access fresh from your own upload records.
It does **not** depend on the `accessUntil` field at all. So the badge
should already survive a reload correctly, on its own — which pointed at
one of two real causes:

### 1. The uploader-email field could silently drift (most likely cause)
`hn-uploaderEmail` on the Hand Notes form was only *pre*filled from your
session — a normal, still-editable text input. If it ever gets retyped,
autocorrected, or you use a different personal email, the upload gets
stamped with **that** email, while every later access check queries by your
**session** email. If the two don't match, the check finds zero of your
uploads and genuinely-active access renders as locked — exactly the
"submits fine, unlocked, then locked on return" symptom, with no error
shown anywhere.

**Fix:** the email field is now locked (read-only) to your account email
the moment you're logged in, so it can never drift from the identity the
access check actually uses.

### 2. A failed access check looked identical to "no access"
If the very first Firestore check on a fresh page load ever failed (slow
connection, brief network hiccup), the code silently gave up and rendered
every file as 🔒 — indistinguishable from real expiry, with the only trace
in the browser console.

**Fix:** the first check now retries automatically (up to 3 times, with a
visible "Checking your access… retrying" message) before ever falling back
to a locked render, so a real "no access" state is only shown once
Firestore has actually answered.

## Also fixed (for correctness, even though currently unused)
- `js/profile.js` / `js/admin.js`: `accessUntil` / `restrictedUntil` now
  write as `Timestamp.fromDate(...)` instead of a raw JS `Date`, matching
  what `storage.rules`' `.toMillis()` expects — correct if this project
  ever does start using Firebase Storage for these paths.
- `storage.rules`: `restrictedUntil` was being compared to a number
  (`request.time.toMillis()`) while it's actually stored as a Timestamp —
  in Firestore Rules that comparison silently evaluates to `false` always,
  which meant a custom/rejection restriction was a no-op. Now converts to
  millis first.

## What to test
1. Log in, upload a Hand Notes file on `slides-notes.html`.
2. Confirm the badge shows "🔓 Resource Access Active".
3. Close the tab (not just navigate) and reopen `slides-notes.html`.
4. It should still say Active with the correct remaining time — the email
   field will show your account email, greyed out / read-only.
5. If you ever do see a false lock again, open DevTools → Console right
   when it happens — any `[Access Status Check] failed:` or
   `permission-denied` line there is the next concrete lead, and is worth
   sending over.
