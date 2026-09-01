# Agri Core — Security Hardening

## What was hardened

- Student records are no longer publicly listable.
- Student access is tied to Firebase Authentication UID, not a browser-only email/ID session.
- Registration documents use the Firebase Auth UID as the document ID.
- Resource and glossary submissions require an authenticated, verified student and are ownership-scoped.
- Blog posts are public only when `status == approved`; pending, pending_edit, and rejected posts are readable only by the author or admin.
- Blog deletion/editing is server-authorized by owner/admin rules.
- Blog comments are ownership-scoped for writes/deletes.
- Blog likes are tied to Firebase Auth UID rather than a user-controlled email in the document ID.
- Admin operations are restricted to the configured admin email account.
- Student profile avatar changes are restricted to the owner.
- Resource rejection writes a 30-day restriction into the student's registration record.
- Homepage no longer enumerates private registrations or pending resources.
- Front-door storage failure now fails closed instead of bypassing the check.
- User-generated HTML continues to be escaped/sanitized before rendering.

## Required Firebase setup

1. Enable **Email/Password** authentication in Firebase Authentication.
2. The admin account must be `iubatagriculture@gmail.com` unless the `admin()` rule is changed to the real administrator identity.
3. Existing student accounts created under the old email+Student-ID-only system do not have Firebase Auth credentials. They must register again and choose a password, or be migrated by a trusted backend.
4. Deploy these rules with:

```bash
firebase deploy --only firestore:rules
```

## Important architectural limitation

The browser still performs the custom OTP generation/verification and direct unsigned Cloudinary uploads. A static client cannot make either of these operations fully tamper-proof. For production-grade assurance, move OTP generation/verification to a trusted backend (Cloud Function/server) and use signed/private media delivery for Student ID documents and protected resources.

The Firebase web configuration API key is not a secret; Firestore/Authentication rules are the security boundary.


## Data preservation
This version does not delete or bulk-rewrite existing Firestore or Cloudinary data. See `DATA_PRESERVATION.md`. Legacy approved resources remain readable by verified students with active access even when their older documents do not contain `uploaderUid`.
