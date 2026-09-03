import { db } from "./firebase-config.js";
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { normalizeEmail, normalizeStudentId } from "./identity.js";
import { getSession, saveSession } from "./session.js";
import { signInWithPassword, friendlyAuthError } from "./password-auth.js";

// Supports an optional ?return=page.html so flows like the Hand Notes
// unlock gate can send the person to log in and land right back where
// they started, instead of always bouncing to the profile page.
const returnTo = new URLSearchParams(window.location.search).get("return");
function destinationAfterLogin() {
  if (returnTo && returnTo.startsWith("/") === false && !returnTo.includes("://")) return returnTo;
  return "profile.html";
}

// Already logged in? Skip the form and go straight to the destination.
if (getSession()) {
  window.location.replace(destinationAfterLogin());
}

function sessionFromReg(regId, reg) {
  return saveSession({
    regId,
    fullName: reg.fullName,
    email: reg.email,
    studentIdNumber: reg.studentIdNumber,
    gender: reg.gender,
    avatarUrl: reg.avatarUrl,
    status: reg.status || "unverified"
  });
}

// ============================================
// PANEL SWITCHING — Student ID+password (default) <-> legacy email+ID
// ============================================
const passwordPanel = document.getElementById("login-panel-password");
const legacyPanel = document.getElementById("login-panel-legacy");

document.getElementById("show-legacy-login")?.addEventListener("click", () => {
  passwordPanel.classList.add("hidden");
  legacyPanel.classList.remove("hidden");
});
document.getElementById("show-password-login")?.addEventListener("click", () => {
  legacyPanel.classList.add("hidden");
  passwordPanel.classList.remove("hidden");
});

document.getElementById("login-password-toggle")?.addEventListener("click", (e) => {
  const input = document.getElementById("login-password");
  const showing = input.type === "text";
  input.type = showing ? "password" : "text";
  e.currentTarget.textContent = showing ? "👁️" : "🙈";
});

// ============================================
// PRIMARY LOGIN — Student ID + Password
// ============================================
const form = document.getElementById("login-form");
const submitBtn = document.getElementById("login-submit");
const statusBox = document.getElementById("login-status");

function showStatus(msg, isError = false) {
  statusBox.textContent = msg;
  statusBox.style.color = isError ? "var(--terracotta-500)" : "var(--moss-600)";
  statusBox.classList.remove("hidden");
}

form?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const studentId = normalizeStudentId(document.getElementById("login-studentId").value);
  const password = document.getElementById("login-password").value;

  if (!studentId || !password) {
    showStatus("Please fill in both fields.", true);
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Checking…";
  showStatus("Looking up your registration…");

  try {
    const q = query(collection(db, "registrations"), where("studentIdNumber", "==", studentId));
    const snap = await getDocs(q);

    if (snap.empty) {
      showStatus("❌ No account found for that Student ID. Please register first.", true);
      submitBtn.disabled = false;
      submitBtn.textContent = "Log In";
      return;
    }

    const match = snap.docs[0];
    const reg = match.data();

    if (!reg.passwordSet) {
      showStatus("This account hasn't set up a password yet. Use \"Log in with email instead\" below, then set a password from your Profile.", true);
      submitBtn.disabled = false;
      submitBtn.textContent = "Log In";
      return;
    }

    try {
      await signInWithPassword(reg.email, password);
    } catch (authErr) {
      console.error("[Login] Firebase Auth sign-in failed:", authErr);
      showStatus("❌ " + friendlyAuthError(authErr), true);
      submitBtn.disabled = false;
      submitBtn.textContent = "Log In";
      return;
    }

    sessionFromReg(match.id, reg);
    showStatus("✅ Logged in! Redirecting…");
    setTimeout(() => { window.location.href = destinationAfterLogin(); }, 500);
  } catch (err) {
    console.error("[Login] failed:", err);
    showStatus("Something went wrong. Please try again.", true);
    submitBtn.disabled = false;
    submitBtn.textContent = "Log In";
  }
});

// ============================================
// LEGACY LOGIN — Email + Student ID (no password yet)
// ============================================
const legacyForm = document.getElementById("login-legacy-form");
const legacySubmitBtn = document.getElementById("login-legacy-submit");
const legacyStatusBox = document.getElementById("login-legacy-status");

function showLegacyStatus(msg, isError = false) {
  legacyStatusBox.textContent = msg;
  legacyStatusBox.style.color = isError ? "var(--terracotta-500)" : "var(--moss-600)";
  legacyStatusBox.classList.remove("hidden");
}

legacyForm?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = normalizeEmail(document.getElementById("login-email").value);
  const studentId = normalizeStudentId(document.getElementById("login-studentId-legacy").value);

  if (!email || !studentId) {
    showLegacyStatus("Please fill in both fields.", true);
    return;
  }

  legacySubmitBtn.disabled = true;
  legacySubmitBtn.textContent = "Checking…";
  showLegacyStatus("Looking up your registration…");

  try {
    const q = query(collection(db, "registrations"), where("email", "==", email));
    const snap = await getDocs(q);

    if (snap.empty) {
      showLegacyStatus("❌ No account found for that email. Please register first.", true);
      legacySubmitBtn.disabled = false;
      legacySubmitBtn.textContent = "Log In";
      return;
    }

    const match = snap.docs.find(d => normalizeStudentId(d.data().studentIdNumber) === studentId);

    if (!match) {
      showLegacyStatus("❌ That Student ID doesn't match this email. Please check both fields.", true);
      legacySubmitBtn.disabled = false;
      legacySubmitBtn.textContent = "Log In";
      return;
    }

    const reg = match.data();
    sessionFromReg(match.id, reg);

    showLegacyStatus("✅ Logged in! Redirecting…");
    setTimeout(() => {
      window.location.href = destinationAfterLogin();
    }, 500);
  } catch (err) {
    console.error("[Login] legacy login failed:", err);
    showLegacyStatus("Something went wrong. Please try again.", true);
    legacySubmitBtn.disabled = false;
    legacySubmitBtn.textContent = "Log In";
  }
});
