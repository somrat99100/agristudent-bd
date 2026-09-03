# Changes in this update

## 1. Student ID + Password login system
- **New students (register.html)**: now create a password during registration (with strength hint, confirm field, show/hide toggle). A real Firebase Auth account is created and linked to their registration record (`authUid`, `passwordSet: true`).
- **Already-registered students**: on their **Profile page**, a banner reads *"Set up a new password — from next time you'll log in with your Student ID and password"*, with a form to set one. Setting it creates their Firebase Auth account and flips `passwordSet: true` on their record.
- **Login page**: now defaults to **Student ID + Password**. A "Log in with email instead" link reveals the old email + Student ID form, for anyone who hasn't set a password yet.
- Once `passwordSet` is true, `profile.html` instead shows a "🔒 Password login is enabled" note with a **Change Password** button (sends a Firebase password-reset email).
- `js/password-auth.js` is the new shared module for all of this (strength checks, friendly error messages, create/sign-in/reset wrappers).

## 2. Critical security fix — Firestore rules
The whole app was built on "signed into Firebase Auth = admin." Adding real student password accounts would have silently broken that: **any logged-in student would have passed every `request.auth != null` admin check** (approving/rejecting resources, deleting blog posts, reading the admin message inbox, etc).

Fixed by adding an `isAdmin()` helper in `firestore.rules` that also requires the `admin: true` custom claim (set only via `scripts/set-admin-claim.mjs`, server-side), and replacing every admin-only check with it. A new, tightly-scoped rule lets a student link **their own** new password account to **their own** registration record only (matched by email + Firebase Auth uid) — nothing else.

## 3. Bug fixes
- **Rejected-file restriction not enforced**: the main upload form on `resources.html` never actually called the 30-day restriction check that the other two upload forms already had. Fixed — it's now checked before every upload.
- **Contact/Help button dead for restricted users**: the account-restriction freeze overlay was re-triggering itself on `help.html`, so clicking "Contact Admin" just re-showed the same lockout screen. `help.html`, `login.html`, and `register.html` are now exempt from that check.
- `help.js` autofill referenced a nonexistent `session.displayName` instead of `session.fullName`.
- `session.js`'s `clearSession()` now also signs out of Firebase Auth.

## 4. Blog page hero redesign
Two-column hero (text left, illustration right on desktop; stacked on mobile) with a new original farm-field SVG illustration (`assets/blog-hero-illustration.svg`) — no external/copyrighted imagery.

## Deployment note
`firestore.rules` must be deployed (`firebase deploy --only firestore:rules`) for the security fix to take effect, and your admin account needs the `admin: true` custom claim set via `npm run set-admin` (see `scripts/set-admin-claim.mjs`) if it hasn't been already.
