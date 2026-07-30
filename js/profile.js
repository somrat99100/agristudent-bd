import { db } from "./firebase-config.js";
import {
  doc, getDoc, collection, query, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { normalizeEmail } from "./identity.js";
import { getSession, saveSession, clearSession } from "./session.js";

function esc(val) {
  return String(val ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

const loadingEl = document.getElementById("profile-loading");
const contentEl = document.getElementById("profile-content");
const loggedOutEl = document.getElementById("profile-logged-out");

function showLoggedOut() {
  loadingEl.classList.add("hidden");
  contentEl.classList.add("hidden");
  loggedOutEl.classList.remove("hidden");
}

async function init() {
  const session = getSession();
  if (!session) { showLoggedOut(); return; }

  try {
    // Re-fetch the live registration record rather than trusting the
    // cached session — status can change (admin verifies/rejects) after
    // login, and this keeps the profile accurate.
    const regSnap = await getDoc(doc(db, "registrations", session.regId));
    if (!regSnap.exists()) {
      clearSession();
      showLoggedOut();
      return;
    }
    const reg = regSnap.data();
    // Keep the local session in sync with any status change.
    saveSession({
      regId: session.regId,
      fullName: reg.fullName,
      email: reg.email,
      studentIdNumber: reg.studentIdNumber,
      gender: reg.gender,
      avatarUrl: reg.avatarUrl,
      status: reg.status || "unverified"
    });

    renderIdentity(reg);
    await renderCredits(normalizeEmail(reg.email));

    loadingEl.classList.add("hidden");
    contentEl.classList.remove("hidden");
  } catch (err) {
    console.error("[Profile] failed to load:", err);
    loadingEl.textContent = "Something went wrong loading your profile. Please try again.";
  }
}

function renderIdentity(reg) {
  document.getElementById("profile-avatar").src = reg.avatarUrl || (reg.gender === "female" ? "assets/avatar-female.svg" : "assets/avatar-male.svg");
  document.getElementById("profile-name").textContent = reg.fullName || "—";
  document.getElementById("profile-email").textContent = reg.email || "—";
  document.getElementById("profile-studentid").textContent = reg.studentIdNumber || "—";

  const status = reg.status || "unverified";
  const pill = document.getElementById("profile-status-pill");
  const note = document.getElementById("profile-status-note");
  const labels = { verified: "✅ Verified", unverified: "🕓 Unverified", rejected: "❌ Rejected" };
  pill.textContent = labels[status] || status;
  pill.className = "profile-status-pill " + status;

  if (status !== "verified") {
    note.classList.remove("hidden");
    note.innerHTML = status === "rejected"
      ? `<p>Your registration was rejected. Please <a href="register.html" style="color:var(--leaf-500);font-weight:600;">register again</a> with correct details.</p>`
      : `<p>Your registration is still awaiting admin review — this usually takes 24–48 hours. You'll get full access once verified.</p>`;
  } else {
    note.classList.add("hidden");
  }
}

async function renderCredits(email) {
  const [resourcesSnap, termsSnap] = await Promise.all([
    getDocs(query(collection(db, "resources"), where("uploaderEmail", "==", email))),
    getDocs(query(collection(db, "terms"), where("uploaderEmail", "==", email)))
  ]);

  const items = [
    ...resourcesSnap.docs.map(d => ({ id: d.id, kind: "resource", ...d.data() })),
    ...termsSnap.docs.map(d => ({ id: d.id, kind: "term", ...d.data() }))
  ].sort((a, b) => (b.submittedAt?.toDate?.() || 0) - (a.submittedAt?.toDate?.() || 0));

  const approved = items.filter(i => i.status === "approved").length;
  const pending = items.filter(i => (i.status || "pending") === "pending").length;
  const rejected = items.filter(i => i.status === "rejected").length;

  document.getElementById("stat-total").textContent = items.length;
  document.getElementById("stat-approved").textContent = approved;
  document.getElementById("stat-pending").textContent = pending;
  document.getElementById("stat-rejected").textContent = rejected;

  const listEl = document.getElementById("uploads-list");
  const emptyEl = document.getElementById("uploads-empty");

  if (items.length === 0) {
    listEl.innerHTML = "";
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  listEl.innerHTML = items.map(item => {
    const status = item.status || "pending";
    const title = item.kind === "term"
      ? `📖 ${esc(item.name || "Untitled term")}`
      : `📄 ${esc(item.courseCode || "Unknown course")} — ${esc(item.resourceType === "previous_questions" ? "Previous Questions" : "Slides/Notes")}`;
    const date = item.submittedAt?.toDate?.()?.toLocaleDateString?.() || "";
    return `
      <div class="upload-row">
        <div>
          <div style="font-weight:600;font-size:.92rem;">${title}</div>
          <div style="font-size:.75rem;color:var(--moss-600);">${date}</div>
        </div>
        <span class="status-tag ${esc(status)}">${status === "approved" ? "✅ Approved" : status === "rejected" ? "❌ Rejected" : "⏳ Pending"}</span>
      </div>`;
  }).join("");
}

const logoutBtn = document.getElementById("profile-logout-btn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    clearSession();
    window.location.href = "index.html";
  });
}

init();
