# Agri Core — V5 Updates

## Registration
- Registration is now simpler: Name, Email, Gender and Student ID.
- Student ID photo upload is removed.
- Email OTP verification is the only approval step.
- After a correct OTP, the account is immediately marked `verified` and the student is auto-logged in.
- Admin no longer needs to approve registrations.

## Blog / Student Timeline
- New posts are private to the author while they are pending moderation.
- Other users can see a post only after an admin changes its status to `approved`.
- Authors can still see their own pending/rejected posts on their timeline.
- Public posts show a `Public` badge after approval.

## Resource Access
- Uploading a PDF, image, PPT/PPTX successfully grants 30 minutes of Hand Notes access.
- Every successfully uploaded file adds another 30 minutes; multi-file uploads therefore stack time per file.
- The access timer persists across refreshes in the browser.
- If an admin rejects a resource submission, the uploader is restricted from uploading/accessing Hand Notes for 30 days.
- A warning is shown: `Upload relevant files only`.
- Upload forms check the moderation restriction before uploading.

## Homepage Resource Count
- The Resources Shared counter now counts actual approved PDF and Presentation files, not resource/folder documents.
- A submission containing multiple PDF/PPT files contributes the number of actual files.

## Admin
- Registration records now display `OTP Verified · Auto-approved`.
- Resource rejection automatically records `rejectedAt` and a 30-day `restrictedUntil` timestamp.
