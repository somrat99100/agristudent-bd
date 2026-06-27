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

      // Re-run main.js nav toggle logic if already loaded
      if (typeof window.__navReady === "function") window.__navReady();
    })
    .catch(err => console.warn("Navbar failed to load:", err));
})();
