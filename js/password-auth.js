// ============================================
// PASSWORD AUTH — shared helpers for the Student ID + password login
// system. Backed by real Firebase Authentication (email/password),
// NOT a DIY hash — Firebase handles hashing, salting, and storage.
//
// How a student's Firebase Auth account relates to their registration:
//   registrations/{id}.email   — already existed (their contact email)
//   registrations/{id}.authUid — the Firebase Auth uid once they set a
//                                 password (new)
//   registrations/{id}.passwordSet — true once they've done so (new)
//
// The Firebase Auth account's email is ALWAYS the normalized (lower-
// cased) registration email, so request.auth.token.email in
// firestore.rules can be compared directly against registrations
// doc's `email` field with no case mismatches.
// ============================================
import { auth } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { normalizeEmail } from "./identity.js";

// ------------------------------------------------
// Password strength — kept simple and explained to the user, not a
// vague "weak/strong" meter with no actionable feedback.
// ------------------------------------------------
export function checkPasswordStrength(password) {
  const pwd = String(password || "");
  const checks = {
    length: pwd.length >= 8,
    letter: /[A-Za-z]/.test(pwd),
    number: /[0-9]/.test(pwd)
  };
  const passed = Object.values(checks).filter(Boolean).length;
  let label = "Too short";
  let color = "var(--terracotta-500)";
  if (checks.length && checks.letter && checks.number) { label = "Good"; color = "var(--leaf-500)"; }
  else if (checks.length && (checks.letter || checks.number)) { label = "Weak"; color = "var(--wheat-400, #a3791f)"; }
  return { ok: checks.length && checks.letter && checks.number, checks, label, color, score: passed };
}

export function validatePassword(password) {
  const pwd = String(password || "");
  if (pwd.length < 8) return { ok: false, message: "Password must be at least 8 characters." };
  if (!/[A-Za-z]/.test(pwd)) return { ok: false, message: "Password must include at least one letter." };
  if (!/[0-9]/.test(pwd)) return { ok: false, message: "Password must include at least one number." };
  if (pwd.length > 128) return { ok: false, message: "Password is too long." };
  return { ok: true, message: "" };
}

// ------------------------------------------------
// Friendly Firebase Auth error messages — never leak raw error codes
// or hint at whether an account exists (avoids user enumeration).
// ------------------------------------------------
export function friendlyAuthError(err) {
  const code = err?.code || "";
  switch (code) {
    case "auth/email-already-in-use":
      return "A password is already set up for this account. Try logging in, or use \"Forgot password\".";
    case "auth/weak-password":
      return "Please choose a stronger password (at least 8 characters, with a letter and a number).";
    case "auth/invalid-email":
      return "That email address looks invalid.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Incorrect Student ID or password.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a bit and try again.";
    case "auth/network-request-failed":
      return "Network error. Check your connection and try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}

export async function createPasswordAccount(email, password) {
  const normalized = normalizeEmail(email);
  const cred = await createUserWithEmailAndPassword(auth, normalized, password);
  return cred.user;
}

export async function signInWithPassword(email, password) {
  const normalized = normalizeEmail(email);
  const cred = await signInWithEmailAndPassword(auth, normalized, password);
  return cred.user;
}

export async function signOutOfAuth() {
  try { await signOut(auth); } catch (err) { /* non-fatal — session.js already cleared local state */ }
}

export async function sendResetEmail(email) {
  await sendPasswordResetEmail(auth, normalizeEmail(email));
}
