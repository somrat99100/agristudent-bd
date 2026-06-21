// ============================================
// AGRISTUDENT BD — main.js (shared across pages)
// ============================================

// Mobile nav toggle
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', () => links.classList.toggle('open'));
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

  // Placeholder universal search — wired up later when Firebase is connected
  const searchForm = document.querySelector('.search-bar');
  if (searchForm) {
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      alert('Search will be connected once Resources, Terms, and FAQ data are live.');
    });
  }

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
