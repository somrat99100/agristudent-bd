// ============================================
// IDENTITY NORMALIZATION — shared by every page that reads or writes
// an email address or Student ID.
//
// WHY THIS FILE EXISTS (bug fix):
// Emails and Student IDs were being saved/queried with whatever casing
// and spacing the student happened to type ("Rahim@Gmail.com" vs
// "rahim@gmail.com", "21-AGR-045" vs "21-agr-045 "). Firestore `==`
// queries are case-sensitive and exact, so the SAME person typing the
// SAME identity slightly differently on two different forms produced
// two different, non-matching values. That's the root cause of the
// Student-ID access gate reporting "not registered" for genuinely
// registered students, and the upload/credit counter not finding a
// student's own uploads.
//
// Fix: always pass every email/Student ID through these helpers before
// saving to Firestore AND before querying Firestore.
// ============================================

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function normalizeStudentId(id) {
  return String(id || "").trim().toUpperCase().replace(/\s+/g, " ");
}
