# AgriStudent BD — Agri Core

Security-hardened Firebase web portal.

## Setup

1. Enable Firebase Authentication → Email/Password.
2. Configure the Functions environment as required by the existing notification setup.
3. Before production, run the one-time privacy/data migration:

```bash
npm install firebase-admin
set GOOGLE_APPLICATION_CREDENTIALS=path\to\service-account.json
set CLOUDINARY_API_KEY=your_key
set CLOUDINARY_API_SECRET=your_secret
set CLOUDINARY_CLOUD_NAME=db6r0up6r
node scripts/migrate-privacy.mjs
```

4. Deploy:

```bash
firebase deploy --only functions,firestore:rules,storage,hosting
```

5. Use `scripts/set-admin-claim.mjs` to grant `admin=true` to the administrator account.

## Existing users

Students registered before password authentication can use `activate.html`. They verify the email already stored in their registration record and create a password. Their existing registration record is reused.

## Data safety

No client-side migration automatically deletes existing Firestore data. The migration script preserves old PII in admin-only metadata before removing duplicate PII from student-readable documents. Existing Cloudinary assets are only removed when an optional migration successfully copies the file and successfully requests Cloudinary deletion.

See `SECURITY_HARDENING.md` and `DATA_PRESERVATION.md`.
