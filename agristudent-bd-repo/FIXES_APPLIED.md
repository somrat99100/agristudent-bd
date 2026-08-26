# What was actually broken, and what changed

The audit's `firestore_rules.hardened` was written assuming a login-gated app
(every write behind `request.auth != null`). Your app isn't built that way:
only the **admin panel** (`js/admin.js`) ever calls
`signInWithEmailAndPassword`. Students never sign in — registration,
resource uploads, term submissions, and the contact form are all
intentionally anonymous, with `status: "pending"/"unverified"` fields as the
review gate instead of auth.

Deploying the hardened rules as originally drafted would have **immediately
broken**, for every real visitor:

| Feature | Why it broke |
|---|---|
| Resource uploads (`resources.html`) | Rule required `request.auth != null`; students never authenticate |
| Term submissions (`knowledge-hub.js`) | Same — required auth on create |
| Contact form (`help.js`) | Rule required a `uid` field equal to `request.auth.uid`; the real document has no `uid` at all |
| New course code entry (`resources.js` setDoc to `courses`) | Rule required auth on write; this was already broken in the *original* rules too |
| Live registration counter (`stats.js`) | Would have needed `request.list` restricted to auth, but this call is unauthenticated |
| Student-ID access gate (`resources.js checkAccess`) | Same — an unauthenticated `where("studentIdNumber", ...)` query needs public `list` |

## What the fixed `firestore.rules` does instead

- **Creates stay public** for `registrations`, `resources`, `terms`, and
  `messages`, matching how the app actually works — but each is now validated
  server-side: required fields must be present, `status` must start at the
  correct pending value, `resourceType` must be a whitelisted value, file
  lists can't be empty or absurdly long, message length is capped. This is
  the real fix for the audit's core concern (spam/spoofed data), without
  requiring a login flow that doesn't exist yet.
- **All updates/deletes still require auth** — unchanged from your original
  rules, and already correct, since only the admin panel logs in.
- **`courses` create is now public + validated** (it wasn't before, which
  was a pre-existing bug: `resources.js` calls `setDoc` on a new course code
  with no auth, but the old rule required `request.auth != null` for any
  write to `courses`).
- **`registrations` list stays public on purpose.** This is a known
  trade-off, not an oversight: `stats.js`'s live counter and the resource
  access gate both run unauthenticated queries against this collection. If
  you want to fully lock down listing later (hiding email/photo URLs from
  anyone who opens devtools), the real fix is moving those two read paths
  behind a Cloud Function that returns only a count / a status string,
  rather than exposing the raw collection — that's a bigger change than a
  rules edit, so it's flagged here rather than silently "fixed."

## Deploying

Firebase Console → Firestore Database → Rules → paste the contents of
`firestore.rules` → Publish. No code changes are required beyond what's
already in this package (a small error-message improvement in
`js/resources.js`; everything else works with your existing files as-is).

Test after deploying:
- Register a new student (unauthenticated) → should succeed, `status: "unverified"`.
- Upload a resource (unauthenticated) → should succeed, `status: "pending"`.
- Submit a term via Knowledge Hub → should succeed, `status: "pending"`.
- Send a message via the Help/contact form → should succeed.
- Try (in devtools, unauthenticated) `addDoc(collection(db,"resources"), {status:"approved", ...})` → should be **denied** (can't self-approve).
- Log into `admin.html` and approve/reject a registration, resource, or term → should succeed.
- Log out, try updating any document directly → should be **denied**.
