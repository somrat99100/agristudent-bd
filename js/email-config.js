// ============================================
// EMAIL NOTIFICATIONS (EmailJS)
// ============================================
// This site collects an email address on every upload/registration form and
// promises "we'll notify you when reviewed" — but nothing was ever wired up
// to actually send that email. This file fixes that using EmailJS, which
// sends email straight from the browser with no backend server needed.
//
// SETUP (one-time, ~5 minutes):
//   1. Create a free account at https://www.emailjs.com
//   2. Email Services → Add New Service → connect your Gmail/Outlook/etc.
//      → copy its "Service ID".
//   3. Email Templates → Create New Template. Use these variables in the
//      template body (Subject/Content), then copy the "Template ID":
//        {{to_email}}     — recipient address
//        {{to_name}}      — student/uploader name (or course code if no name)
//        {{status}}       — "Approved" / "Rejected" / "Pending" / "Verified" / "Unverified"
//        {{item_type}}    — e.g. "Hand Notes upload", "Student registration"
//        {{course_code}}  — e.g. "AGR 101" (blank for registrations)
//        {{course_name}}  — e.g. "Introduction to Agronomy"
//        {{detail}}       — extra context line (file name, student ID, etc.)
//        {{site_name}}    — "AgriStudent BD"
//      In the template's "To email" field, set it to {{to_email}}.
//   4. Account → General → copy your "Public Key".
//   5. Paste all three values below.
//
// Until these three values are filled in, emails are silently skipped (with
// a console warning) — the admin panel's approve/reject actions still work
// normally either way.
//
// ------------------------------------------------------------------
// REGISTRATION OTP (separate template, ~2 minutes extra setup)
// ------------------------------------------------------------------
// Registration now verifies the student actually owns the email address
// they typed, via a 6-digit code sent through EmailJS. This uses the SAME
// service (EMAILJS_SERVICE_ID above) but a DIFFERENT template, because the
// content is different (a code, not a review status).
//   1. Email Templates → Create New Template. Use these variables:
//        {{to_email}}   — recipient address
//        {{to_name}}    — student's name
//        {{otp_code}}   — the 6-digit code (make this big/bold in the body)
//        {{site_name}}  — "AgriStudent BD"
//      Mention the code expires in 10 minutes. Set "To email" to {{to_email}}.
//   2. Copy that template's "Template ID" and paste it below.
//
// Unlike the review-status email above, OTP sending is NOT fire-and-forget:
// registration cannot proceed without it, so if these values are missing or
// sending fails, the student sees a clear error instead of silently getting
// stuck.
// ============================================
export const EMAILJS_PUBLIC_KEY  = "YOUR_EMAILJS_PUBLIC_KEY";
export const EMAILJS_SERVICE_ID  = "YOUR_EMAILJS_SERVICE_ID";
export const EMAILJS_TEMPLATE_ID = "YOUR_EMAILJS_TEMPLATE_ID";
export const EMAILJS_OTP_TEMPLATE_ID = "YOUR_EMAILJS_OTP_TEMPLATE_ID";

let emailjsReady = false;

/** Call once, after the EmailJS SDK <script> tag has loaded. */
export function initEmailNotifications() {
  if (typeof window === "undefined" || !window.emailjs) {
    console.warn("[Email] EmailJS SDK not found — check that the CDN script tag loaded. Notifications are disabled.");
    return;
  }
  if (!EMAILJS_PUBLIC_KEY || EMAILJS_PUBLIC_KEY.startsWith("YOUR_")) {
    console.warn("[Email] EmailJS keys are still placeholders in js/email-config.js — notifications are disabled until you fill them in.");
    return;
  }
  try {
    window.emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
    emailjsReady = true;
  } catch (err) {
    console.error("[Email] EmailJS init failed:", err);
  }
}

/**
 * Sends a "your submission was reviewed" email. Fire-and-forget: this never
 * throws, so a failed/unconfigured email can never block an admin's
 * approve/reject action or a student's upload.
 */
export async function sendReviewEmail({ toEmail, toName, status, itemType, courseCode, courseName, detail }) {
  if (!emailjsReady || !toEmail) return;
  try {
    await window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      to_email: toEmail,
      to_name: toName || "",
      status: status || "",
      item_type: itemType || "",
      course_code: courseCode || "",
      course_name: courseName || "",
      detail: detail || "",
      site_name: "AgriStudent BD"
    });
  } catch (err) {
    console.error("[Email] Failed to send review notification:", err);
  }
}

/** Whether EmailJS is ready to send AND the OTP template has been configured. */
export function isOtpEmailReady() {
  return emailjsReady && !!EMAILJS_OTP_TEMPLATE_ID && !EMAILJS_OTP_TEMPLATE_ID.startsWith("YOUR_");
}

/**
 * Sends the registration OTP code. Unlike sendReviewEmail, this THROWS on
 * failure — registration.js relies on that to stop the flow and show the
 * student a real error instead of pretending a code went out.
 */
export async function sendOtpEmail({ toEmail, toName, otpCode }) {
  if (!isOtpEmailReady()) {
    throw new Error("Email verification isn't set up yet. Please contact the site admin.");
  }
  await window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_OTP_TEMPLATE_ID, {
    to_email: toEmail,
    to_name: toName || "",
    otp_code: otpCode,
    site_name: "AgriStudent BD"
  });
}
