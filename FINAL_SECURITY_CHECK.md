# Final Security Check

## Implemented
- Firebase Auth email/password student login.
- Server-side OTP verification for new registration and legacy account activation.
- Auth `email_verified` required for student/admin access.
- Admin custom claim required for administrator access.
- No student email/Student ID stored in Web Storage.
- Legacy Web Storage identity keys are removed on app load.
- New student-readable resource/blog/term/comment documents contain no email or Student ID.
- `public` + `privacyVersion: 2` is required for new moderated content.
- Legacy PII is moved to admin-only collections by `scripts/migrate-privacy.mjs`.
- New resources and private Student-ID files use Firebase Storage authenticated references.
- No browser-side EmailJS SDK or Cloudinary upload API is used.
- Help/review email notifications are server-side.
- Firestore and Storage have default-deny rules.
- Public settings are limited to the `semester` document.
- Password reset uses Firebase Authentication.
- Rate limiting was added to OTP and student notification callables.
- CSP/security headers were tightened.

## Required before production
1. Back up/export Firestore.
2. Enable Firebase Authentication → Email/Password.
3. Run `npm run migrate-privacy` with a Firebase service-account credential.
4. Supply Cloudinary credentials to migrate legacy private/resource assets.
5. Verify the migration counts and test several old resources and Student-ID records.
6. Deploy rules, Storage, Functions and Hosting.
7. Disable the old Cloudinary unsigned upload preset.
8. Set the administrator custom claim with `npm run set-admin`.
9. Test anonymous, unverified, verified-student and admin access separately.

## Data preservation
The migration copies legacy private fields to admin-only metadata before deleting the duplicated fields from student-readable documents. Existing Firestore document IDs and content are retained.
