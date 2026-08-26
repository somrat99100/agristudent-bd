// navbar-loader.js — fetches navbar.html and injects it before <body>'s first child.
// Also marks the current page's nav link as active.
(function () {
  fetch("navbar.html")
    .then(r => r.text())
    .then(html => {
      const placeholder = document.getElementById("navbar-placeholder");
      if (placeholder) {
        placeholder.outerHTML = html;
      } else {
        document.body.insertAdjacentHTML("afterbegin", html);
      }

      // Mark active link
      const current = location.pathname.split("/").pop() || "index.html";
      document.querySelectorAll(".nav-links a").forEach(a => {
        const href = a.getAttribute("href");
        if (href === current || (current === "" && href === "index.html")) {
          a.classList.add("active");
          a.setAttribute("aria-current", "page");
        }
      });

      // Signal that the navbar DOM now exists. Any script that needs to
      // touch navbar elements (nav-toggle, the login/profile auth slot,
      // etc.) should call whenNavbarReady(fn) instead of assuming the
      // navbar is already in the DOM — fetch() is async, so scripts that
      // run at DOMContentLoaded can otherwise fire before this injection
      // completes and silently find nothing.
      window.__navbarLoaded = true;
      (window.__onNavbarReady || []).forEach(fn => {
        try { fn(); } catch (err) { console.error("[navbar-loader] ready callback failed:", err); }
      });
    })
    .catch(err => console.warn("Navbar failed to load:", err));
})();

// Register a callback to run once the navbar has been injected. Safe to
// call before OR after injection happens.
window.whenNavbarReady = function (fn) {
  if (window.__navbarLoaded) fn();
  else (window.__onNavbarReady = window.__onNavbarReady || []).push(fn);
};
