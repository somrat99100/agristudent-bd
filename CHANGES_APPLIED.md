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
