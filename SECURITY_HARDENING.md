# Agri Core — Security Hardening v6

This build removes the previous client-side identity/session trust model and makes Firebase Authentication + Firebase Security Rules the security boundary.

## What changed

- Student login is now Firebase Email/Password Authentication.
- Email verification is required before private student features can be used.
- Student records are keyed by Firebase Auth UID instead of a guessable/random client-side registration ID.
- Firestore registration records are private: only the owning UID or an admin custom claim can read them.
- Admin access requires a Firebase Auth custom claim: `admin == true` **and** verified email.
- Resource, term, blog, comment, and classroom-code writes require authenticated users where appropriate.
- Public resource/blog/term documents must explicitly have `public == true`; private moderation fields are no longer exposed to public reads.
- Student uploads use Firebase Storage rules instead of unsigned Cloudinary uploads.
- Student ID photos are no longer uploaded to an unsigned public endpoint.
- Third-party Office Online viewing was removed so file URLs are not forwarded to an external viewer.
- EmailJS is disabled in the hardened client build. Client-side email delivery is not treated as a trusted backend.
- CSP and security meta tags were tightened; Firebase Hosting headers are provided in `firebase.json`.
- Unknown Firestore paths default to deny.

## Required Firebase Console steps

1. Enable **Authentication → Sign-in method → Email/Password**.
2. Enable **Email verification** for student accounts.
3. Deploy `firestore.rules` and `storage.rules`.
4. Deploy through Firebase Hosting if possible so the headers in `firebase.json` are actually delivered as HTTP response headers.
5. Create the admin account in Firebase Authentication, verify its email, then run `scripts/set-admin-claim.mjs` with that email.
6. Keep the Firebase service-account JSON outside this website and never put it in the ZIP, repository, or web root.
7. If the project uses App Check, enable enforcement after validating the production traffic.

## Important migration note

The old build stored student email addresses and other identity fields directly in public Firestore documents and used a client-controlled session as an identity boundary. Those old documents must not be left publicly readable.

Before production, either:

- migrate old data with a trusted Admin SDK process and remove the old PII fields, or
- archive/delete the old collections and start with the hardened schema.

The new rules intentionally prevent old documents containing legacy `uploaderEmail`, `authorEmail`, or similar fields from becoming public merely because their status is approved.

## Security acceptance target

For a genuine production sign-off, deploy the rules and run authenticated/unauthenticated tests against the live Firebase project. A ZIP-level review cannot prove backend configuration, Firebase Console settings, App Check enforcement, hosting headers, account recovery configuration, or existing database contents.
