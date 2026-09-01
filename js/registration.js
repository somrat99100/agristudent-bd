import { db, functions } from "./firebase-config.js";
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { normalizeEmail, normalizeStudentId } from "./identity.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { uploadSignedToCloudinary } from "./cloudinary.js";
import { signInWithCustomToken } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { saveSession } from "./session.js";


const form = document.getElementById("register-form");
const submitBtn = document.getElementById("submit-btn");
const statusBox = document.getElementById("form-status");
const successBox = document.getElementById("form-success");
const progressWrap = document.getElementById("upload-progress-wrap");
const progressBar = document.getElementById("progress-ring-bar");
const progressText = document.getElementById("progress-ring-text");
const CIRCUMFERENCE = 226.19; // 2 * π * r(36)

const otpPanel = document.getElementById("otp-panel");
const otpSentTo = document.getElementById("otp-sent-to");
const otpInput = document.getElementById("otp-code");
const otpVerifyBtn = document.getElementById("otp-verify-btn");
const otpStatus = document.getElementById("otp-status");
const otpBackBtn = document.getElementById("otp-back-btn");
const otpResendBtn = document.getElementById("otp-resend-btn");

// Holds the validated form data (and file) between "send code" and
// "verify code" — nothing is written to Firestore/Cloudinary until the
// email is confirmed.
let pending = null;

const requestRegistrationOtp = httpsCallable(functions, "requestRegistrationOtp");
const resendRegistrationOtp = httpsCallable(functions, "resendRegistrationOtp");
const verifyRegistrationOtp = httpsCallable(functions, "verifyRegistrationOtp");

function setProgress(pct) {
  const offset = CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE;
  progressBar.style.strokeDashoffset = offset;
  progressText.textContent = pct + "%";
}

// Pre-submit validation errors — shown without the ring, nothing has started yet.
function showError(message) {
  progressWrap.classList.add("hidden");
  statusBox.textContent = message;
  statusBox.style.color = "var(--terracotta-500)";
  statusBox.classList.remove("hidden");
}

// In-progress / outcome messages — ring + label stay visible together,
// including on failure, so errors are actually seen.
function showStatus(message, isError = false) {
  progressWrap.classList.remove("hidden");
  statusBox.textContent = message;
  statusBox.style.color = isError ? "var(--terracotta-500)" : "var(--moss-600)";
  if (isError) progressBar.style.stroke = "var(--terracotta-500)";
}

function showOtpStatus(message, isError = false) {
  otpStatus.textContent = message;
  otpStatus.style.color = isError ? "var(--terracotta-500)" : "var(--moss-600)";
}

async function uploadToCloudinary(file, onProgress) {
  return uploadSignedToCloudinary(file, "student-ids", onProgress);
}

function clearPendingRegistration() { pending = null; }

function showFormStep() {
  otpPanel.classList.add("hidden");
  form.classList.remove("hidden");
  statusBox.classList.add("hidden");
  progressWrap.classList.add("hidden");
}

function showOtpStep(email) {
  form.classList.add("hidden");
  statusBox.classList.add("hidden");
  progressWrap.classList.add("hidden");
  otpPanel.classList.remove("hidden");
  otpSentTo.textContent = `We sent a 6-digit code to ${email}. It expires in 10 minutes.`;
  otpInput.value = "";
  showOtpStatus("");
  otpInput.focus();
}

// ============================================
// STEP 1 — validate details, send the OTP
// ============================================
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const fullName = document.getElementById("fullName").value.trim();
  const email = normalizeEmail(document.getElementById("email").value);
  const genderInput = document.querySelector('input[name="gender"]:checked');
  const gender = genderInput ? genderInput.value : "";
  const studentIdNumber = normalizeStudentId(document.getElementById("studentIdNumber").value);
  const password = document.getElementById("register-password").value;
  const idFile = document.getElementById("studentIdPhoto").files[0];

  // Validation
  if (!fullName) {
    showError("Please enter your full name.");
    return;
  }
  if (!email) {
    showError("Please enter a valid email address.");
    return;
  }
  if (!gender) {
    showError("Please select your gender.");
    return;
  }
  if (!studentIdNumber) {
    showError("Student ID number is required.");
    return;
  }
  if (password.length < 8 || password.length > 128) {
    showError("Password must be 8-128 characters.");
    return;
  }
  if (password !== document.getElementById("register-password-confirm").value) {
    showError("Passwords do not match.");
    return;
  }

  // File size check (5MB max for ID photo)
  if (idFile && idFile.size > 5 * 1024 * 1024) {
    showError("Student ID photo must be under 5MB.");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Sending code…";
  showStatus("Sending a verification code to your email…");

  try {
    const result = await requestRegistrationOtp({ fullName, email, gender, studentIdNumber });
    pending = { fullName, email, gender, studentIdNumber, password, idFile, challengeId: result.data.challengeId };
    showOtpStep(email);
  } catch (err) {
    console.error(err);
    showStatus("Couldn't send the verification code. (" + err.message + ")", true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Register";
  }
});

// ============================================
// STEP 2 — verify the code, then create the account + auto-login
// ============================================
otpInput.addEventListener("input", () => {
  otpInput.value = otpInput.value.replace(/\D/g, "").slice(0, 6);
});

otpInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    otpVerifyBtn.click();
  }
});

otpVerifyBtn.addEventListener("click", async () => {
  if (!pending) { showFormStep(); return; }

  const code = otpInput.value.trim();
  if (!/^\d{6}$/.test(code)) {
    showOtpStatus("Enter the 6-digit code from your email.", true);
    return;
  }

  let verification;
  try {
    verification = await verifyRegistrationOtp({ challengeId: pending.challengeId, code, password: pending.password });
  } catch (err) {
    const msg = err?.code === "deadline-exceeded" ? "That code expired. Please request a new one."
      : err?.code === "resource-exhausted" ? "Too many incorrect attempts. Please request a new code."
      : "Incorrect or invalid verification code. Please try again.";
    showOtpStatus(msg, true);
    return;
  }
  if (!verification?.data?.ok) {
    showOtpStatus(`Incorrect code. ${verification?.data?.attemptsLeft ?? 0} attempt(s) left.`, true);
    return;
  }
  const result = verification.data;

  otpVerifyBtn.disabled = true;
  otpVerifyBtn.textContent = "Creating account…";
  showOtpStatus("Verified! Creating your account…");

  try {
    const { fullName, email, gender, studentIdNumber, idFile } = pending;

    showOtpStatus("Creating your account…");

    await signInWithCustomToken(result.customToken);
    if (idFile) {
      showOtpStatus("Uploading Student ID photo…");
      const studentIdUrl = await uploadToCloudinary(idFile, () => {});
      await updateDoc(doc(db, "registrations", result.regId), { studentIdStoragePath: studentIdUrl });
    }
    clearPendingRegistration();

    saveSession({
      regId: result.regId,
      fullName: result.fullName,
      gender: result.gender,
      avatarUrl: result.avatarUrl,
      status: "verified"
    });

    otpPanel.classList.add("hidden");
    successBox.classList.remove("hidden");
    document.getElementById("form-success-msg").textContent = "Email verified — logging you in…";

    setTimeout(() => { window.location.href = "profile.html"; }, 900);
  } catch (err) {
    console.error(err);
    showOtpStatus("Something went wrong creating your account. (" + err.message + ")", true);
  } finally {
    otpVerifyBtn.disabled = false;
    otpVerifyBtn.textContent = "Verify & Create Account";
  }
});

otpBackBtn.addEventListener("click", () => {
  showFormStep();
});

otpResendBtn.addEventListener("click", async () => {
  if (!pending) return;

  otpResendBtn.disabled = true;
  showOtpStatus("Resending code…");
  try {
    await resendRegistrationOtp({ challengeId: pending.challengeId });
    showOtpStatus("A new code has been sent.");
  } catch (err) {
    console.error(err);
    showOtpStatus(err?.message || "Couldn't resend the code. Please try again.", true);
  } finally {
    otpResendBtn.disabled = false;
  }
});
