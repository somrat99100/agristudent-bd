// ============================================
// STUDENT SESSION (login/logout)
//
// ⚠️ Same trust model as the rest of the site (see js/auth-guard.js and
// firestore.rules): students never had a password-based account here,
// only a registration record. This session is a convenience layer on
// top of that record — it remembers WHICH registration you are, so you
// don't have to retype your Student ID / email on every page. It is
// NOT a security boundary; real access control is Firestore Security
// Rules, unchanged by this file.
//
// Session is stored in localStorage (persists across tabs/visits) as a
// single JSON blob under SESSION_KEY.
// ============================================
import { normalizeEmail, normalizeStudentId } from "./identity.js";
import { db } from "./firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const SESSION_KEY = "agri_session_v1";

export function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.email || !parsed.regId) return null;
    return parsed;
  } catch (err) {
    console.warn("[Session] corrupt session data, clearing.", err);
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function saveSession({ regId, fullName, email, studentIdNumber, gender, avatarUrl, status }) {
  const session = {
    regId,
    fullName: fullName || "",
    email: normalizeEmail(email),
    studentIdNumber: normalizeStudentId(studentIdNumber),
    gender: gender || "",
    avatarUrl: avatarUrl || (gender === "female" ? "assets/avatar-female.svg" : "assets/avatar-male.svg"),
    status: status || "unverified"
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));

  // Keep the pre-existing resource-gate caches in sync so resources.html /
  // slides-notes.html / previous-questions.html immediately recognize this
  // student without asking them to re-enter anything (also fixes stale
  // mismatched values left over from before login existed).
  try {
    sessionStorage.setItem("agri_student_id", session.studentIdNumber);
    localStorage.setItem("agri_handnotes_user_email", session.email);
  } catch (err) { /* storage unavailable — non-fatal */ }

  return session;
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  try {
    sessionStorage.removeItem("agri_student_id");
    localStorage.removeItem("agri_handnotes_user_email");
  } catch (err) { /* storage unavailable — non-fatal */ }
}

// ============================================
// NAVBAR AUTH SLOT
// Renders "👤 Name" + Logout when logged in, or a Login link when not.
// Runs once the shared navbar has actually been injected into the page
// (navbar-loader.js calls whenNavbarReady's queued callbacks) so this
// never races the fetch("navbar.html") injection.
// ============================================
function renderAuthSlot() {
  const slot = document.getElementById("navbar-auth-slot");
  if (!slot) return;
  const session = getSession();

  if (!session) {
    slot.innerHTML = `<a href="register.html" class="navbar-auth-register">Register Now</a><a href="login.html" class="navbar-auth-login">Login</a>`;
    return;
  }

  const displayName = (session.fullName || session.email).split(" ")[0];
  slot.innerHTML = `
    <a href="profile.html" class="navbar-auth-profile" title="${session.fullName || session.email}">
      <img src="${session.avatarUrl}" alt="" class="navbar-auth-avatar">
      <span>${displayName}</span>
    </a>
    <button type="button" class="navbar-auth-logout" id="navbar-logout-btn">Logout</button>
  `;

  const logoutBtn = document.getElementById("navbar-logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      clearSession();
      window.location.href = "index.html";
    });
  }
}

function whenNavbarReady(fn) {
  if (window.__navbarLoaded) fn();
  else (window.__onNavbarReady = window.__onNavbarReady || []).push(fn);
}

whenNavbarReady(renderAuthSlot);

// ============================================
// ACCOUNT RESTRICTION — SITE-WIDE FREEZE SCREEN
// Admin can restrict a misbehaving account for a set number of days
// (registrations/{regId}.accountRestrictedUntil + accountRestrictedReason).
// Every page that imports session.js checks this on load and, if active,
// covers the page with a freeze overlay instead of the normal content.
// The admin panel itself (admin.html) is exempt so admins can still work.
// ============================================
function formatRestrictionDate(ms) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${d.getFullYear()}`;
}

function showAccountFreezeScreen(untilMs, reason) {
  if (document.getElementById("account-freeze-overlay")) return;
  const daysLeft = Math.max(1, Math.ceil((untilMs - Date.now()) / (24 * 60 * 60 * 1000)));
  const overlay = document.createElement("div");
  overlay.id = "account-freeze-overlay";
  overlay.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(31,46,34,.96);display:flex;align-items:center;justify-content:center;padding:1.5rem;text-align:center;";
  overlay.innerHTML = `
    <div style="max-width:420px;background:#fff;border-radius:18px;padding:2rem 1.6rem;">
      <div style="font-size:2.2rem;margin-bottom:.6rem;">🚫</div>
      <h2 style="font-family:var(--font-display, serif);font-size:1.3rem;margin-bottom:.6rem;">You are restricted for ${daysLeft} day${daysLeft === 1 ? "" : "s"}</h2>
      <p style="color:var(--moss-600,#5b6f57);font-size:.9rem;margin-bottom:.4rem;">Restriction ends on <strong>${formatRestrictionDate(untilMs)}</strong>.</p>
      ${reason ? `<p style="color:var(--moss-600,#5b6f57);font-size:.85rem;margin-bottom:1rem;">Reason: ${reason}</p>` : `<div style="margin-bottom:1rem;"></div>`}
      <p style="color:var(--moss-600,#5b6f57);font-size:.85rem;margin-bottom:1.2rem;">If you believe this is a mistake, please contact admin.</p>
      <a href="help.html" style="display:inline-block;background:var(--leaf-500,#6b9b5e);color:#fff;font-weight:700;padding:.75rem 1.4rem;border-radius:999px;text-decoration:none;">💬 Contact Admin / Help</a>
    </div>`;
  document.documentElement.appendChild(overlay);
  document.body.style.overflow = "hidden";
}

async function checkAccountRestriction() {
  // Admins reviewing/managing the site must never be locked out by this.
  if (/\/?admin\.html/.test(window.location.pathname)) return;
  const session = getSession();
  if (!session || !session.regId) return;
  try {
    const snap = await getDoc(doc(db, "registrations", session.regId));
    if (!snap.exists()) return;
    const reg = snap.data();
    const until = reg.accountRestrictedUntil?.toDate?.()?.getTime?.() || Number(reg.accountRestrictedUntil) || 0;
    if (until && until > Date.now()) {
      showAccountFreezeScreen(until, reg.accountRestrictedReason || "");
    }
  } catch (err) {
    console.error("[Session] account restriction check failed:", err);
  }
}

checkAccountRestriction();
