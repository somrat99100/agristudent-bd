// ============================================
// AGRI CORE — mark-entry.js
//
// Runs only on index.html. Marks this browser session as having
// entered through the front door, which js/auth-guard.js checks on
// every other page before allowing it to render.
// ============================================
(function () {
  try {
    sessionStorage.setItem("agristudentbd_entered", "true");
  } catch (err) {
    console.warn("Agri Core: session storage unavailable, entry not recorded.", err);
  }
})();
