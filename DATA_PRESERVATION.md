# Data Preservation

This security update is designed to preserve existing site data.

- Existing Firestore collections and document IDs are retained.
- Existing registration records are retained.
- Existing resource/blog/term/comment content is retained.
- Existing Cloudinary assets are retained unless the optional migration script successfully copies a sensitive/resource asset and then successfully requests its deletion.
- Legacy PII removed from public content documents is copied into admin-only `private*Meta` collections first.
- Existing Student-ID images can be copied into private Firebase Storage before the old reference is removed.
- Legacy students without Firebase Auth accounts can use `activate.html` to create a password-protected account without recreating their registration record.
- The migration script is idempotent and should be run only after reviewing a backup/export.
