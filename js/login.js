import { db } from "./firebase-config.js";
import { collection, query, where, getDocs, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { normalizeEmail, normalizeStudentId } from "./identity.js";
import { getSession, saveSession } from "./session.js";
import { hashPassword, isPasswordValid } from "./password.js";
import { initEmailNotifications, sendOtpEmail, sendCredentialsEmail } from "./email-config.js";
import { startOtp, verifyOtp, resendCooldownRemaining, clearOtp } from "./otp.js";

initEmailNotifications();

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

function maskEmail(email) {
  const [name, domain] = String(email || "").split("@");
  if (!domain) return email || "";
  const visible = name.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(1, name.length - visible.length))}@${domain}`;
}

async function findRegistrationByStudentId(studentId) {
  const q = query(collection(db, "registrations"), where("studentIdNumber", "==", studentId));
  const snap = await getDocs(q);
  // A Student ID could in theory match more than one legacy record (before
  // the one-account-per-ID check existed) — prefer one that isn't removed.
  const active = snap.docs.find(d => !d.data().removed) || snap.docs[0];
  return active || null;
}

function loginToSession(regDoc) {
  const reg = regDoc.data();
  saveSession({
    regId: regDoc.id,
    fullName: reg.fullName,
    email: reg.email,
    studentIdNumber: reg.studentIdNumber,
    gender: reg.gender,
    avatarUrl: reg.avatarUrl,
    status: reg.status || "unverified"
  });
}

// ============================================
// STEP VISIBILITY HELPERS
// ============================================
const steps = {
  login: document.getElementById("login-step"),
  resetRequest: document.getElementById("reset-request-step"),
  resetOtp: document.getElementById("reset-otp-step"),
  resetPassword: document.getElementById("reset-password-step"),
  resetDone: document.getElementById("reset-done-step")
};
function showStep(name) {
  Object.entries(steps).forEach(([key, el]) => el.classList.toggle("hidden", key !== name));
}

// ============================================
// STEP 1 — Student ID + Password login
// ============================================
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

  const studentId = normalizeStudentId(document.getElementById("login-studentId").value);
  const password = document.getElementById("login-password").value;

  if (!studentId || !password) {
    showStatus("Please fill in both fields.", true);
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Checking…";
  showStatus("Looking up your account…");

  try {
    const match = await findRegistrationByStudentId(studentId);

    if (!match) {
      showStatus("❌ No account found for that Student ID. Please register first.", true);
      return;
    }

    const reg = match.data();

    if (reg.removed) {
      showStatus("❌ This account has been removed by an admin. If you believe this is a mistake, please contact us via the Help page.", true);
      return;
    }

    if (!reg.passwordHash) {
      showStatus("This account doesn't have a password set up yet.", true);
      pendingResetStudentId = studentId;
      document.getElementById("reset-studentId").value = studentId;
      showStep("resetRequest");
      return;
    }

    const enteredHash = await hashPassword(password, reg.email);
    if (enteredHash !== reg.passwordHash) {
      showStatus("❌ Incorrect password.", true);
      return;
    }

    loginToSession(match);
    showStatus("✅ Logged in! Redirecting…");
    setTimeout(() => { window.location.href = destinationAfterLogin(); }, 500);
  } catch (err) {
    console.error("[Login] failed:", err);
    showStatus("Something went wrong. Please try again.", true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Log In";
  }
});

// ============================================
// RESET / FIRST-TIME SETUP FLOW
// Used both when login detects an account with no passwordHash yet
// (legacy pre-password account) AND for "Forgot password?" — both cases
// need the same thing: prove you own the registered email, then set a
// new password.
// ============================================
let pendingResetStudentId = "";
let pendingResetReg = null; // { id, data }

document.getElementById("forgot-password-link").addEventListener("click", (e) => {
  e.preventDefault();
  document.getElementById("reset-studentId").value = "";
  showStep("resetRequest");
});
document.getElementById("reset-back-to-login").addEventListener("click", (e) => {
  e.preventDefault();
  showStep("login");
});
document.getElementById("reset-otp-back").addEventListener("click", (e) => {
  e.preventDefault();
  showStep("resetRequest");
});

const resetRequestBtn = document.getElementById("reset-request-btn");
const resetRequestStatus = document.getElementById("reset-request-status");
function showResetRequestStatus(msg, isError = false) {
  resetRequestStatus.textContent = msg;
  resetRequestStatus.style.color = isError ? "var(--terracotta-500)" : "var(--moss-600)";
}

resetRequestBtn.addEventListener("click", async () => {
  const studentId = normalizeStudentId(document.getElementById("reset-studentId").value);
  if (!studentId) {
    showResetRequestStatus("Please enter your Student ID.", true);
    return;
  }

  resetRequestBtn.disabled = true;
  resetRequestBtn.textContent = "Checking…";
  showResetRequestStatus("Looking up your account…");

  try {
    const match = await findRegistrationByStudentId(studentId);
    if (!match) {
      showResetRequestStatus("❌ No account found for that Student ID.", true);
      return;
    }
    const reg = match.data();
    if (reg.removed) {
      showResetRequestStatus("❌ This account has been removed by an admin.", true);
      return;
    }
    pendingResetReg = { id: match.id, data: reg };

    resetRequestBtn.textContent = "Sending code…";
    showResetRequestStatus("Sending a verification code…");
    const { code } = startOtp(reg.email);
    await sendOtpEmail({ toEmail: reg.email, toName: reg.fullName, otpCode: code });

    document.getElementById("reset-otp-sent-to").textContent =
      `We sent a 6-digit code to ${maskEmail(reg.email)}. It expires in 10 minutes.`;
    document.getElementById("reset-otp-code").value = "";
    showResetOtpStatus("");
    showStep("resetOtp");
  } catch (err) {
    console.error(err);
    showResetRequestStatus("Couldn't send the verification code. (" + err.message + ")", true);
  } finally {
    resetRequestBtn.disabled = false;
    resetRequestBtn.textContent = "Send Code";
  }
});

const resetOtpInput = document.getElementById("reset-otp-code");
const resetOtpVerifyBtn = document.getElementById("reset-otp-verify-btn");
const resetOtpStatus = document.getElementById("reset-otp-status");
const resetOtpResendBtn = document.getElementById("reset-otp-resend-btn");

function showResetOtpStatus(msg, isError = false) {
  resetOtpStatus.textContent = msg;
  resetOtpStatus.style.color = isError ? "var(--terracotta-500)" : "var(--moss-600)";
}

resetOtpInput.addEventListener("input", () => {
  resetOtpInput.value = resetOtpInput.value.replace(/\D/g, "").slice(0, 6);
});
resetOtpInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); resetOtpVerifyBtn.click(); }
});

resetOtpVerifyBtn.addEventListener("click", () => {
  if (!pendingResetReg) { showStep("resetRequest"); return; }
  const code = resetOtpInput.value.trim();
  if (!/^\d{6}$/.test(code)) {
    showResetOtpStatus("Enter the 6-digit code from your email.", true);
    return;
  }
  const result = verifyOtp(pendingResetReg.data.email, code);
  if (!result.ok) {
    if (result.reason === "expired") showResetOtpStatus("That code expired. Please request a new one.", true);
    else if (result.reason === "locked") showResetOtpStatus("Too many incorrect attempts. Please request a new code.", true);
    else if (result.reason === "mismatch") showResetOtpStatus(`Incorrect code. ${result.attemptsLeft} attempt(s) left.`, true);
    else showResetOtpStatus("Please request a new code.", true);
    return;
  }
  clearOtp();
  document.getElementById("reset-new-password").value = "";
  document.getElementById("reset-new-password-confirm").value = "";
  showResetPasswordStatus("");
  showStep("resetPassword");
});

resetOtpResendBtn.addEventListener("click", async () => {
  if (!pendingResetReg) return;
  const remaining = resendCooldownRemaining(pendingResetReg.data.email);
  if (remaining > 0) {
    showResetOtpStatus(`Please wait ${Math.ceil(remaining / 1000)}s before resending.`, true);
    return;
  }
  resetOtpResendBtn.disabled = true;
  showResetOtpStatus("Resending code…");
  try {
    const { code } = startOtp(pendingResetReg.data.email);
    await sendOtpEmail({ toEmail: pendingResetReg.data.email, toName: pendingResetReg.data.fullName, otpCode: code });
    showResetOtpStatus("A new code has been sent.");
  } catch (err) {
    console.error(err);
    showResetOtpStatus("Couldn't resend the code. (" + err.message + ")", true);
  } finally {
    resetOtpResendBtn.disabled = false;
  }
});

const resetPasswordSubmitBtn = document.getElementById("reset-password-submit-btn");
const resetPasswordStatus = document.getElementById("reset-password-status");
function showResetPasswordStatus(msg, isError = false) {
  resetPasswordStatus.textContent = msg;
  resetPasswordStatus.style.color = isError ? "var(--terracotta-500)" : "var(--moss-600)";
}

resetPasswordSubmitBtn.addEventListener("click", async () => {
  if (!pendingResetReg) { showStep("resetRequest"); return; }

  const password = document.getElementById("reset-new-password").value;
  const confirm = document.getElementById("reset-new-password-confirm").value;

  if (!isPasswordValid(password)) {
    showResetPasswordStatus("Password must be at least 6 characters.", true);
    return;
  }
  if (password !== confirm) {
    showResetPasswordStatus("Passwords don't match.", true);
    return;
  }

  resetPasswordSubmitBtn.disabled = true;
  resetPasswordSubmitBtn.textContent = "Saving…";
  showResetPasswordStatus("Saving your new password…");

  try {
    const { id, data: reg } = pendingResetReg;
    const passwordHash = await hashPassword(password, reg.email);
    await updateDoc(doc(db, "registrations", id), { passwordHash });

    sendCredentialsEmail({ toEmail: reg.email, toName: reg.fullName, studentId: reg.studentIdNumber, password });

    loginToSession({ id, data: () => ({ ...reg, passwordHash }) });

    document.getElementById("reset-done-id").textContent = reg.studentIdNumber;
    document.getElementById("reset-done-pass").textContent = password;
    showStep("resetDone");

    setTimeout(() => { window.location.href = destinationAfterLogin(); }, 4000);
  } catch (err) {
    console.error(err);
    showResetPasswordStatus("Something went wrong saving your password. (" + err.message + ")", true);
  } finally {
    resetPasswordSubmitBtn.disabled = false;
    resetPasswordSubmitBtn.textContent = "Save Password & Log In";
  }
});
