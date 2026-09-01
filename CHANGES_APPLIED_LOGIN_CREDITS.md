# Agri Core — Login/Profile + Tracking & Credit Bug Fixes

## Root causes found

1. **No normalization of email / Student ID anywhere.** Every form saved
   and queried these fields exactly as typed. Firestore `==` queries are
   case/whitespace-exact, so `Rahim@Gmail.com` vs `rahim@gmail.com` (or
   `21-agr-045` vs `21-AGR-045`) were treated as different identities.
   This is why the Student-ID access gate could say "not registered" for
   real students, and why upload counts silently failed to match a
   student to their own uploads.

2. **`firestore.rules` denied the exact queries the "credit"/status
   feature depends on.** `allow list: if resource.data.status == "approved"`
   requires Firestore to *prove* every possible result of a query
   satisfies that condition. A query like
   `where("uploaderEmail","==", email)` (no status filter — needed
   because a student's own upload can be pending/rejected, not just
   approved) can't be proven, so Firestore rejected the whole query
   outright. That's the real reason the upload/credit counter "wasn't
   showing." Fixed by making `resources`/`terms` list public (`if true`),
   mirroring the same precedent already used for `registrations` in this
   file, since students never sign in. All public *browsing* queries
   already filter `status == "approved"` themselves in the JS, so nothing
   pending/rejected becomes newly visible in normal browsing.

3. **Real crash bug:** `js/resources.js` had `if (!docs.empty)` where
   `docs` is a plain array (`.map()` result), not a Firestore snapshot —
   arrays have no `.empty` property, so this check was always
   meaningless and could throw. Fixed to `docs.length > 0`.

## ⚠️ Action required
`firestore.rules` in this package is updated. **Deploy it** via Firebase
Console (Firestore → Rules → paste + Publish) or `firebase deploy --only
firestore:rules`. The client-code fixes alone are not enough — the rules
change is what actually unblocks the credit/status queries.

## New: Login / Profile
- `login.html` + `js/login.js` — log in with the email + Student ID used
  at registration (no password; matches this site's existing no-auth
  trust model for students).
- `profile.html` + `js/profile.js` — shows identity, verification
  status, and a live credits dashboard (Total / Approved / Pending /
  Rejected) built from the student's own resource + knowledge-hub
  submissions, re-verified against Firestore on every visit.
- Navbar now shows **Login** or **[Name] · Logout** on every page
  (`js/session.js`, injected via the shared `navbar.html`).
- Being logged in auto-fills the uploader email on every upload form and
  auto-unlocks the Student-ID / hand-notes resource gates — removes the
  main source of the mismatched-identity bug at the source.

## Also fixed
- `js/main.js` nav-toggle button could silently fail to bind because
  `navbar.html` is injected asynchronously; now waits for a proper
  `whenNavbarReady()` hook (`js/navbar-loader.js`).
- `faq.html` was a stale hardcoded copy of the navbar (missing search,
  Blog link, and now missing the auth slot) — switched to the shared
  `navbar.html` like every other page.
- Admin's generic edit-modal now normalizes email/Student ID fields too,
  so an admin correction can't reintroduce a mismatch.
