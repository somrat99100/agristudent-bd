// ============================================
// AGRISTUDENT BD — main.js (shared across pages)
// ============================================

// Mobile nav toggle
document.addEventListener('DOMContentLoaded', () => {
  function setupNavToggle() {
    const toggle = document.querySelector('.nav-toggle');
    const links = document.querySelector('.nav-links');
    const closeBtn = document.querySelector('.nav-links-close');
    const backdrop = document.getElementById('nav-drawer-backdrop');
    if (toggle && links && !toggle.dataset.bound) {
      toggle.dataset.bound = "true";

      function openDrawer() {
        links.classList.add('open');
        backdrop?.classList.add('open');
        toggle.setAttribute('aria-expanded', 'true');
        document.body.style.overflow = 'hidden';
      }
      function closeDrawer() {
        links.classList.remove('open');
        backdrop?.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      }

      toggle.addEventListener('click', () => {
        links.classList.contains('open') ? closeDrawer() : openDrawer();
      });
      closeBtn?.addEventListener('click', closeDrawer);
      backdrop?.addEventListener('click', closeDrawer);
      // Tapping a menu link should navigate AND close the drawer behind it
      links.querySelectorAll('a').forEach(a => a.addEventListener('click', closeDrawer));
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && links.classList.contains('open')) closeDrawer();
      });
    }

    // Subtle shadow once the page has scrolled past the very top — makes
    // the sticky navbar read as "lifted" above the content instead of
    // blending into it.
    const navbar = document.querySelector('.navbar');
    if (navbar && !navbar.dataset.scrollBound) {
      navbar.dataset.scrollBound = "true";
      const updateShadow = () => navbar.classList.toggle('is-scrolled', window.scrollY > 4);
      updateShadow();
      window.addEventListener('scroll', updateShadow, { passive: true });
    }
  }
  // navbar.html is injected asynchronously (fetch), so bind as soon as it's
  // ready rather than assuming it's already in the DOM at this point.
  if (typeof window.whenNavbarReady === "function") {
    window.whenNavbarReady(setupNavToggle);
  } else {
    setupNavToggle();
  }

  // Animated stat counters (runs once, respects reduced motion)
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('[data-count]').forEach(el => {
    const target = parseInt(el.getAttribute('data-count'), 10) || 0;
    if (prefersReduced) {
      el.textContent = target.toLocaleString() + '+';
      return;
    }
    let current = 0;
    const duration = 1200;
    const stepTime = 16;
    const steps = duration / stepTime;
    const increment = target / steps;
    const timer = setInterval(() => {
      current += increment;
      if (current >= target) {
        el.textContent = target.toLocaleString() + '+';
        clearInterval(timer);
      } else {
        el.textContent = Math.floor(current).toLocaleString() + '+';
      }
    }, stepTime);
  });

  // Universal search is now handled by js/search.js (live Firestore results).

  // Scroll-triggered reveal animation — fades + lifts elements with the
  // ".reveal" class into view as they enter the viewport. Staggers slightly
  // by index so groups (cards, stats) don't all pop in at once.
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const revealEls = document.querySelectorAll('.reveal');
  if (revealEls.length) {
    if (prefersReducedMotion || !('IntersectionObserver' in window)) {
      revealEls.forEach(el => el.classList.add('is-visible'));
    } else {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.15 });

      revealEls.forEach((el, i) => {
        el.style.transitionDelay = `${Math.min(i % 6, 5) * 70}ms`;
        observer.observe(el);
      });
    }
  }
});
