# Agri Core — Security & Privacy Hardening

This package applies a final security pass while preserving existing Firestore documents and uploaded assets.

## What changed

- Firebase Authentication email/password is now the student login boundary.
- New student accounts are created only after server-side email OTP verification.
- Firebase Auth accounts are marked email-verified and receive a minimal custom claim: `student=true` and `regId`.
- Existing registration records are preserved. A one-time activation flow lets legacy students verify their registered email and create a password.
- Sensitive email/Student-ID values are no longer stored in browser localStorage/sessionStorage.
- New resource/term/blog/comment records do not contain uploader/author email or Student ID fields.
- Moderated public content uses `public` plus `privacyVersion: 2`.
- Student-readable queries require the privacy version and public flag where appropriate.
- Legacy PII is moved into admin-only `private*Meta` collections by the migration script.
- New uploads use authenticated Firebase Storage. Resource and Student-ID uploads use non-bearer `storage://` references and are fetched through authenticated Storage SDK calls.
- Student-ID Storage paths are readable only by the owner or an administrator.
- Email notifications are sent server-side; EmailJS is no longer initialized or called from the browser.
- Cloudinary signing is disabled for new uploads. Existing Cloudinary URLs remain untouched until the optional migration script moves the sensitive/resource assets.
- Admin access requires both a verified Firebase email and the `admin=true` custom claim.
- Firestore and Storage use default-deny rules for unspecified paths.
- Hosting security headers and CSP were tightened.

## Mandatory one-time migration

Before exposing existing resources/blog/terms/comments to students under the new rules, run:

```bash
npm install firebase-admin
set GOOGLE_APPLICATION_CREDENTIALS=path\to\service-account.json
set CLOUDINARY_API_KEY=your_key
set CLOUDINARY_API_SECRET=your_secret
set CLOUDINARY_CLOUD_NAME=db6r0up6r
node scripts/migrate-privacy.mjs
```

On PowerShell, use `$env:NAME="value"` instead.

The migration:
1. Copies old PII into admin-only collections.
2. Removes PII fields from student-readable content documents.
3. Adds `public` and `privacyVersion: 2`.
4. Links legacy content to `uploaderRegId`/`authorRegId` where possible.
5. Moves legacy Cloudinary resource files to Firebase Storage when Cloudinary credentials are supplied.
6. Moves legacy Student-ID images to private Firebase Storage.
7. Keeps a legacy copy reference in admin-only metadata.
8. Does not delete a Cloudinary asset unless the copy succeeded and the Cloudinary deletion call succeeds.

**Back up/export your Firestore project before running any migration.** Review the migration output before production deployment.

## Firebase setup

Enable **Authentication → Email/Password** in Firebase Console.

Deploy:

```bash
firebase deploy --only functions,firestore:rules,storage,hosting
```

Then set the admin claim with the included script.

## Important privacy boundary

A Firebase Storage `getDownloadURL()` is a bearer URL. Therefore private Student-ID and restricted resource files are stored as `storage://...` references and loaded with the authenticated Firebase Storage SDK instead of putting public download URLs into Firestore.

Existing Cloudinary assets are not automatically private merely because Firestore is protected. Run the migration with Cloudinary credentials if those existing assets include sensitive/private files.

## Data preservation

No automatic destructive reset, collection deletion, document-ID replacement, or Firebase Auth reset is performed by the website code. The migration is additive first and removes only duplicated PII/old file references after preservation/copying.
