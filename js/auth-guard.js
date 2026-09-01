// Remove legacy client-side identity cache keys.
try { localStorage.removeItem("agri_session_v1"); sessionStorage.removeItem("agri_student_id"); localStorage.removeItem("agri_handnotes_user_email"); } catch {}

// UX-only route guard. Firebase Authentication + Firestore/Storage rules are the real security boundary.
(function () {
  const ENTRY_KEY = "agristudentbd_entered";
  const SESSION_KEY = "agri_session_v2";
  try {
    if (sessionStorage.getItem(ENTRY_KEY) !== "true") {
      window.location.replace("index.html");
      return;
    }
    const raw = localStorage.getItem(SESSION_KEY);
    const session = raw ? JSON.parse(raw) : null;
    if (!session?.regId) window.location.replace("login.html");
  } catch {
    window.location.replace("login.html");
  }
})();
