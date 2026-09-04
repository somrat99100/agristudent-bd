# Resource Portal enhancements — what changed and why

All changes below are additive on top of the existing workflow. Nothing in
registration, Student-ID verification, the manager approval system, or the
database schema was removed — only extended.

## 1. Resource access flow — unchanged

No changes to registration, the Resources gate (`resource-gate` /
`checkAccess()`), or the manager approval system in `js/admin.js`.

## 2. Hand Notes access logic — copy fix only

The actual unlock/lock behavior in `slides-notes.html` already matched the
requested table (No Upload → Locked, Pending → Allowed, Approved → Allowed,
Rejected → Locked, Re-upload → Allowed again) — that logic was not touched.

One wording fix: the pending banner said *"Temporary Access (48 hours)"*,
which implied a time limit that doesn't actually exist in the code (access
is gated by admin review, not a timer). Changed to *"Access Granted
(Awaiting Review)"* so the copy matches the real behavior.

## 3. Resource owner label (new)

- Every upload now looks up the uploader's **registered Student ID** from
  the `registrations` collection (by matching email) and stores it on the
  resource document as `uploaderStudentId` — no new field for the student
  to fill in, it's resolved automatically at submit time.
- `view.html` now shows a small `@copyright-<studentId>` badge, fixed to
  the top-right of the document area. It's `pointer-events: none` so it
  never blocks taps/zooms/scrolling, and it only appears when an owner ID
  is available (older resources uploaded before this change simply show no
  badge, instead of a broken one).

## 4. Upload count (new)

The Hand Notes access-status banner now shows a live line under the
Approved/Pending status: **"Uploads by Student ID `<id>`: `<count>`"** —
recalculated every time status is checked, i.e. right after every new
upload.

## 5. "Upload Your Resource" redesign

Rebuilt to match "Upload Another File" 1:1:
- PDF / Image / PPT file-type picker (same radio-card UI)
- Course-name hint when a course code auto-matches
- Faculty-name suggestions (datalist) for existing course codes
- Per-image title inputs when "Image" is selected

The Hand Notes vs. Suggestions `resourceType` selector and the Suggestions
`examType` field — unique to this form — are unchanged.

## 6. Mobile PDF viewer fix

Root cause of "zooms into one corner, can't pan freely": `.book-page
canvas` had `transform-origin: 0 0` in the CSS, while the pan/zoom
controller in `view.html` computes pinch/double-tap/pan math assuming
**center-anchored** scaling (it works correctly for images, which use the
CSS default `center center`). Fixed by aligning the canvas's
transform-origin back to `center center`. Pinch-zoom, double-tap-zoom,
panning, and swipe-to-turn-page all route through the same controller, so
this one fix addresses the reported navigation/zoom problems.

## 7. UI polish

Reused the existing design system (Fraunces/Work Sans/JetBrains Mono,
moss/leaf/wheat palette, card shadows, hover states already defined in
`css/style.css`) rather than introducing a new one, so the redesigned
upload form and the new owner badge look native to the rest of the site.

## Nothing else changed

`firestore.rules` did not need any edits — the `resources` create rule
validates a fixed set of *required* keys but doesn't forbid extra ones, so
the new `uploaderStudentId` / `fileType` fields pass through the existing
rules as-is.

## 8. Mobile: page-turn controls getting cut off

`.book-controls` (Prev / page number / Next in the document viewer) had no
`flex-wrap`, so on narrow phones the row didn't all fit on one line. Flex
items shrink but text/inputs have a minimum content width, so the row
overflowed past `.viewer-book`'s edge — and `.viewer-book` clips overflow
(needed elsewhere for its rounded corners), cutting off part of the bar.
Added `flex-wrap: wrap` as a safety net plus tighter sizing at 700px and a
new 400px breakpoint, so it reliably fits on one line on common phones and
never gets clipped on the narrowest ones.

## 9. Per-file unlocking + admin-reviewed classroom codes

Previously, unlocking ANY file (by uploading a file or submitting a
classroom code) granted one shared, account-wide time window that
unlocked every file at once. Two changes:

- **Per-file unlock.** Clicking 🔒 Unlock on a specific file now tags
  whatever gets submitted (upload or classroom code) with that file's id
  (`targetFileId` — `js/resources.js` `hnOpenGate(fileId)`). `js/access.js`
  now has `computeFileAccessStatus(items, fileId)`, which only counts a
  submission toward the file it was tagged for. Submissions made before
  this existed (no `targetFileId`) still count toward every file, so no
  one loses access they already had. The old blanket "Unlock Access"
  button (with no specific file in mind) was removed from
  `slides-notes.html` since it no longer has a file to target.
- **Classroom codes require admin approval.** A submitted code no longer
  grants access on its own — `js/access.js` only creates a grant once the
  code's Firestore status is `"approved"`. The admin panel's Classroom
  Codes tab (`js/admin.js`) has a new "✅ Confirm & Unlock" button that
  sets `status: "approved"` (this is what actually unlocks the file for
  the student). Resource-file uploads are unchanged — they still grant
  access immediately, same as before.

No `firestore.rules` changes needed here either — `targetFileId` is an
extra field the existing `hasAll(...)` create rules for `resources` and
`classroomCodes` don't forbid, and admin approval already required
`request.auth != null` for updates to `classroomCodes`, same as the
existing "Mark Contacted" action.

