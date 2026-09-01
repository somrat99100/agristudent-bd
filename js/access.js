// ============================================
// RESOURCE ACCESS WINDOW
// ============================================
// Rules:
//  • Each APPROVED file grants 24 hours of resource access.
//  • Multiple approved files stack: every approved file adds another 24h.
//  • A newly uploaded PENDING file gives provisional access for 12 hours.
//    If it is still pending after 12 hours, that provisional access expires.
//  • A REJECTED file blocks resource uploads/access for 30 days.
//  • All access is calculated from Firestore records, not a browser-only
//    timer, so refreshes/devices do not reset the access window.
// ============================================
import { sendReviewEmail } from "./email-config.js";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const PENDING_GRACE_MS = 12 * 60 * 60 * 1000;
export const ACCESS_PER_FILE_MS = DAY_MS;
export const RESTRICTION_MS = 30 * DAY_MS;
const REMINDER_WINDOW_DAYS = 1;

function toDate(val) {
  if (!val) return null;
  if (typeof val.toDate === "function") return val.toDate();
  if (val instanceof Date) return val;
  const n = Number(val);
  if (Number.isFinite(n) && n > 0) {
    const d = new Date(n);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function fileCount(item) {
  return Math.max(1, Array.isArray(item?.fileUrls) ? item.fileUrls.length : 1);
}

function eventTime(item, preferred) {
  return toDate(item?.[preferred]) || toDate(item?.submittedAt) || toDate(item?.uploadedAt);
}

/**
 * Calculate resource access from moderation records.
 * Approved files stack 24h each. Pending submissions have a 12h provisional
 * window. Rejected submissions impose the longest active 30-day restriction.
 */
export function computeResourceAccessStatus(items, now = Date.now()) {
  const list = Array.isArray(items) ? items : [];
  let restrictedUntil = 0;
  const approved = [];
  const pending = [];

  for (const item of list) {
    const status = item?.status || "pending";

    if (status === "rejected") {
      const rejectedAt = eventTime(item, "rejectedAt")?.getTime?.() || 0;
      const explicit = toDate(item?.restrictedUntil)?.getTime?.() || 0;
      const until = explicit || ((rejectedAt || toDate(item?.submittedAt)?.getTime?.() || now) + RESTRICTION_MS);
      restrictedUntil = Math.max(restrictedUntil, until);
    } else if (status === "approved") {
      approved.push(item);
    } else if (status === "pending") {
      pending.push(item);
    }
  }

  // Stack approved-file credits chronologically. If a new approval arrives
  // after the old window has ended, its 24h starts at the approval time.
  approved.sort((a, b) => {
    const at = eventTime(a, "reviewedAt")?.getTime?.() || 0;
    const bt = eventTime(b, "reviewedAt")?.getTime?.() || 0;
    return at - bt;
  });

  let approvedAccessUntil = 0;
  let approvedFileCount = 0;
  for (const item of approved) {
    const approvedAt = eventTime(item, "reviewedAt")?.getTime?.() || now;
    approvedFileCount += fileCount(item);
    approvedAccessUntil = Math.max(approvedAccessUntil, approvedAt);
    approvedAccessUntil += fileCount(item) * ACCESS_PER_FILE_MS;
  }

  // A pending upload is usable only during its first 12 hours. Once that
  // window passes, it contributes zero access until an admin approves it.
  let pendingAccessUntil = 0;
  let pendingActiveCount = 0;
  for (const item of pending) {
    const submittedAt = eventTime(item, "uploadedAt")?.getTime?.() || now;
    const until = submittedAt + PENDING_GRACE_MS;
    if (until > now) {
      pendingAccessUntil = Math.max(pendingAccessUntil, until);
      pendingActiveCount += fileCount(item);
    }
  }

  const accessUntil = Math.max(approvedAccessUntil, pendingAccessUntil);
  const restricted = restrictedUntil > now;
  const active = !restricted && accessUntil > now;
  const msRemaining = active ? accessUntil - now : 0;
  const daysRemaining = Math.max(0, Math.ceil(msRemaining / DAY_MS));
  const hoursRemaining = Math.max(0, Math.ceil(msRemaining / (60 * 60 * 1000)));

  return {
    active,
    restricted,
    restrictedUntil: restrictedUntil || null,
    accessUntil: accessUntil || null,
    approvedFileCount,
    pendingActiveCount,
    approvedAccessUntil: approvedAccessUntil || null,
    pendingAccessUntil: pendingAccessUntil || null,
    daysRemaining,
    hoursRemaining,
    msRemaining
  };
}

export async function maybeSendAccessReminder(access, { email, name }) {
  if (!email || !access || !access.accessUntil) return;
  if (access.daysRemaining > REMINDER_WINDOW_DAYS || access.restricted) return;

  const storageKey = `agri_access_reminder_${access.accessUntil}`;
  try {
    if (localStorage.getItem(storageKey)) return;
  } catch { /* ignore */ }

  const detail = access.active
    ? `Your Agri Core resource access expires on ${formatDate(access.accessUntil)}. ${access.daysRemaining} day(s) remaining.`
    : `Your Agri Core resource access has expired. Upload another relevant file for review.`;

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

/** DD/MM/YYYY */
export function formatDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${d.getFullYear()}`;
}

export function formatRemaining(ms) {
  const safe = Math.max(0, Number(ms) || 0);
  const totalHours = Math.ceil(safe / (60 * 60 * 1000));
  if (totalHours < 24) return `${totalHours} hour${totalHours === 1 ? "" : "s"}`;
  const days = Math.ceil(totalHours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function renderAccessBadge({ badgeEl, detailEl }, access) {
  if (!badgeEl || !detailEl) return;

  if (access.restricted) {
    badgeEl.textContent = "⚠️ Upload Restricted";
    badgeEl.className = "access-badge expired";
    detailEl.textContent = `Upload relevant files only. Restricted until ${formatDate(access.restrictedUntil)}.`;
    return;
  }

  if (access.active) {
    const pendingOnly = access.approvedFileCount === 0 && access.pendingActiveCount > 0;
    badgeEl.textContent = pendingOnly ? "⏳ Temporary Access Active" : "🔓 Resource Access Active";
    badgeEl.className = "access-badge active";
    const expires = formatDate(access.accessUntil);
    detailEl.textContent = `${access.daysRemaining} day${access.daysRemaining === 1 ? "" : "s"} remaining · expires ${expires}`;
    if (pendingOnly) detailEl.textContent += " · Pending uploads expire after 12 hours if not approved.";
    return;
  }

  badgeEl.textContent = "🔒 No Active Access";
  badgeEl.className = "access-badge locked";
  detailEl.textContent = "Upload a relevant PDF, image, or presentation. Approval gives 24 hours per file.";
}

// Backward-compatible export used by any older page code.
export function computeAccessStatus(items) {
  return computeResourceAccessStatus(items);
}
