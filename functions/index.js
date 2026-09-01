const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 10 });

const db = admin.firestore();
const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 45 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_SENDS = 5;
const STALE_WINDOW_MS = 30 * 60 * 1000;

const EMAILJS_PUBLIC_KEY = "led7de4ijLLGq675b";
const EMAILJS_SERVICE_ID = "service_6ys3bsi";
const EMAILJS_OTP_TEMPLATE_ID = "template_1lbd1pu";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}
function normalizeStudentId(id) {
  return String(id || "").trim().toUpperCase().replace(/\s+/g, " ");
}
function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function hashCode(code, salt) {
  return crypto.createHash("sha256").update(`${salt}:${code}`).digest("hex");
}
function randomCode() {
  return String(crypto.randomInt(100000, 1000000));
}
function challengeId() {
  return crypto.randomBytes(24).toString("hex");
}
function requireUploader(request) {
  const token = request.auth?.token;
  if (token?.admin === true && token?.email_verified === true) return token;
  if (!token?.student || !token?.regId || token?.email_verified !== true) {
    throw new HttpsError("unauthenticated", "Verified authenticated account required.");
  }
  return token;
}

async function enforceOtpRateLimit(email, kind) {
  const id = `${kind}_${crypto.createHash("sha256").update(email).digest("hex")}`;
  const ref = db.collection("otpRateLimits").doc(id);
  const now = Date.now();
  const result = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    const windowStart = Number(data.windowStart || 0);
    const count = Number(data.count || 0);
    if (windowStart && now - windowStart < 60 * 60 * 1000) {
      if (now - Number(data.lastSentAt || 0) < 45 * 1000) return { blocked: true, reason: "cooldown" };
      if (count >= 5) return { blocked: true, reason: "limit" };
      tx.update(ref, { count: count + 1, lastSentAt: now });
      return { blocked: false };
    }
    tx.set(ref, { windowStart: now, count: 1, lastSentAt: now });
    return { blocked: false };
  });
  if (result.blocked) throw new HttpsError("resource-exhausted", "Too many verification requests. Please try again later.");
}

async function sendOtpEmail({ toEmail, toName, otpCode }) {
  const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_id: EMAILJS_SERVICE_ID,
      template_id: EMAILJS_OTP_TEMPLATE_ID,
      user_id: EMAILJS_PUBLIC_KEY,
      template_params: {
        to_email: toEmail,
        to_name: toName || "",
        otp_code: otpCode,
        site_name: "Agri Core"
      }
    })
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.error("EmailJS OTP send failed", response.status, text.slice(0, 300));
    throw new HttpsError("unavailable", "Could not send the verification code.");
  }
}

exports.requestRegistrationOtp = onCall(async (request) => {
  const data = request.data || {};
  const fullName = String(data.fullName || "").trim();
  const email = normalizeEmail(data.email);
  const gender = String(data.gender || "").trim();
  const studentIdNumber = normalizeStudentId(data.studentIdNumber);

  if (!fullName || fullName.length > 120) throw new HttpsError("invalid-argument", "Invalid name.");
  if (!validEmail(email) || email.length > 254) throw new HttpsError("invalid-argument", "Invalid email.");
  if (!["male", "female", "other"].includes(gender)) throw new HttpsError("invalid-argument", "Invalid gender.");
  if (!studentIdNumber || studentIdNumber.length > 50) throw new HttpsError("invalid-argument", "Invalid Student ID.");
  await enforceOtpRateLimit(email, "registration");

  const existing = await db.collection("registrations").where("email", "==", email).limit(1).get();
  const existingReg = existing.docs[0];
  const challengeRef = db.collection("otpChallenges").doc(challengeId());
  const code = randomCode();
  const salt = crypto.randomBytes(16).toString("hex");
  const now = Date.now();

  await sendOtpEmail({ toEmail: email, toName: fullName, otpCode: code });
  await challengeRef.set({
    type: existingReg ? "registration_blocked" : "registration",
    email,
    fullName,
    gender,
    studentIdNumber,
    existingRegId: existingReg ? existingReg.id : null,
    codeHash: hashCode(code, salt),
    salt,
    createdAt: admin.firestore.Timestamp.fromMillis(now),
    firstSentAt: admin.firestore.Timestamp.fromMillis(now),
    lastSentAt: admin.firestore.Timestamp.fromMillis(now),
    sendCount: 1,
    attempts: 0,
    expiresAt: admin.firestore.Timestamp.fromMillis(now + OTP_TTL_MS)
  });

  return { challengeId: challengeRef.id, expiresInSeconds: OTP_TTL_MS / 1000 };
});

exports.resendRegistrationOtp = onCall(async (request) => {
  const { challengeId: id } = request.data || {};
  if (!/^[a-f0-9]{48}$/.test(String(id || ""))) throw new HttpsError("invalid-argument", "Invalid challenge.");
  const ref = db.collection("otpChallenges").doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Verification session expired. Please start again.");
  const c = snap.data();
  const now = Date.now();
  if (c.firstSentAt?.toMillis && now - c.firstSentAt.toMillis() > STALE_WINDOW_MS) {
    throw new HttpsError("failed-precondition", "Verification session expired. Please start again.");
  }
  if (now - c.lastSentAt.toMillis() < RESEND_COOLDOWN_MS) {
    throw new HttpsError("resource-exhausted", "Please wait before requesting another code.");
  }
  if ((c.sendCount || 0) >= MAX_SENDS) {
    throw new HttpsError("resource-exhausted", "Too many codes requested. Please start again later.");
  }

  const code = randomCode();
  const salt = crypto.randomBytes(16).toString("hex");
  await sendOtpEmail({ toEmail: c.email, toName: c.fullName, otpCode: code });
  await ref.update({
    codeHash: hashCode(code, salt),
    salt,
    createdAt: admin.firestore.Timestamp.fromMillis(now),
    lastSentAt: admin.firestore.Timestamp.fromMillis(now),
    expiresAt: admin.firestore.Timestamp.fromMillis(now + OTP_TTL_MS),
    sendCount: (c.sendCount || 0) + 1,
    attempts: 0
  });
  return { expiresInSeconds: OTP_TTL_MS / 1000 };
});

exports.verifyRegistrationOtp = onCall(async (request) => {
  const { challengeId: id, code, password } = request.data || {};
  if (!/^[a-f0-9]{48}$/.test(String(id || "")) || !/^\d{6}$/.test(String(code || ""))) {
    throw new HttpsError("invalid-argument", "Invalid verification code.");
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    throw new HttpsError("invalid-argument", "Password must be 8-128 characters.");
  }

  const ref = db.collection("otpChallenges").doc(id);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Verification session expired. Please start again.");
    const c = snap.data();
    const now = Date.now();
    if (c.type && c.type !== "registration") throw new HttpsError("failed-precondition", "Invalid verification session.");
    if (now > c.expiresAt.toMillis()) throw new HttpsError("deadline-exceeded", "That code expired. Please request a new one.");
    if ((c.attempts || 0) >= MAX_ATTEMPTS) throw new HttpsError("resource-exhausted", "Too many incorrect attempts. Please request a new code.");
    if (hashCode(String(code), c.salt) !== c.codeHash) {
      const attempts = (c.attempts || 0) + 1;
      tx.update(ref, { attempts });
      return { ok: false, attemptsLeft: Math.max(0, MAX_ATTEMPTS - attempts) };
    }

    const regRef = db.collection("registrations").doc();
    const uid = `student_${regRef.id}`;
    const reg = {
      fullName: c.fullName,
      email: c.email,
      gender: c.gender,
      avatarUrl: c.gender === "female" ? "assets/avatar-female.svg" : "assets/avatar-male.svg",
      studentIdNumber: c.studentIdNumber,
      status: "verified",
      emailVerified: true,
      authUid: uid,
      submittedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    tx.create(regRef, reg);
    tx.delete(ref);
    return { ok: true, regId: regRef.id, uid, email: c.email, studentIdNumber: c.studentIdNumber, fullName: c.fullName, gender: c.gender, avatarUrl: reg.avatarUrl };
  });

  if (!result.ok) return result;

  let authUser;
  try {
    authUser = await admin.auth().createUser({
      uid: result.uid,
      email: result.email,
      password,
      emailVerified: true,
      displayName: result.fullName
    });
    await admin.auth().setCustomUserClaims(authUser.uid, { student: true, regId: result.regId });
  } catch (err) {
    await db.collection("registrations").doc(result.regId).delete().catch(() => {});
    await admin.auth().deleteUser(result.uid).catch(() => {});
    if (err?.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "An account already exists for this email.");
    }
    console.error("[Registration] account creation failed", err);
    throw new HttpsError("internal", "Could not create the account.");
  }

  const token = await admin.auth().createCustomToken(result.uid, { student: true, regId: result.regId });
  return { ...result, customToken: token };
});

exports.requestAccountActivationOtp = onCall(async (request) => {
  const data = request.data || {};
  const email = normalizeEmail(data.email);
  const studentIdNumber = normalizeStudentId(data.studentIdNumber);
  if (!validEmail(email) || !studentIdNumber) throw new HttpsError("invalid-argument", "Invalid details.");
  await enforceOtpRateLimit(email, "activation");

  const snap = await db.collection("registrations").where("email", "==", email).limit(5).get();
  const match = snap.docs.find(d => normalizeStudentId(d.data().studentIdNumber) === studentIdNumber);
  // Do not reveal whether a particular email/ID combination exists.
  if (!match) return { sent: true };

  const dataRef = db.collection("otpChallenges").doc(challengeId());
  const code = randomCode();
  const salt = crypto.randomBytes(16).toString("hex");
  const now = Date.now();
  await sendOtpEmail({ toEmail: email, toName: match.data().fullName || "", otpCode: code });
  await dataRef.set({
    type: "activation",
    email, regId: match.id, fullName: match.data().fullName || "",
    codeHash: hashCode(code, salt), salt,
    createdAt: admin.firestore.Timestamp.fromMillis(now),
    firstSentAt: admin.firestore.Timestamp.fromMillis(now),
    lastSentAt: admin.firestore.Timestamp.fromMillis(now),
    sendCount: 1, attempts: 0,
    expiresAt: admin.firestore.Timestamp.fromMillis(now + OTP_TTL_MS)
  });
  return { sent: true, challengeId: dataRef.id, expiresInSeconds: OTP_TTL_MS / 1000 };
});

exports.verifyAccountActivationOtp = onCall(async (request) => {
  const { challengeId: id, code, password } = request.data || {};
  if (!/^[a-f0-9]{48}$/.test(String(id || "")) || !/^\d{6}$/.test(String(code || ""))) {
    throw new HttpsError("invalid-argument", "Invalid verification code.");
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    throw new HttpsError("invalid-argument", "Password must be 8-128 characters.");
  }

  const ref = db.collection("otpChallenges").doc(id);
  const result = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Verification session expired.");
    const c = snap.data();
    if (c.type !== "activation") throw new HttpsError("failed-precondition", "Invalid verification session.");
    if (Date.now() > c.expiresAt.toMillis()) throw new HttpsError("deadline-exceeded", "That code expired.");
    if ((c.attempts || 0) >= MAX_ATTEMPTS) throw new HttpsError("resource-exhausted", "Too many incorrect attempts.");
    if (hashCode(String(code), c.salt) !== c.codeHash) {
      const attempts = (c.attempts || 0) + 1;
      tx.update(ref, { attempts });
      return { ok: false, attemptsLeft: Math.max(0, MAX_ATTEMPTS - attempts) };
    }
    tx.delete(ref);
    return { ok: true, regId: c.regId, email: c.email, fullName: c.fullName };
  });
  if (!result.ok) return result;

  const uid = `student_${result.regId}`;
  try {
    let user;
    try { user = await admin.auth().getUser(uid); }
    catch (e) {
      if (e?.code !== "auth/user-not-found") throw e;
    }
    if (!user) {
      user = await admin.auth().createUser({ uid, email: result.email, password, emailVerified: true, displayName: result.fullName });
    } else {
      if (normalizeEmail(user.email) !== result.email) throw new HttpsError("failed-precondition", "Account identity mismatch.");
      user = await admin.auth().updateUser(uid, { password, emailVerified: true, displayName: result.fullName });
    }
    await admin.auth().setCustomUserClaims(uid, { student: true, regId: result.regId });
    await db.collection("registrations").doc(result.regId).update({
      authUid: uid,
      emailVerified: true
    });
    const token = await admin.auth().createCustomToken(uid, { student: true, regId: result.regId });
    return { ...result, customToken: token };
  } catch (err) {
    console.error("[Activation] account setup failed", err);
    throw err instanceof HttpsError ? err : new HttpsError("internal", "Could not activate the account.");
  }
});

exports.loginStudent = onCall(async () => {
  throw new HttpsError("failed-precondition", "Password login is required. Please use Firebase Authentication.");
});

exports.sendReviewNotification = onCall(async (request) => {
  const token = request.auth?.token;
  if (!token?.email || (token.admin !== true && token.student !== true)) {
    throw new HttpsError("unauthenticated", "Authentication required.");
  }
  const data = request.data || {};
  const isAdmin = token.admin === true;
  if (!isAdmin) await enforceOtpRateLimit(normalizeEmail(token.email), "notify");
  let toEmail = isAdmin ? normalizeEmail(data.toEmail) : normalizeEmail(token.email);
  let resolvedName = String(data.toName || "").slice(0,120);
  if (isAdmin && !validEmail(toEmail) && data.toRegId) {
    const regSnap = await db.collection("registrations").doc(String(data.toRegId)).get();
    if (regSnap.exists) {
      const reg = regSnap.data();
      toEmail = normalizeEmail(reg.email);
      resolvedName = String(reg.fullName || resolvedName).slice(0,120);
    }
  }
  if (!validEmail(toEmail)) throw new HttpsError("invalid-argument", "Invalid recipient.");
  const allowedStatuses = ["Approved","Rejected","Pending","Verified","Unverified","Access Expiring Soon","Access Expired"];
  const status = String(data.status || "");
  if (!allowedStatuses.includes(status)) throw new HttpsError("invalid-argument", "Invalid notification status.");

  const payload = {
    to_email: toEmail,
    to_name: isAdmin ? resolvedName : String(token.name || "").slice(0,120),
    status,
    item_type: String(data.itemType || "").slice(0,120),
    course_code: String(data.courseCode || "").slice(0,50),
    course_name: String(data.courseName || "").slice(0,200),
    detail: String(data.detail || "").slice(0,1000),
    site_name: "Agri Core"
  };
  try {
    const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        service_id: EMAILJS_SERVICE_ID,
        template_id: EMAILJS_TEMPLATE_ID,
        user_id: EMAILJS_PUBLIC_KEY,
        template_params: payload
      })
    });
    if (!response.ok) throw new Error(`Email provider ${response.status}`);
    return { sent: true };
  } catch (err) {
    console.error("[Email] notification failed", err);
    throw new HttpsError("unavailable", "Notification could not be sent.");
  }
});

exports.getPublicStats = onCall(async () => {
  const [registrations, approvedResources, pendingResources, approvedTerms] = await Promise.all([
    db.collection("registrations").count().get(),
    db.collection("resources").where("status", "==", "approved").get(),
    db.collection("resources").where("status", "==", "pending").count().get(),
    db.collection("terms").where("status", "==", "approved").count().get()
  ]);
  let resourceCount = 0;
  for (const d of approvedResources.docs) {
    const item = d.data();
    const files = Array.isArray(item.fileUrls) ? item.fileUrls : [];
    const imageExts = /\.(jpg|jpeg|png|gif|webp|bmp|svg|avif)$/i;
    const docExts = /\.(pdf|ppt|pptx)$/i;
    const type = String(item.fileType || "").toLowerCase();
    resourceCount += files.filter(f => {
      const name = String(f?.name || "");
      return type === "pdf" || type === "ppt" || type === "image" || docExts.test(name) || imageExts.test(name);
    }).length;
  }
  return { users: registrations.data().count, resources: resourceCount, pending: pendingResources.data().count, terms: approvedTerms.data().count };
});

// Legacy Cloudinary signing endpoint intentionally disabled.
// All new uploads use Firebase Storage through the authenticated client SDK.
exports.getCloudinaryUploadSignature = onCall(async () => {
  throw new HttpsError("failed-precondition", "Cloudinary uploads are disabled. Use Firebase Storage.");
});

exports.getPrivateStudentIdUrl = onCall(async (request) => {
  const token = request.auth?.token;
  if (token?.admin !== true || token?.email_verified !== true) throw new HttpsError("permission-denied", "Administrator access required.");
  const regId = String(request.data?.regId || "");
  if (!regId) throw new HttpsError("invalid-argument", "Registration ID is required.");
  const snap = await db.collection("registrations").doc(regId).get();
  if (!snap.exists) throw new HttpsError("not-found", "Registration not found.");
  const path = snap.data().studentIdStoragePath;
  if (!path || !String(path).startsWith("storage://student-ids/")) {
    return { url: snap.data().studentIdUrl || null, legacy: true };
  }
  const storagePath = String(path).slice("storage://".length);
  const [url] = await admin.storage().bucket().file(storagePath).getSignedUrl({
    action: "read",
    expires: Date.now() + 5 * 60 * 1000
  });
  return { url, legacy: false };
});

exports.notifyHelpMessage = onDocumentCreated("messages/{messageId}", async (event) => {
  const data = event.data?.data();
  if (!data || !data.email || !data.message) return;
  try {
    const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        service_id: EMAILJS_SERVICE_ID,
        template_id: "template_help_msg",
        user_id: EMAILJS_PUBLIC_KEY,
        template_params: {
          to_email: "iubatagriculture@gmail.com",
          from_name: String(data.name || "").slice(0,120),
          from_email: normalizeEmail(data.email),
          message: String(data.message || "").slice(0,5000),
          site_name: "Agri Core"
        }
      })
    });
    if (!response.ok) console.error("[Help] Email provider returned", response.status);
  } catch (err) {
    console.error("[Help] notification failed", err);
  }
});
