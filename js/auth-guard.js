// ============================================
// AGRI CORE — auth-guard.js
//
// ⚠️ UX-ONLY: This is NOT a security mechanism.
// It ensures visitors land on index.html first (UX flow),
// not to restrict access to data. All real access control
// is enforced by Firestore Security Rules on the server.
// ============================================
(function () {
  const ENTRY_KEY = "agristudentbd_entered";
  try {
    if (sessionStorage.getItem(ENTRY_KEY) !== "true") {
      window.location.replace("index.html");
    }
  } catch (err) {
    // If storage is unavailable, do not silently bypass the front-door flow.
    console.warn("Agri Core: session storage unavailable; returning to the home page.", err);
    window.location.replace("index.html");
  }
})();
