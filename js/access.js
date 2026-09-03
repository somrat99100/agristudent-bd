// ============================================
// RESOURCE ACCESS WINDOW
// ============================================
// Rules:
//  • Access starts the moment a file/classroom code is uploaded — the
//    student does NOT wait for admin review to start using their time.
//  • Every uploaded resource file grants 24 hours; every classroom code
//    grants 6 hours.
//  • Multiple uploads STACK in the order they were made: if you upload a
//    second item while the first is still active, its window starts the
//    instant the first one's finishes (rather than running in parallel or
//    replacing it) — so the total remaining time keeps growing. If you
//    upload after everything you had has already run out, the new item
//    simply starts a fresh window from its own upload time.
//  • A REJECTED file blocks resource uploads/access for 30 days (and its
//    own grant is dropped from the stack).
//  • All access is calculated from Firestore records (each item's own
//    upload timestamp), not a browser-only timer, so refreshing the page
//    or switching devices never resets or loses the access window — only
//    running out of time does.
// ============================================
import { sendReviewEmail } from "./email-config.js";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const ACCESS_PER_FILE_MS = DAY_MS; // 24h per uploaded resource file
export const ACCESS_PER_CLASSROOM_MS = 6 * 60 * 60 * 1000; // 6h per classroom code
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
 * Calculate resource access from upload/moderation records.
 *
 * Every non-rejected item (file upload OR classroom code) grants access
 * starting the instant it was uploaded — 24h per resource file, 6h per
 * classroom code — and grants STACK in upload order: each new grant starts
 * the moment the running balance frees up (or at its own upload time if
 * that is later), so it always tops up remaining time rather than
 * replacing it. A rejected file drops out of the stack and instead opens
 * a 30-day restriction window.
 */
export function computeResourceAccessStatus(items, now = Date.now()) {
  const list = Array.isArray(items) ? items : [];
  let restrictedUntil = 0;
  const grants = [];

  for (const item of list) {
    const status = item?.status || "pending";

    // Admin-set restrictions (rejection, or a manual/custom-duration
    // restriction from the moderation panel) always take priority.
    if (item?.restrictedUntil && (status === "rejected" || item?.restricted)) {
      const explicit = toDate(item.restrictedUntil)?.getTime?.() || 0;
      if (explicit) restrictedUntil = Math.max(restrictedUntil, explicit);
      if (status !== "rejected") continue;
    }

    if (status === "rejected") {
      const rejectedAt = eventTime(item, "rejectedAt")?.getTime?.() || 0;
      const explicit = toDate(item?.restrictedUntil)?.getTime?.() || 0;
      const until = explicit || ((rejectedAt || toDate(item?.submittedAt)?.getTime?.() || now) + RESTRICTION_MS);
      restrictedUntil = Math.max(restrictedUntil, until);
      continue;
    }

    if (item?.kind === "classroom") {
      grants.push({
        item,
        kind: "classroom",
        status: "approved",
        time: eventTime(item, "submittedAt")?.getTime?.() || now,
        durationMs: ACCESS_PER_CLASSROOM_MS
      });
      continue;
    }

    // Any other non-rejected resource upload (pending OR approved) grants
    // its full 24h-per-file window immediately from the upload time —
    // students get access right away and don't lose it while waiting on
    // review. If it's later rejected, the branch above takes over instead.
    grants.push({
      item,
      kind: "resource",
      status,
      time: eventTime(item, "uploadedAt")?.getTime?.() || now,
      durationMs: fileCount(item) * ACCESS_PER_FILE_MS
    });
  }

  grants.sort((a, b) => a.time - b.time);

  let runningEnd = 0;
  let approvedFileCount = 0;
  let pendingActiveCount = 0;
  const breakdown = [];
  for (const g of grants) {
    const startsAt = Math.max(runningEnd, g.time);
    const endsAt = startsAt + g.durationMs;
    runningEnd = endsAt;
    breakdown.push({
      id: g.item?.id || null,
      kind: g.kind,
      status: g.status,
      item: g.item,
      grantedAt: g.time,
      startsAt,
      endsAt,
      durationMs: g.durationMs,
      active: endsAt > now
    });
    if (g.kind === "resource") {
      if (g.status === "approved") approvedFileCount += fileCount(g.item);
      else pendingActiveCount += fileCount(g.item);
    }
  }

  const accessUntil = runningEnd;
  const restricted = restrictedUntil > now;
  const active = !restricted && accessUntil > now;
  const msRemaining = active ? accessUntil - now : 0;
  const daysRemaining = Math.max(0, Math.ceil(msRemaining / DAY_MS));
  const hoursRemaining = Math.max(0, Math.ceil(msRemaining / (60 * 60 * 1000)));

  // Size of the most recently granted top-up — used so the profile scale
  // bar shows "how much of THIS last grant is left" (refilling back to
  // ~100% each time a new file/code is unlocked) rather than shrinking
  // forever against the ever-growing cumulative balance.
  const lastGrantMs = breakdown.length ? breakdown[breakdown.length - 1].durationMs : DAY_MS;

  // Sum of every grant ever earned (not just what's left) — used to show
  // "total access time earned" on the profile page.
  const totalGrantedMs = breakdown.reduce((sum, b) => sum + b.durationMs, 0);

  return {
    active,
    restricted,
    restrictedUntil: restrictedUntil || null,
    accessUntil: accessUntil || null,
    approvedFileCount,
    pendingActiveCount,
    lastGrantMs: lastGrantMs || DAY_MS,
    totalGrantedMs,
    breakdown,
    daysRemaining,
    hoursRemaining,
    msRemaining
  };
}

export async function maybeSendAccessReminder(access, { email, name }) {
  if (!email || !access || !access.accessUntil) return;
  if (access.daysRemaining > REMINDER_WINDOW_DAYS || access.restricted) return;

  const storageKey = `agri_access_reminder_${email}_${access.accessUntil}`;
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
    badgeEl.textContent = "🔓 Resource Access Active";
    badgeEl.className = "access-badge active";
    const expires = formatDate(access.accessUntil);
    detailEl.textContent = `⏱ ${formatRemaining(access.msRemaining)} remaining · expires ${expires}`;
    return;
  }

  badgeEl.textContent = "🔒 No Active Access";
  badgeEl.className = "access-badge locked";
  detailEl.textContent = "Upload a relevant PDF, image, or presentation — access starts the moment you upload it (24 hours per file).";
}

// Backward-compatible export used by any older page code.
export function computeAccessStatus(items) {
  return computeResourceAccessStatus(items);
}

/** Normalize a classroom code for duplicate comparison (case/space-insensitive). */
export function normalizeClassroomCode(code) {
  return String(code || "").trim().toLowerCase().replace(/\s+/g, "");
}

// ============================================
// CLASSROOM CODE AUTHENTICITY CHECK
// ============================================
// A real Google Classroom join code is always 6-8 characters made up of
// lowercase letters and digits only (no spaces, punctuation, or symbols).
// We can't call Google's servers to confirm a code belongs to a real,
// live class — that requires OAuth consent from the class owner, which
// students submitting a code obviously don't have. What we CAN do is
// reject anything that isn't even shaped like a genuine code: wrong
// length/characters, or an obvious placeholder someone typed to get
// past the form (repeated characters, keyboard runs, "test"/"fake"/etc).
// This is a first line of defense; the admin panel's Classroom Codes tab
// and the account-restriction tool remain the backstop for anyone who
// still slips through with a fabricated but well-formed code.
const CLASSROOM_CODE_SHAPE_RE = /^[a-z0-9]{6,8}$/;

const CLASSROOM_CODE_BLOCKLIST = new Set([
  "test", "tests", "testing", "fake", "faker", "none", "null", "undefined",
  "demo", "sample", "dummy", "asdfgh", "qwerty", "qwerty1", "abc123",
  "123456", "1234567", "000000", "0000000", "111111", "aaaaaa", "xxxxxx",
  "xxxxxxx", "codehere", "yourcode"
]);

/** True if every character in the (already-normalized) string is identical. */
function isRepeatedChar(s) {
  return /^(.)\1+$/.test(s);
}

/** True if the string is a simple ascending or descending run, e.g. "123456" or "fedcba". */
function isKeyboardSequence(s) {
  let ascending = true, descending = true;
  for (let i = 1; i < s.length; i++) {
    const diff = s.charCodeAt(i) - s.charCodeAt(i - 1);
    if (diff !== 1) ascending = false;
    if (diff !== -1) descending = false;
  }
  return ascending || descending;
}

/**
 * Returns true only if `code` is shaped like a genuine Google Classroom
 * join code. Call this BEFORE writing a submitted classroom code to
 * Firestore (both the "Send Us Classroom Code" form and the Hand Notes
 * unlock flow use this).
 */
export function isAuthenticClassroomCode(code) {
  const normalized = normalizeClassroomCode(code);
  if (!CLASSROOM_CODE_SHAPE_RE.test(normalized)) return false;
  if (CLASSROOM_CODE_BLOCKLIST.has(normalized)) return false;
  if (isRepeatedChar(normalized)) return false;
  if (isKeyboardSequence(normalized)) return false;
  return true;
}

/**
 * Renders the "remaining access" scale/progress bar on the Profile page
 * and keeps it ticking in real time (no page refresh needed).
 * windowMs is the size of the most recent grant (24h/file, 6h/classroom
 * code) so the bar reflects how much of THAT grant is left.
 */
export function renderAccessScale({ wrapEl, fillEl, remainingEl, untilEl }, access, windowMs = DAY_MS) {
  if (!wrapEl || !fillEl) return () => {};
  let timer = null;

  function tick() {
    const now = Date.now();
    const msLeft = Math.max(0, (access.accessUntil || 0) - now);
    if (!access.active || !access.accessUntil || msLeft <= 0) {
      wrapEl.classList.add("hidden");
      if (timer) clearInterval(timer);
      return;
    }
    wrapEl.classList.remove("hidden");
    const pct = Math.max(0, Math.min(100, (msLeft / windowMs) * 100));
    fillEl.style.width = pct + "%";
    fillEl.classList.toggle("is-low", pct < 20);
    if (remainingEl) remainingEl.textContent = `⏱ ${formatRemaining(msLeft)} left`;
    if (untilEl) untilEl.textContent = `until ${formatDate(access.accessUntil)}`;
  }

  tick();
  timer = setInterval(tick, 30 * 1000);
  return () => clearInterval(timer);
}
