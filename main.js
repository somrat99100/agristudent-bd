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
});
