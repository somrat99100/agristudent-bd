// ============================================
// AGRI CORE — public homepage statistics
// Counts are returned by a trusted Cloud Function so the browser never
// needs public read access to private registration/resource documents.
// ============================================
import { functions } from "./firebase-config.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const getPublicStats = httpsCallable(functions, "getPublicStats");

function animateCount(el, target) {
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefersReduced || target <= 0) {
    el.textContent = target.toLocaleString() + "+";
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
      el.textContent = target.toLocaleString() + "+";
      clearInterval(timer);
    } else {
      el.textContent = Math.floor(current).toLocaleString() + "+";
    }
  }, stepTime);
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const { data } = await getPublicStats();
    const map = {
      "stat-users": data.users,
      "stat-resources": data.resources,
      "stat-pending": data.pending,
      "stat-terms": data.terms
    };
    Object.entries(map).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) animateCount(el, Number(value) || 0);
    });
  } catch (err) {
    console.error("Failed to load public statistics:", err);
    ["stat-users", "stat-resources", "stat-pending", "stat-terms"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = "—";
    });
  }
});
