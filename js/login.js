import { db } from "./firebase-config.js";
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { normalizeEmail, normalizeStudentId } from "./identity.js";
import { getSession, saveSession } from "./session.js";

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

const form = document.getElementById("login-form");
const submitBtn = document.getElementById("login-submit");
const statusBox = document.getElementById("login-status");

function showStatus(msg, isError = false) {
  statusBox.textContent = msg;
  statusBox.style.color = isError ? "var(--terracotta-500)" : "var(--moss-600)";
  statusBox.classList.remove("hidden");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = normalizeEmail(document.getElementById("login-email").value);
  const studentId = normalizeStudentId(document.getElementById("login-studentId").value);

  if (!email || !studentId) {
    showStatus("Please fill in both fields.", true);
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Checking…";
  showStatus("Looking up your registration…");

  try {
    // Look up by email first (normalized, so this matches regardless of
    // how the student originally typed the casing during registration —
    // registration.js normalizes on save, but this also tolerates any
    // older records saved before that fix).
    const q = query(collection(db, "registrations"), where("email", "==", email));
    const snap = await getDocs(q);

    if (snap.empty) {
      showStatus("❌ No account found for that email. Please register first.", true);
      submitBtn.disabled = false;
      submitBtn.textContent = "Log In";
      return;
    }

    // An email could in theory have multiple registration attempts; match
    // the one whose Student ID (normalized) matches what was typed.
    const match = snap.docs.find(d => normalizeStudentId(d.data().studentIdNumber) === studentId);

    if (!match) {
      showStatus("❌ That Student ID doesn't match this email. Please check both fields.", true);
      submitBtn.disabled = false;
      submitBtn.textContent = "Log In";
      return;
    }

    const reg = match.data();
    saveSession({
      regId: match.id,
      fullName: reg.fullName,
      email: reg.email,
      studentIdNumber: reg.studentIdNumber,
      gender: reg.gender,
      avatarUrl: reg.avatarUrl,
      status: reg.status || "unverified"
    });

    showStatus("✅ Logged in! Redirecting…");
    setTimeout(() => { window.location.href = destinationAfterLogin(); }, 500);
  } catch (err) {
    console.error("[Login] failed:", err);
    showStatus("Something went wrong. Please try again.", true);
    submitBtn.disabled = false;
    submitBtn.textContent = "Log In";
  }
});
