import { auth, db } from "./firebase-config.js";
import { signInWithEmailAndPassword, signOut, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { saveSession, clearSession } from "./session.js";

const form = document.getElementById("login-form");
const submitBtn = document.getElementById("login-submit");
const statusBox = document.getElementById("login-status");

function showStatus(msg, isError = false) {
  statusBox.textContent = msg;
  statusBox.style.color = isError ? "var(--terracotta-500)" : "var(--moss-600)";
  statusBox.classList.remove("hidden");
}

form.addEventListener("submit", async e => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim().toLowerCase();
  const password = document.getElementById("login-password").value;
  if (!email || !password) return showStatus("Please enter your email and password.", true);

  submitBtn.disabled = true;
  submitBtn.textContent = "Signing in…";
  showStatus("Signing in…");

  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    if (!cred.user.emailVerified) {
      await signOut(auth);
      showStatus("Please verify your email before using the student portal.", true);
      return;
    }

    const token = await cred.user.getIdTokenResult(true);
    if (token.claims?.student !== true || typeof token.claims?.regId !== "string") {
      await signOut(auth);
      clearSession();
      showStatus("This account is not configured as a student account.", true);
      return;
    }

    const snap = await getDoc(doc(db, "registrations", token.claims.regId));
    if (!snap.exists()) {
      await signOut(auth);
      clearSession();
      showStatus("Your student profile could not be found. Please contact the administrator.", true);
      return;
    }

    const reg = snap.data();
    saveSession({
      regId: token.claims.regId,
      fullName: reg.fullName,
      gender: reg.gender,
      avatarUrl: reg.avatarUrl,
      status: reg.status || "verified"
    });
    window.location.replace("profile.html");
  } catch (err) {
    console.error("[Login] failed:", err);
    const code = err?.code || "";
    showStatus(
      code === "auth/too-many-requests"
        ? "Too many attempts. Please wait and try again later."
        : "Invalid email or password.",
      true
    );
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Log In";
  }
});

document.getElementById("forgot-password")?.addEventListener("click", async () => {
  const email = document.getElementById("login-email").value.trim().toLowerCase();
  if (!email) return showStatus("Enter your email address first.", true);
  try {
    await sendPasswordResetEmail(auth, email);
    showStatus("If an account exists for that email, a password-reset email has been sent.");
  } catch (err) {
    console.error("[Password reset]", err);
    // Do not reveal whether an email is registered.
    showStatus("If an account exists for that email, a password-reset email has been sent.");
  }
});
