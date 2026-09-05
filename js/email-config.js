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
// REGISTRATION OTP + LOGIN CREDENTIALS — one shared template, no
// conditional logic inside it
// ------------------------------------------------------------------
// Registration verifies the student actually owns the email address
// they typed, via a 6-digit code sent through EmailJS. The same
// template is reused to email a student their Student ID + password
// whenever they set or reset one — EmailJS's free plan only allows 2
// templates, and both slots are already used (review-status + this one).
//
// Earlier this was done with {{#if otp_code}} / {{#if password}}
// conditional blocks inside the EmailJS template body. That broke
// intermittently ("Template: One or more dynamic variables are
// corrupted") because EmailJS's merge engine doesn't strip HTML
// comments before scanning for {{...}} tokens — so leftover
// documentation text mentioning "{{#if}}" was itself parsed as a real,
// unmatched conditional.
//
// The next attempt swapped the #if blocks for a single {{{content_block}}}
// (triple-brace, "insert as raw HTML") variable built in JavaScript. That
// ALSO produced the same "corrupted variables" error — including on
// EmailJS's own dashboard "Test It" button, which sends straight to
// EmailJS's servers with no browser JS involved. That ruled out anything
// on the JS/browser side and pointed at the template itself: EmailJS's
// merge engine only supports plain, single-brace {{variable}} substitution
// — it doesn't support Handlebars-style triple braces at all.
//
// The template after that used four plain variables (a label, a value, a
// second label, a second value) so the OTP email and the credentials
// email could share one template. That worked, but left the OTP email
// with an empty, unused second row.
//
// This version drops the second pair entirely. The credentials email's
// two lines (Student ID, then Password) are sent as ONE string with a
// real line-break character in it, and the template's content box has a
// white-space rule that turns that line break into a visible second
// line. The OTP email just sends a single-line string with no line
// break. One variable, no unused leftovers either way.
//
// Template variables used (see the current template pasted into EmailJS —
// keep a saved reference copy in email-templates/ if you want one):
//   to_email       — recipient address ("To email" field)
//   to_name        — student's name
//   heading_tagline — small text in the header banner
//   intro_text     — the intro sentence under "Hi <name>,"
//   content_label  — e.g. "Your Verification Code" / "Your Login Details"
//   content_value  — the code, or "Student ID: ...\nPassword: ..." with
//                    a real newline between the two lines
//   footer_note    — the "Didn't request this?" line
//   subject_line   — the template's Subject field must be set to this
//                    variable in the EmailJS dashboard; pasting the body
//                    HTML never touches the Subject field, so this has to
//                    be set there by hand once
//   site_name      — "Agri Core"
// ------------------------------------------------------------------
export const EMAILJS_PUBLIC_KEY  = "led7de4ijLLGq675b";
export const EMAILJS_SERVICE_ID  = "service_6ys3bsi";
export const EMAILJS_TEMPLATE_ID = "template_5eytdmh";
export const EMAILJS_OTP_TEMPLATE_ID = "template_1lbd1pu";

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
      heading_tagline: "Account Verification",
      intro_text: "Use the verification code below to finish creating your Agri Core account.",
      content_label: "Your Verification Code",
      content_value: otpCode,
      footer_note: "This code expires in 10 minutes. Didn't request this? You can safely ignore this email — no account will be created without this code.",
      subject_line: "Your Agri Core verification code",
      site_name: "Agri Core"
    });
  } catch (err) {
    throw new Error(describeEmailError(err));
  }
}

/** The credentials email now shares the OTP template, so it's ready
 * whenever the OTP template is ready — no separate config needed. */
export function isCredentialsEmailReady() {
  return isOtpEmailReady();
}

/**
 * Emails a student their Student ID + the password they just set (new
 * registration, or setting/resetting a password on an existing account).
 * Reuses EMAILJS_OTP_TEMPLATE_ID (see js/email-config.js's comments
 * near EMAILJS_OTP_TEMPLATE_ID) instead of a 3rd template, since
 * EmailJS's free plan only allows 2. Fire-and-forget, like
 * sendReviewEmail: a missing/failed credentials email must never block
 * account creation or password setup, since the student is also shown
 * the same ID + password on screen either way.
 */
export async function sendCredentialsEmail({ toEmail, toName, studentId, password }) {
  if (!isCredentialsEmailReady() || !toEmail) return;
  try {
    await window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_OTP_TEMPLATE_ID, {
      to_email: toEmail,
      to_name: toName || "",
      heading_tagline: "Login Details",
      intro_text: "Here are your login details for Agri Core — keep them somewhere safe.",
      content_label: "Your Login Details",
      content_value: `Student ID: ${studentId || ""}\nPassword: ${password || ""}`,
      footer_note: "Didn't request this? Please contact us right away so we can secure your account.",
      subject_line: "Your Agri Core login details",
      site_name: "Agri Core"
    });
  } catch (err) {
    console.error("[Email] Failed to send credentials email:", describeEmailError(err));
  }
}
