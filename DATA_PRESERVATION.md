# Agri Core — Data Preservation Update

This security update is designed to **preserve the data already stored in Firebase**.

## What is preserved

- Existing `registrations` documents are not deleted or rewritten.
- Existing `resources` documents and their files are not deleted.
- Existing approved resources remain usable by verified students who have active resource access, even if older resource documents do not contain `uploaderUid`.
- Existing approved blog posts remain publicly visible.
- Existing courses, terms, timeline entries, messages, and other Firestore documents are not migrated or removed by this ZIP.
- Existing Cloudinary files are not deleted.

## What changed

Security rules now protect new/private data using Firebase Authentication and UID ownership. Legacy records are intentionally retained rather than mass-migrated or deleted.

## Important legacy-account note

Older registration records that were created before Firebase Authentication accounts existed remain in Firestore for administrator access. They are not exposed through a public registration query. A legacy student must have a Firebase Authentication account linked to their registration UID before they can use the new UID-based student security model. This avoids weakening privacy just to support an automatic migration.

## Deployment

Deploy the rules with:

```bash
firebase deploy --only firestore:rules
```

No Firestore data migration command is included in this ZIP. That is intentional: a migration should be performed only after taking a Firebase export/backup and verifying the mapping between each legacy registration and its authenticated account.
