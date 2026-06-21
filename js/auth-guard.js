// ============================================
// AGRISTUDENT BD — auth-guard.js
//
// Lightweight "entry gate" — not a login system. It simply makes sure
// people land on index.html first before reaching any sub-page, so the
// site can't be deep-linked into mid-flow. The flag lives in
// sessionStorage, so it resets each new browser session/tab and never
// touches a server.
//
// USAGE:
//   - index.html includes mark-entry.js (sets the flag).
//   - Every other page includes this script FIRST in <head>, before any
//     CSS/content, so a blocked visitor is redirected before anything
//     renders (no flash of protected content).
// ============================================
(function () {
  const ENTRY_KEY = "agristudentbd_entered";
  try {
    if (sessionStorage.getItem(ENTRY_KEY) !== "true") {
      window.location.replace("index.html");
    }
  } catch (err) {
    // sessionStorage unavailable (privacy mode/blocked) — fail open rather
    // than locking the visitor out entirely.
    console.warn("AgriStudent BD: session storage unavailable, skipping entry check.", err);
  }
})();
