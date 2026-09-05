// ============================================
// PASSWORD HASHING — client-side, matching this site's existing trust
// model (see js/otp.js, js/session.js): there is no backend server, so
// hashing happens in the browser with the Web Crypto API (SHA-256) and
// only the hash — never the plaintext — is written to Firestore. This
// keeps a raw password from sitting in the database in the clear, but
// (like the rest of the site) is not meant to withstand a determined
// attacker with the client source open; it stops casual exposure.
//
// The student's own normalized email is mixed in as a lightweight
// per-account salt, so two students who pick the same password never end
// up with identical stored hashes — no extra field needs to be stored for
// this since every account already has an email on file.
// ============================================

export async function hashPassword(password, email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const data = new TextEncoder().encode(`${normalizedEmail}::${String(password || "")}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Kept intentionally simple — this is a student academic-resource site,
 * not a banking app. Just enough to stop a blank/one-character password. */
export function isPasswordValid(password) {
  return typeof password === "string" && password.length >= 6;
}
