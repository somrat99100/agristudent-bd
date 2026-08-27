import { db, storage } from "./firebase-config.js";
import {
  doc, getDoc, updateDoc, deleteDoc, collection, query, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { normalizeEmail } from "./identity.js";
import { getSession, saveSession, clearSession } from "./session.js";
import { initEmailNotifications } from "./email-config.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { computeResourceAccessStatus, maybeSendAccessReminder, renderAccessBadge, formatDate, formatRemaining } from "./access.js";

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
// to replace it. Uploads to Firebase Storage (same pipeline as blog images),
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
    const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-120);
    const storageRef = ref(storage, `avatars/${session.uid}/${crypto.randomUUID()}-${safeName}`);
    await uploadBytes(storageRef, file, { contentType: file.type });
    const avatarUrl = await getDownloadURL(storageRef);
    await updateDoc(doc(db, "registrations", session.uid), { avatarUrl });

    avatarImg.src = avatarUrl;
    saveSession({ ...session, avatarUrl });

    // Reflect the change in the navbar avatar immediately too, without
    // needing a page reload.
    document.querySelectorAll(".navbar-auth-avatar").forEach(img => { img.src = avatarUrl; });

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
    await renderCredits(reg.uid, reg.fullName);
    await renderMyBlogPosts(reg.uid);

    loadingEl.classList.add("hidden");
    contentEl.classList.remove("hidden");
  } catch (err) {
    console.error("[Profile] failed to load:", err);
    loadingEl.textContent = "Something went wrong loading your profile. Please try again.";
  }
}

function renderIdentity(reg) {
  document.getElementById("profile-avatar").src = reg.avatarUrl || (reg.gender === "female" ? "assets/avatar-female.svg" : "assets/avatar-male.svg");
  document.getElementById("profile-name").textContent = reg.fullName || "—";
  document.getElementById("profile-email").textContent = reg.email || "—";
  document.getElementById("profile-studentid").textContent = reg.studentIdNumber || "—";

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

async function renderCredits(uid, fullName) {
  const [resourcesSnap, termsSnap, accessSnap] = await Promise.all([
    getDocs(query(collection(db, "resources"), where("status", "==", "approved"), where("public", "==", true), where("uploaderUid", "==", uid))),
    getDocs(query(collection(db, "terms"), where("status", "==", "approved"), where("public", "==", true), where("uploaderUid", "==", uid))),
    getDoc(doc(db, "resourceAccess", uid))
  ]);

  const items = [
    ...resourcesSnap.docs.map(d => ({ id: d.id, kind: "resource", ...d.data() })),
    ...termsSnap.docs.map(d => ({ id: d.id, kind: "term", ...d.data() }))
  ].sort((a, b) => (b.submittedAt?.toDate?.() || 0) - (a.submittedAt?.toDate?.() || 0));

  const approved = items.length;
  const pending = 0;
  const rejected = 0;

  document.getElementById("stat-total").textContent = items.length;
  document.getElementById("stat-approved").textContent = approved;
  document.getElementById("stat-pending").textContent = pending;
  document.getElementById("stat-rejected").textContent = rejected;

  const accessData = accessSnap?.exists?.() ? accessSnap.data() : {};
  const now = Date.now();
  const restrictedUntil = accessData.restrictedUntil?.toDate?.()?.getTime?.() || 0;
  const accessUntil = accessData.accessUntil?.toDate?.()?.getTime?.() || 0;
  const access = {
    active: restrictedUntil <= now && accessUntil > now,
    restricted: restrictedUntil > now,
    restrictedUntil: restrictedUntil ? new Date(restrictedUntil) : null,
    accessUntil: accessUntil ? new Date(accessUntil) : null,
    approvedFileCount: accessData.approvedFileCount || 0, pendingActiveCount: 0,
    daysRemaining: Math.max(0, Math.ceil((accessUntil-now)/86400000)),
    hoursRemaining: Math.max(0, Math.ceil((accessUntil-now)/3600000)),
    msRemaining: Math.max(0, accessUntil-now)
  };
  renderAccessBadge({ badgeEl: document.getElementById("access-badge"), detailEl: document.getElementById("access-detail") }, access);

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

async function renderMyBlogPosts(uid) {
  const listEl = document.getElementById("my-posts-list");
  const emptyEl = document.getElementById("my-posts-empty");
  if (!listEl) return;

  let posts;
  try {
    const snap = await getDocs(query(collection(db, "blogPosts"), where("status", "==", "approved"), where("public", "==", true), where("authorUid", "==", uid)));
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
