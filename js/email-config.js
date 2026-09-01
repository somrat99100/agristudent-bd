// Email notifications are sent server-side.
// No EmailJS SDK, service IDs, or browser-side email sending is used.
import { functions } from "./firebase-config.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const sendNotification = httpsCallable(functions, "sendReviewNotification");

export function initEmailNotifications() { /* retained for compatibility */ }

export async function sendReviewEmail({ toEmail, toRegId, toName, status, itemType, courseCode, courseName, detail }) {
  try {
    await sendNotification({
      toEmail, toRegId, toName, status, itemType, courseCode, courseName, detail
    });
  } catch (err) {
    console.error("[Email] server notification failed:", err);
  }
}

export function isOtpEmailReady() { return true; }
export async function sendOtpEmail() {
  throw new Error("Registration OTP is sent securely by the registration Cloud Function.");
}
