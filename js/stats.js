// ============================================
// AGRISTUDENT BD — stats.js
// Pulls REAL, live counts from Firestore for the
// homepage stats strip (no more hardcoded numbers).
// ============================================
import { db } from "./firebase-config.js";
import {
  collection, query, where, getCountFromServer
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Map of element id -> function that returns a Firestore count query
const STAT_SOURCES = {
  "stat-users": () =>
    getCountFromServer(collection(db, "registrations")),

  "stat-resources": () =>
    getCountFromServer(query(collection(db, "resources"), where("status", "==", "approved"))),

  "stat-suggestions": () =>
    getCountFromServer(query(
      collection(db, "resources"),
      where("status", "==", "approved"),
      where("resourceType", "==", "previous_questions")
    )),

  "stat-terms": () =>
    getCountFromServer(query(collection(db, "terms"), where("status", "==", "approved")))
};

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
  await Promise.all(
    Object.entries(STAT_SOURCES).map(async ([id, getCount]) => {
      const el = document.getElementById(id);
      if (!el) return;
      try {
        const snap = await getCount();
        animateCount(el, snap.data().count);
      } catch (err) {
        console.error(`Failed to load live stat for #${id}:`, err);
        el.textContent = "—";
      }
    })
  );
});
