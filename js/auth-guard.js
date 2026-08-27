// Remove legacy client-side identity cache keys.
try { localStorage.removeItem("agri_session_v1"); sessionStorage.removeItem("agri_student_id"); localStorage.removeItem("agri_handnotes_user_email"); } catch {}

// UX-only route guard. Firebase Authentication + Firestore/Storage rules are the real security boundary.
// Only checks that the visitor entered via index.html — it must NOT require a
// logged-in session, since this script also runs on login.html/register.html
// (where no session exists yet) and on pages meant to be browsable as a guest
// (resources, knowledge hub, blog, faq, calculators, timeline). Per-action
// login requirements are already enforced individually via ensureStudentAuth()
// in session.js, and real data access is enforced by Firestore/Storage rules.
(function () {
  const ENTRY_KEY = "agristudentbd_entered";
  try {
    if (sessionStorage.getItem(ENTRY_KEY) !== "true") {
      window.location.replace("index.html");
    }
  } catch (err) {
    // sessionStorage unavailable (privacy mode) — fail open
    console.warn("Agri Core: session storage unavailable, skipping entry check.", err);
  }
})();
