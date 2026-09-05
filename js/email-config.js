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
//        {{site_name}}    — "Agri Core"
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
//        {{site_name}}  — "Agri Core"
//      Mention the code expires in 10 minutes. Set "To email" to {{to_email}}.
//   2. Copy that template's "Template ID" and paste it below.
//
// Unlike the review-status email above, OTP sending is NOT fire-and-forget:
// registration cannot proceed without it, so if these values are missing or
// sending fails, the student sees a clear error instead of silently getting
// stuck.
// ============================================
export const EMAILJS_PUBLIC_KEY  = "led7de4ijLLGq675b";
export const EMAILJS_SERVICE_ID  = "service_6ys3bsi";
export const EMAILJS_TEMPLATE_ID = "template_5eytdmh";
export const EMAILJS_OTP_TEMPLATE_ID = "template_1lbd1pu";
// ------------------------------------------------------------------
// LOGIN CREDENTIALS EMAIL (new account, or a password set/reset)
// ------------------------------------------------------------------
// Same service, its own template (~2 minutes to set up):
//   1. Email Templates → Create New Template. Use these variables:
//        {{to_email}}    — recipient address
//        {{to_name}}     — student's name
//        {{student_id}}  — their Student ID (used to log in)
//        {{password}}    — the password they just set, in plain text
//        {{site_name}}   — "Agri Core"
//      Set "To email" to {{to_email}}.
//   2. Copy that template's "Template ID" and paste it below.
// Until this is filled in, the credentials email is silently skipped —
// account creation / password setup still succeeds either way, since the
// student is also shown their ID + password on screen.
export const EMAILJS_CREDENTIALS_TEMPLATE_ID = "YOUR_CREDENTIALS_TEMPLATE_ID";
// NOTE: "Send Us Classroom Code" (resources.html) no longer emails anything —
// it saves straight to Firestore's "classroomCodes" collection and shows up
// in the admin panel's "Classroom Codes" tab (see js/resources.js + js/admin.js).

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

// ---- NEW: helpers for the premium review-status template's
// {{status_icon}} / {{status_color}} / {{{contact_block}}} placeholders.
// Only used by sendReviewEmail() below — nothing else changed.
function getStatusVisuals(status) {
  const s = (status || "").toLowerCase();
  if (s.includes("reject"))  return { icon: "✕", color: "#C1704D" };
  if (s.includes("pending")) return { icon: "⏳", color: "#C79A3B" };
  return { icon: "✓", color: "#2D4A35" };
}

function getContactBlock(status) {
  const s = (status || "").toLowerCase();
  if (!s.includes("reject")) return "";
  const whatsappLink = "https://wa.me/8801753486065"; // 88 + number, no leading 0
  return `
    <tr>
      <td style="padding:22px 32px 0 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td bgcolor="#FDEDEA" style="background-color:#FDEDEA;border:1px solid #F0C7BA;border-left:3px solid #C1704D;border-radius:14px;padding:22px 22px;">
              <div style="color:#B5613D;font-size:12.5px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px;">
                Need Help With This?
              </div>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td valign="middle" style="padding-right:14px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td bgcolor="#25D366" style="background-color:#25D366;width:44px;height:44px;border-radius:50%;text-align:center;line-height:44px;font-size:20px;">
                          💬
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td valign="middle">
                    <div style="color:#223528;font-size:14.5px;font-weight:700;">Mizanur Rahman</div>
                    <div style="color:#5F6E60;font-size:12.5px;">Submission Support</div>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;">
                <tr>
                  <td bgcolor="#25D366" style="background-color:#25D366;border-radius:999px;">
                    <a href="${whatsappLink}" target="_blank"
                       style="display:inline-block;padding:11px 22px;font-family:'Segoe UI',Arial,sans-serif;font-size:13px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:.2px;border-radius:999px;">
                      💬 Chat on WhatsApp
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

/**
 * Sends a "your submission was reviewed" email. Fire-and-forget: this never
 * throws, so a failed/unconfigured email can never block an admin's
 * approve/reject action or a student's upload.
 */
export async function sendReviewEmail({ toEmail, toName, status, itemType, courseCode, courseName, detail }) {
  if (!emailjsReady || !toEmail) return;
  try {
    const visuals = getStatusVisuals(status); // NEW
    await window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      to_email: toEmail,
      to_name: toName || "",
      status: status || "",
      item_type: itemType || "",
      course_code: courseCode || "",
      course_name: courseName || "",
      detail: detail || "",
      site_name: "Agri Core",
      status_icon: visuals.icon,          // NEW
      status_color: visuals.color,        // NEW
      contact_block: getContactBlock(status) // NEW
    });
  } catch (err) {
    console.error("[Email] Failed to send review notification:", err);
  }
}

/** Whether EmailJS is ready to send AND the OTP template has been configured. */
export function isOtpEmailReady() {
  return emailjsReady && !!EMAILJS_OTP_TEMPLATE_ID && !EMAILJS_OTP_TEMPLATE_ID.startsWith("YOUR_");
}

// EmailJS rejects its send() promise with a plain {status, text} object,
// NOT a real Error — it has no .message property at all. Every caller
// that did `err.message` on that rejection got `undefined`, which is
// exactly why registration used to show "Couldn't send the verification
// code. (undefined)" on every real failure instead of a useful reason.
// This pulls the actual reason out of whichever shape the failure is in.
function describeEmailError(err) {
  if (!err) return "Unknown email error";
  if (typeof err === "string") return err;
  if (err.text) return err.text;       // EmailJS's real error shape
  if (err.message) return err.message; // a genuine Error (e.g. thrown above)
  try { return JSON.stringify(err); } catch { return "Unknown email error"; }
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
  try {
    await window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_OTP_TEMPLATE_ID, {
      to_email: toEmail,
      to_name: toName || "",
      otp_code: otpCode,
      site_name: "Agri Core"
    });
  } catch (err) {
    throw new Error(describeEmailError(err));
  }
}

/** Whether the login-credentials email template has been configured. */
export function isCredentialsEmailReady() {
  return emailjsReady && !!EMAILJS_CREDENTIALS_TEMPLATE_ID && !EMAILJS_CREDENTIALS_TEMPLATE_ID.startsWith("YOUR_");
}

/**
 * Emails a student their Student ID + the password they just set (new
 * registration, or setting/resetting a password on an existing account).
 * Fire-and-forget, like sendReviewEmail: a missing/failed credentials
 * email must never block account creation or password setup, since the
 * student is also shown the same ID + password on screen either way.
 */
export async function sendCredentialsEmail({ toEmail, toName, studentId, password }) {
  if (!isCredentialsEmailReady() || !toEmail) return;
  try {
    await window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_CREDENTIALS_TEMPLATE_ID, {
      to_email: toEmail,
      to_name: toName || "",
      student_id: studentId || "",
      password: password || "",
      site_name: "Agri Core"
    });
  } catch (err) {
    console.error("[Email] Failed to send credentials email:", describeEmailError(err));
  }
}
