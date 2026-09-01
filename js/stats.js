// ============================================
// AGRISTUDENT BD — stats.js
// Pulls REAL, live counts from Firestore for the
// homepage stats strip (no more hardcoded numbers).
// ============================================
import { db } from "./firebase-config.js";
import {
  collection, query, where, getCountFromServer, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Map of element id -> function that returns a Firestore count query
const STAT_SOURCES = {
  "stat-users": () =>
    getCountFromServer(collection(db, "registrations")),

  "stat-resources": async () => {
    // Count actual approved PDF + Presentation files, not Firestore
    // resource/folder documents. A single submission containing 4 files
    // therefore contributes 4 to the homepage count.
    const snap = await getCountFromServer(query(collection(db, "resources"), where("status", "==", "approved")));
    // getCountFromServer cannot count nested array items, so fetch the
    // approved entries separately and sum only PDF/PPT(PPTX) files.
    const docsSnap = await getDocs(
      query(collection(db, "resources"), where("status", "==", "approved"))
    );
    let total = 0;
    docsSnap.forEach(d => {
      const item = d.data();
      const files = Array.isArray(item.fileUrls) ? item.fileUrls : [];
      total += files.filter(f => {
        const name = String(f?.name || "").toLowerCase();
        const type = String(item.fileType || "").toLowerCase();
        return type === "pdf" || type === "ppt" ||
          /\.(pdf|ppt|pptx)$/i.test(name);
      }).length;
    });
    return { data: () => ({ count: total }) };
  },

  "stat-pending": () =>
    getCountFromServer(query(collection(db, "resources"), where("status", "==", "pending"))),

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
