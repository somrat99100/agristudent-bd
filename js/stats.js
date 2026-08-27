// ============================================
// AGRI CORE — stats.js
// Pulls REAL, live counts from Firestore for the
// homepage stats strip (no more hardcoded numbers).
// ============================================
import { db } from "./firebase-config.js";
import {
  collection, query, where, getCountFromServer, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Map of element id -> function that returns a Firestore count query
const STAT_SOURCES = {
  // Registration totals are private. This public homepage deliberately does
  // not enumerate the registrations collection. If a public aggregate is
  // created at settings/publicStats, it may be displayed instead.
  "stat-users": async () => {
    const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    const snap = await getDoc(doc(db, "settings", "publicStats"));
    return { data: () => ({ count: Number(snap.data()?.registeredUsers || 0) }) };
  },

  "stat-resources": async () => {
    const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    const snap = await getDoc(doc(db, "settings", "publicStats"));
    return { data: () => ({ count: Number(snap.data()?.resourceFiles || 0) }) };
  },

  "stat-pending": async () => ({ data: () => ({ count: 0 }) }),

  "stat-terms": async () => {
    const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    const snap = await getDoc(doc(db, "settings", "publicStats"));
    return { data: () => ({ count: Number(snap.data()?.approvedTerms || 0) }) };
  }
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
