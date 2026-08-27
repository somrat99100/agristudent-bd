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
import { auth } from "./firebase-config.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

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

export function saveSession({ uid, regId, fullName, email, studentIdNumber, gender, avatarUrl, status }) {
  const session = {
    uid: uid || regId,
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
  try { signOut(auth).catch(() => {}); } catch (err) {}
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
    slot.innerHTML = `<a href="login.html" class="navbar-auth-login">Login</a>`;
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
