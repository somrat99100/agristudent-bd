// Remove legacy client-side identity cache keys.
try { localStorage.removeItem("agri_session_v1"); sessionStorage.removeItem("agri_student_id"); localStorage.removeItem("agri_handnotes_user_email"); } catch {}

// Firebase Authentication is the security boundary.
// Only non-sensitive UI state is cached locally; email and Student ID are never persisted.
import { auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const SESSION_KEY = "agri_session_v2";
let authUser = null;
let authStateKnown = false;
let resolveReady;
export const authReady = new Promise(resolve => { resolveReady = resolve; });

onAuthStateChanged(auth, user => {
  authUser = user;
  if (typeof window !== "undefined") window.__agriAuthUid = user?.uid || "";
  authStateKnown = true;
  resolveReady(user);
});

export function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || !parsed.regId) return null;
    return {
      regId: parsed.regId,
      fullName: authUser?.displayName || "",
      gender: "",
      avatarUrl: parsed.avatarUrl || "",
      status: "verified",
      email: authUser?.email || ""
    };
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export async function ensureStudentAuth() {
  await authReady;
  const user = authUser || auth.currentUser;
  if (!user || !user.emailVerified) return null;
  const session = getSession();
  if (!session) return null;
  try {
    const tokenResult = await user.getIdTokenResult();
    if (tokenResult.claims?.student !== true || tokenResult.claims?.regId !== session.regId) {
      clearSession();
      await signOut(auth).catch(() => {});
      return null;
    }
    return user;
  } catch {
    clearSession();
    return null;
  }
}

export function saveSession({ regId, fullName, avatarUrl }) {
  const session = { regId, avatarUrl: avatarUrl || "" };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  // Firebase Auth owns the account identity. Persisting only the opaque registration ID
  // avoids putting email, Student ID, gender, or other sensitive identity data in Web Storage; the avatar URL is non-sensitive UI state.
  return {
    regId,
    fullName: fullName || auth.currentUser?.displayName || "",
    gender: "",
    avatarUrl: session.avatarUrl || "",
    status: "verified",
    email: auth.currentUser?.email || ""
  };
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  try {
    sessionStorage.removeItem("agri_student_id");
    localStorage.removeItem("agri_handnotes_user_email");
  } catch {}
}

async function renderAuthSlot() {
  const slot = document.getElementById("navbar-auth-slot");
  if (!slot) return;
  const user = await ensureStudentAuth();
  const session = getSession();
  if (!user || !session) {
    slot.innerHTML = `<a href="login.html" class="navbar-auth-login">Login</a>`;
    return;
  }
  const displayName = (session.fullName || user.email || "Student").split(" ")[0];
  slot.innerHTML = `
    <a href="profile.html" class="navbar-auth-profile" title="${String(session.fullName || user.email || "").replace(/"/g, '&quot;')}">
      <img src="${String(session.avatarUrl || 'assets/avatar-male.svg').replace(/"/g, '&quot;')}" alt="" class="navbar-auth-avatar">
      <span>${String(displayName).replace(/[&<>]/g, '')}</span>
    </a>
    <button type="button" class="navbar-auth-logout" id="navbar-logout-btn">Logout</button>
  `;
  document.getElementById("navbar-logout-btn")?.addEventListener("click", async () => {
    await signOut(auth);
    clearSession();
    window.location.href = "index.html";
  });
}

function whenNavbarReady(fn) {
  if (window.__navbarLoaded) fn();
  else (window.__onNavbarReady = window.__onNavbarReady || []).push(fn);
}
whenNavbarReady(renderAuthSlot);
