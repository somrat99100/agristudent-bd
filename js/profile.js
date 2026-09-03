import { db, CLOUDINARY_UPLOAD_URL, CLOUDINARY_UPLOAD_PRESET } from "./firebase-config.js";
import {
  doc, getDoc, updateDoc, deleteDoc, collection, query, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { normalizeEmail } from "./identity.js";
import { getSession, saveSession, clearSession } from "./session.js";
import { initEmailNotifications } from "./email-config.js";
import { computeResourceAccessStatus, maybeSendAccessReminder, renderAccessBadge, renderAccessScale, formatDate, formatRemaining } from "./access.js";
import { checkPasswordStrength, validatePassword, friendlyAuthError, createPasswordAccount, sendResetEmail } from "./password-auth.js";

initEmailNotifications();

function esc(val) {
  return String(val ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

const loadingEl = document.getElementById("profile-loading");
const contentEl = document.getElementById("profile-content");
const loggedOutEl = document.getElementById("profile-logged-out");

function showLoggedOut() {
  loadingEl.classList.add("hidden");
  contentEl.classList.add("hidden");
  loggedOutEl.classList.remove("hidden");
}

// ============================================
// PROFILE AVATAR UPLOAD — tap the camera badge on the circular avatar
// to replace it. Uploads to Cloudinary (same pipeline as blog images),
// then saves the URL onto the student's own registration doc.
// ============================================
const MAX_AVATAR_SIZE = 8 * 1024 * 1024; // 8MB
const avatarWrap = document.getElementById("profile-avatar-wrap");
const avatarImg = document.getElementById("profile-avatar");
const avatarEditBtn = document.getElementById("profile-avatar-edit-btn");
const avatarInput = document.getElementById("profile-avatar-input");
const avatarStatus = document.getElementById("profile-avatar-status");

avatarEditBtn?.addEventListener("click", () => avatarInput?.click());

avatarInput?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  avatarInput.value = "";
  if (!file) return;

  const session = getSession();
  if (!session) return;

  avatarStatus.classList.remove("is-error");

  if (!file.type.startsWith("image/")) {
    avatarStatus.textContent = "Please choose an image file.";
    avatarStatus.classList.add("is-error");
    return;
  }
  if (file.size > MAX_AVATAR_SIZE) {
    avatarStatus.textContent = "Image too large (max 8MB).";
    avatarStatus.classList.add("is-error");
    return;
  }

  avatarStatus.textContent = "Uploading…";
  avatarWrap.classList.add("is-uploading");
  avatarEditBtn.disabled = true;

  // Instant local preview while the real upload runs in the background.
  const previewUrl = URL.createObjectURL(file);
  avatarImg.src = previewUrl;

  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    const response = await fetch(CLOUDINARY_UPLOAD_URL, { method: "POST", body: formData });
    if (!response.ok) throw new Error(`Upload failed (${response.status})`);
    const data = await response.json();
    if (!data.secure_url) throw new Error("Upload failed");

    await updateDoc(doc(db, "registrations", session.regId), { avatarUrl: data.secure_url });

    avatarImg.src = data.secure_url;
    saveSession({ ...session, avatarUrl: data.secure_url });

    // Reflect the change in the navbar avatar immediately too, without
    // needing a page reload.
    document.querySelectorAll(".navbar-auth-avatar").forEach(img => { img.src = data.secure_url; });

    avatarStatus.textContent = "Profile photo updated ✅";
    setTimeout(() => {
      if (avatarStatus.textContent === "Profile photo updated ✅") avatarStatus.textContent = "";
    }, 3000);
  } catch (err) {
    console.error("[Profile] avatar upload failed:", err);
    avatarImg.src = session.avatarUrl || (session.gender === "female" ? "assets/avatar-female.svg" : "assets/avatar-male.svg");
    avatarStatus.textContent = "Upload failed — check your connection and try again.";
    avatarStatus.classList.add("is-error");
  } finally {
    avatarWrap.classList.remove("is-uploading");
    avatarEditBtn.disabled = false;
    URL.revokeObjectURL(previewUrl);
  }
});

async function init() {
  const session = getSession();
  if (!session) { showLoggedOut(); return; }

  try {
    // Re-fetch the live registration record rather than trusting the
    // cached session — status can change (admin verifies/rejects) after
    // login, and this keeps the profile accurate.
    const regSnap = await getDoc(doc(db, "registrations", session.regId));
    if (!regSnap.exists()) {
      clearSession();
      showLoggedOut();
      return;
    }
    const reg = regSnap.data();
    // Keep the local session in sync with any status change.
    saveSession({
      regId: session.regId,
      fullName: reg.fullName,
      email: reg.email,
      studentIdNumber: reg.studentIdNumber,
      gender: reg.gender,
      avatarUrl: reg.avatarUrl,
      status: reg.status || "unverified"
    });

    renderIdentity(reg);
    renderPasswordSection(reg, session.regId);

    // Each section loads independently — a failure in one (e.g. a blocked
    // Firestore query for blog posts) no longer blanks out the whole page.
    loadingEl.classList.add("hidden");
    contentEl.classList.remove("hidden");

    try {
      await renderCredits(normalizeEmail(reg.email), reg.fullName);
    } catch (err) {
      console.error("[Profile] failed to load resource credits:", err);
      const listEl = document.getElementById("uploads-list");
      if (listEl) listEl.innerHTML = `<p style="color:var(--terracotta-500);font-size:.85rem;">Couldn't load your uploads right now. <button type="button" id="retry-credits" style="background:none;border:none;color:var(--leaf-500);font-weight:600;cursor:pointer;text-decoration:underline;">Retry</button></p>`;
      document.getElementById("retry-credits")?.addEventListener("click", () => renderCredits(normalizeEmail(reg.email), reg.fullName).catch(e => console.error(e)));
    }

    try {
      await renderMyBlogPosts(normalizeEmail(reg.email));
    } catch (err) {
      console.error("[Profile] failed to load blog posts:", err);
    }
  } catch (err) {
    console.error("[Profile] failed to load:", err);
    loadingEl.innerHTML = `
      <p style="color:var(--terracotta-500);font-weight:600;">Something went wrong loading your profile.</p>
      <p style="font-size:.85rem;color:var(--moss-600);margin-top:.4rem;">${esc(err?.message || "Please check your connection and try again.")}</p>
      <button type="button" id="profile-retry-btn" class="btn-primary" style="margin-top:1rem;">Try Again</button>`;
    document.getElementById("profile-retry-btn")?.addEventListener("click", () => {
      loadingEl.innerHTML = "Loading your profile…";
      init();
    });
  }
}

function renderIdentity(reg) {
  document.getElementById("profile-avatar").src = reg.avatarUrl || (reg.gender === "female" ? "assets/avatar-female.svg" : "assets/avatar-male.svg");
  document.getElementById("profile-name").textContent = reg.fullName || "—";
  document.getElementById("profile-email").textContent = reg.email || "—";
  document.getElementById("profile-studentid").textContent = reg.studentIdNumber || "—";

  const idBadge = document.getElementById("profile-id-verified-badge");
  const avatarWrapEl = document.getElementById("profile-avatar-wrap");
  idBadge?.classList.toggle("hidden", !reg.idVerified);
  avatarWrapEl?.classList.toggle("is-id-verified", !!reg.idVerified);

  const status = reg.status || "unverified";
  const pill = document.getElementById("profile-status-pill");
  const note = document.getElementById("profile-status-note");
  const labels = { verified: "✅ Verified", unverified: "🕓 Unverified", rejected: "❌ Rejected" };
  pill.textContent = labels[status] || status;
  pill.className = "profile-status-pill " + status;

  if (status !== "verified") {
    note.classList.remove("hidden");
    note.innerHTML = status === "rejected"
      ? `<p>Your registration was rejected. Please <a href="register.html" style="color:var(--leaf-500);font-weight:600;">register again</a> with correct details.</p>`
      : `<p>Your registration is still awaiting admin review — this usually takes 24–48 hours. You'll get full access once verified.</p>`;
  } else {
    note.classList.add("hidden");
  }
}

// ============================================
// ACCOUNT SECURITY / PASSWORD SETUP
// Already-registered students who signed up before password login
// existed get a banner + form here to set one up. Once passwordSet is
// true, this instead shows a "Change Password" (reset-email) option.
// ============================================
function renderPasswordSection(reg, regId) {
  const section = document.getElementById("password-section");
  if (!section) return;
  section.classList.remove("hidden");

  const banner = document.getElementById("password-setup-banner");
  const setupForm = document.getElementById("password-setup-form");
  const enabledNote = document.getElementById("password-enabled-note");

  if (reg.passwordSet) {
    banner.classList.add("hidden");
    setupForm.classList.add("hidden");
    enabledNote.classList.remove("hidden");
  } else {
    banner.classList.remove("hidden");
    setupForm.classList.remove("hidden");
    enabledNote.classList.add("hidden");
  }

  wirePasswordSetupForm(reg, regId);
  wirePasswordResetButton(reg);
}

let passwordSetupWired = false;
function wirePasswordSetupForm(reg, regId) {
  const form = document.getElementById("password-setup-form");
  const newPasswordInput = document.getElementById("new-password");
  const confirmInput = document.getElementById("new-password-confirm");
  const toggleBtn = document.getElementById("new-password-toggle");
  const strengthEl = document.getElementById("new-password-strength");
  const submitBtn = document.getElementById("password-setup-submit");
  const statusEl = document.getElementById("password-setup-status");
  if (!form) return;

  function showStatus(msg, isError = false) {
    statusEl.textContent = msg;
    statusEl.style.color = isError ? "var(--terracotta-500)" : "var(--leaf-500)";
    statusEl.classList.remove("hidden");
  }

  if (passwordSetupWired) return; // listeners attached once; reg/regId read fresh via closures below
  passwordSetupWired = true;

  newPasswordInput?.addEventListener("input", () => {
    const { label, color } = checkPasswordStrength(newPasswordInput.value);
    strengthEl.textContent = newPasswordInput.value ? `Strength: ${label}` : "At least 8 characters, with a letter and a number.";
    strengthEl.style.color = newPasswordInput.value ? color : "var(--moss-600)";
  });

  toggleBtn?.addEventListener("click", () => {
    const showing = newPasswordInput.type === "text";
    newPasswordInput.type = showing ? "password" : "text";
    confirmInput.type = showing ? "password" : "text";
    toggleBtn.textContent = showing ? "👁️" : "🙈";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const session = getSession();
    if (!session) return;

    const password = newPasswordInput.value;
    const confirm = confirmInput.value;

    const check = validatePassword(password);
    if (!check.ok) { showStatus(check.message, true); return; }
    if (password !== confirm) { showStatus("Passwords do not match.", true); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = "Saving…";
    showStatus("Setting up your password…");

    try {
      const authUser = await createPasswordAccount(session.email, password);
      await updateDoc(doc(db, "registrations", session.regId), {
        passwordSet: true,
        authUid: authUser.uid
      });

      showStatus("✅ Password set! Next time, log in with your Student ID and password.");
      form.reset();
      form.classList.add("hidden");
      document.getElementById("password-setup-banner")?.classList.add("hidden");
      document.getElementById("password-enabled-note")?.classList.remove("hidden");
    } catch (err) {
      console.error("[Profile] password setup failed:", err);
      showStatus(friendlyAuthError(err), true);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Set Password";
    }
  });
}

function wirePasswordResetButton(reg) {
  const btn = document.getElementById("password-reset-btn");
  const statusEl = document.getElementById("password-reset-status");
  if (!btn || btn.dataset.wired) return;
  btn.dataset.wired = "1";

  btn.addEventListener("click", async () => {
    const session = getSession();
    if (!session) return;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "Sending…";
    try {
      await sendResetEmail(session.email);
      statusEl.textContent = `✅ A password reset link was sent to ${session.email}.`;
      statusEl.style.color = "var(--leaf-500)";
      statusEl.classList.remove("hidden");
    } catch (err) {
      console.error("[Profile] password reset email failed:", err);
      statusEl.textContent = friendlyAuthError(err);
      statusEl.style.color = "var(--terracotta-500)";
      statusEl.classList.remove("hidden");
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });
}

async function renderCredits(email, fullName) {
  const [resourcesSnap, termsSnap, classroomSnap] = await Promise.all([
    getDocs(query(collection(db, "resources"), where("uploaderEmail", "==", email))),
    getDocs(query(collection(db, "terms"), where("uploaderEmail", "==", email))),
    getDocs(query(collection(db, "classroomCodes"), where("fromEmail", "==", email))).catch(() => ({ docs: [] }))
  ]);

  const items = [
    ...resourcesSnap.docs.map(d => ({ id: d.id, kind: "resource", ...d.data() })),
    ...termsSnap.docs.map(d => ({ id: d.id, kind: "term", ...d.data() }))
  ].sort((a, b) => (b.submittedAt?.toDate?.() || 0) - (a.submittedAt?.toDate?.() || 0));

  // Classroom-code unlocks aren't shown in "My Contributions" (they aren't
  // reviewed uploads) but they DO count toward resource access time.
  const classroomItems = classroomSnap.docs.map(d => ({ id: d.id, kind: "classroom", status: "approved", ...d.data() }));

  const approved = items.filter(i => i.status === "approved").length;
  const pending = items.filter(i => (i.status || "pending") === "pending").length;
  const rejected = items.filter(i => i.status === "rejected").length;

  document.getElementById("stat-total").textContent = items.length;
  document.getElementById("stat-approved").textContent = approved;
  document.getElementById("stat-pending").textContent = pending;
  document.getElementById("stat-rejected").textContent = rejected;

  // Resource access is based only on actual resource files. Each approved
  // file grants 24h; pending uploads provide up to 12h temporary access.
  const resourceItems = items.filter(i => i.kind === "resource" && i.resourceType === "slides_notes");
  const access = computeResourceAccessStatus([...resourceItems, ...classroomItems]);
  renderAccessBadge({
    badgeEl: document.getElementById("access-badge"),
    detailEl: document.getElementById("access-detail")
  }, access);
  maybeSendAccessReminder(access, { email, name: fullName });

  // The scale bar shows how much of the MOST RECENTLY granted top-up is
  // left (24h/file, 6h/code, 12h pending) — access.lastGrantMs already
  // accounts for which kind of grant is currently the active one.
  renderAccessScale({
    wrapEl: document.getElementById("access-scale-wrap"),
    fillEl: document.getElementById("access-scale-fill"),
    remainingEl: document.getElementById("access-scale-remaining"),
    untilEl: document.getElementById("access-scale-until")
  }, access, access.lastGrantMs);

  const accessDetail = document.getElementById("access-detail");
  const accessAlert = document.getElementById("resource-access-alert");
  if (accessAlert) {
    if (access.restricted) {
      accessAlert.classList.remove("hidden");
      accessAlert.innerHTML = `⚠️ Upload relevant files only. Resource access and uploads are restricted until ${formatDate(access.restrictedUntil)}.`;
    } else {
      accessAlert.classList.add("hidden");
      accessAlert.innerHTML = "";
    }
  }
  if (accessDetail && access.restricted) {
    accessDetail.innerHTML = `⚠️ <strong>Upload relevant files only.</strong> You are restricted until <strong>${formatDate(access.restrictedUntil)}</strong>.`;
  } else if (accessDetail && access.active) {
    accessDetail.textContent = `${access.daysRemaining} day${access.daysRemaining === 1 ? "" : "s"} remaining · expires ${formatDate(access.accessUntil)}`;
  }

  const listEl = document.getElementById("uploads-list");
  const emptyEl = document.getElementById("uploads-empty");

  if (items.length === 0) {
    listEl.innerHTML = "";
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  listEl.innerHTML = items.map(item => {
    const status = item.status || "pending";
    const title = item.kind === "term"
      ? `📖 ${esc(item.name || "Untitled term")}`
      : `📄 ${esc(item.courseCode || "Unknown course")} — ${esc(item.resourceType === "previous_questions" ? "Previous Questions" : "Slides/Notes")}`;
    const date = item.submittedAt?.toDate?.() ? formatDate(item.submittedAt.toDate()) : "";
    return `
      <div class="upload-row">
        <div>
          <div style="font-weight:600;font-size:.92rem;">${title}</div>
          <div style="font-size:.75rem;color:var(--moss-600);">${date}</div>
        </div>
        <span class="status-tag ${esc(status)}">${status === "approved" ? "✅ Approved" : status === "rejected" ? "❌ Rejected" : "⏳ Pending"}</span>
      </div>`;
  }).join("");
}

// ============================================
// MY BLOG POSTS — lets the student edit or delete their own posts
// without hunting for them in the main feed. Edit hands off to
// blog.html?editPost=ID, which loads the same composer used on the
// blog page itself (title, body, and gallery images all carried over,
// updating the original post in place rather than creating a new one).
// ============================================
function blogStatusTag(status) {
  if (status === "pending_edit") return { cls: "pending", text: "📝 Pending Approval" };
  if (status === "approved") return { cls: "approved", text: "✅ Verified" };
  if (status === "rejected") return { cls: "rejected", text: "❌ Rejected" };
  return { cls: "pending", text: "🕓 Not verified" };
}

async function renderMyBlogPosts(email) {
  const listEl = document.getElementById("my-posts-list");
  const emptyEl = document.getElementById("my-posts-empty");
  if (!listEl) return;

  let posts;
  try {
    const snap = await getDocs(query(collection(db, "blogPosts"), where("authorEmail", "==", email)));
    posts = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.toDate?.() || 0) - (a.createdAt?.toDate?.() || 0));
  } catch (err) {
    console.error("[Profile] failed to load blog posts:", err);
    return;
  }

  if (posts.length === 0) {
    listEl.innerHTML = "";
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  listEl.innerHTML = posts.map(item => {
    const tag = blogStatusTag(item.status);
    const date = item.createdAt?.toDate?.() ? formatDate(item.createdAt.toDate()) : "";
    return `
      <div class="upload-row" data-post-id="${esc(item.id)}">
        <div>
          <div style="font-weight:600;font-size:.92rem;">${esc(item.title || "Untitled post")}</div>
          <div style="font-size:.75rem;color:var(--moss-600);">${date} · 👁️ ${item.views || 0} views</div>
        </div>
        <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;">
          <span class="status-tag ${tag.cls}">${tag.text}</span>
          <button type="button" class="my-post-edit-btn" data-id="${esc(item.id)}"
            style="background:none;border:1px solid var(--line);border-radius:6px;padding:.3rem .6rem;font-size:.78rem;cursor:pointer;">✏️ Edit</button>
          <button type="button" class="my-post-delete-btn" data-id="${esc(item.id)}"
            style="background:none;border:1px solid var(--terracotta-500);color:var(--terracotta-500);border-radius:6px;padding:.3rem .6rem;font-size:.78rem;cursor:pointer;">🗑️ Delete</button>
        </div>
      </div>`;
  }).join("");

  listEl.querySelectorAll(".my-post-edit-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      window.location.href = `blog.html?editPost=${encodeURIComponent(btn.dataset.id)}`;
    });
  });

  listEl.querySelectorAll(".my-post-delete-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this blog post? This cannot be undone.")) return;
      btn.disabled = true;
      try {
        await deleteDoc(doc(db, "blogPosts", btn.dataset.id));
        listEl.querySelector(`[data-post-id="${btn.dataset.id}"]`)?.remove();
        if (!listEl.children.length) emptyEl.classList.remove("hidden");
      } catch (err) {
        console.error("[Profile] failed to delete post:", err);
        alert("Failed to delete post. Please try again.");
        btn.disabled = false;
      }
    });
  });
}

const logoutBtn = document.getElementById("profile-logout-btn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    clearSession();
    window.location.href = "index.html";
  });
}

init();
