// ============================================
// RESOURCE ACCESS WINDOW (3-day / 30-day)
// ============================================
// Rule: each approved file grants a rolling access window measured from
// the most recent approval. Uploading a new file (and getting it
// approved) resets the clock and renews access. Students who cross 10
// total approved files get a longer 30-day window instead of 3.
//
// NOTE: this is a static, no-backend site (no Cloud Functions/cron), so
// the "automatic reminder email" is sent client-side the next time the
// student's browser loads their profile while access is about to expire
// (<=1 day left) or has just expired — throttled via localStorage so the
// same student isn't emailed more than once per expiry window.
// ============================================
import { sendReviewEmail } from "./email-config.js";

const RENEWAL_TIER_DAYS = 3;
const LOYALTY_TIER_DAYS = 30;
const LOYALTY_TIER_THRESHOLD = 10; // more than 10 approved files
const REMINDER_WINDOW_DAYS = 1; // send reminder when <=1 day remains
const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(val) {
  if (!val) return null;
  if (typeof val.toDate === "function") return val.toDate();
  if (val instanceof Date) return val;
  return null;
}

/**
 * Computes the current access window from a student's resource/term items.
 * @param {Array<{status:string, reviewedAt?:any, submittedAt?:any}>} items
 */
export function computeAccessStatus(items) {
  const approved = (items || []).filter(i => i.status === "approved");
  const approvedCount = approved.length;

  if (approvedCount === 0) {
    return { approvedCount: 0, tierDays: 0, active: false, expiresAt: null, daysRemaining: 0 };
  }

  let latestApproval = null;
  approved.forEach(i => {
    const d = toDate(i.reviewedAt) || toDate(i.submittedAt);
    if (d && (!latestApproval || d > latestApproval)) latestApproval = d;
  });
  if (!latestApproval) latestApproval = new Date();

  const tierDays = approvedCount > LOYALTY_TIER_THRESHOLD ? LOYALTY_TIER_DAYS : RENEWAL_TIER_DAYS;
  const expiresAt = new Date(latestApproval.getTime() + tierDays * DAY_MS);
  const msRemaining = expiresAt.getTime() - Date.now();
  const daysRemaining = Math.max(0, Math.ceil(msRemaining / DAY_MS));

  return { approvedCount, tierDays, active: msRemaining > 0, expiresAt, daysRemaining };
}

/**
 * Fire-and-forget reminder email when access is about to expire or has
 * just expired. Throttled to once per expiry timestamp per browser.
 */
export async function maybeSendAccessReminder(access, { email, name }) {
  if (!email || !access || !access.expiresAt) return;
  const withinReminderWindow = access.daysRemaining <= REMINDER_WINDOW_DAYS;
  if (!withinReminderWindow) return;

  const storageKey = `agri_access_reminder_${email}_${access.expiresAt.getTime()}`;
  try {
    if (localStorage.getItem(storageKey)) return;
  } catch { /* localStorage unavailable — skip throttle, still try to send once */ }

  const detail = access.active
    ? `Your resource access expires in ${access.daysRemaining} day${access.daysRemaining === 1 ? "" : "s"} (on ${access.expiresAt.toLocaleDateString()}). Upload a new file and get it approved to renew your access.`
    : `Your resource access has expired. Upload a new file and get it approved to renew your access.`;

  try {
    await sendReviewEmail({
      toEmail: email,
      toName: name || "",
      status: access.active ? "Access Expiring Soon" : "Access Expired",
      itemType: "Resource Access Reminder",
      detail
    });
    try { localStorage.setItem(storageKey, "1"); } catch { /* ignore */ }
  } catch (err) {
    console.error("[Access] reminder email failed:", err);
  }
}

/** Renders the access badge/detail text into the given DOM elements. */
export function renderAccessBadge({ badgeEl, detailEl }, access) {
  if (!badgeEl || !detailEl) return;

  if (access.approvedCount === 0) {
    badgeEl.textContent = "🔒 No Access Yet";
    badgeEl.className = "access-badge locked";
    detailEl.textContent = "Get a file approved to unlock resource access.";
    return;
  }

  if (access.active) {
    const isLoyalty = access.tierDays === LOYALTY_TIER_DAYS;
    badgeEl.textContent = isLoyalty ? "🌟 30-Day Access Active" : "🔓 3-Day Access Active";
    badgeEl.className = "access-badge active";
    detailEl.textContent = `${access.daysRemaining} day${access.daysRemaining === 1 ? "" : "s"} remaining · expires ${access.expiresAt.toLocaleDateString()}`
      + (isLoyalty ? " · Top Contributor (10+ approved files)" : "");
  } else {
    badgeEl.textContent = "🔒 Access Expired";
    badgeEl.className = "access-badge expired";
    detailEl.textContent = "Upload a new file and get it approved to renew your 3-day access.";
  }
}
