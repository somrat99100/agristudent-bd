// ============================================
// AGRISTUDENT BD — blog.js
// Facebook-style student timeline: any registered (logged-in) student
// can write a post with a title, formatted paragraphs and inline
// images. It appears in the public timeline immediately, watermarked
// "Not verified" until an admin reviews it in admin.html — approved
// posts get a green "Approved" corner badge instead. Everyone (logged
// in or not) can browse, like, comment and share; each post tracks a
// view count.
//
// Trust model: identical to js/resources.js — students never hold a
// Firebase Auth session, only a "registration" record + a localStorage
// session (see js/session.js). So every write here is unauthenticated
// and relies on firestore.rules field validation, not request.auth.
// ============================================
import { db, CLOUDINARY_UPLOAD_URL, CLOUDINARY_UPLOAD_PRESET } from "./firebase-config.js";
import {
  collection, addDoc, updateDoc, deleteDoc, doc, getDoc, setDoc,
  query, orderBy, limit, startAfter, getDocs, where, serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { normalizeEmail } from "./identity.js";
import { getSession } from "./session.js";
import { initEmailNotifications } from "./email-config.js";

initEmailNotifications();

const PAGE_SIZE = 8;
const MAX_IMAGE_SIZE = 8 * 1024 * 1024; // 8MB per image

// ============================================
// ESCAPE HELPER (same convention as js/resources.js / js/admin.js)
// ============================================
function esc(val) {
  return String(val ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// ============================================
// RICH-TEXT SANITIZER
// The composer is a contenteditable box, so what the browser hands back
// is raw HTML the student's browser produced. We never trust it as-is:
// we walk it and rebuild a brand-new HTML string keeping only a small
// safe allowlist of tags/attributes. Anything else (scripts, event
// handler attributes, iframes, styles…) is dropped, not escaped-in.
// ============================================
const ALLOWED_TAGS = new Set(["B", "STRONG", "I", "EM", "U", "BR", "P", "DIV", "UL", "OL", "LI", "IMG", "SPAN"]);

function sanitizeNode(node, out) {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push(esc(node.textContent));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const tag = node.tagName;
  if (!ALLOWED_TAGS.has(tag)) {
    // Unwrap unknown tags (e.g. a stray <a> or <font>) but keep their
    // text/child content flowing through.
    node.childNodes.forEach(child => sanitizeNode(child, out));
    return;
  }

  if (tag === "BR") { out.push("<br>"); return; }

  if (tag === "IMG") {
    const src = node.getAttribute("src") || "";
    // Only ever allow our own Cloudinary-hosted images — never a data:
    // or javascript: URI, and never an arbitrary third-party host.
    if (/^https:\/\/res\.cloudinary\.com\//.test(src)) {
      out.push(`<img src="${esc(src)}" alt="" loading="lazy">`);
    }
    return;
  }

  const openTag = tag.toLowerCase();
  out.push(`<${openTag}>`);
  node.childNodes.forEach(child => sanitizeNode(child, out));
  out.push(`</${openTag}>`);
}

function sanitizeHTML(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const out = [];
  template.content.childNodes.forEach(node => sanitizeNode(node, out));
  return out.join("").trim();
}

function plainTextLength(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent || "").trim().length;
}

// ============================================
// TIME-AGO HELPER
// ============================================
function timeAgo(date) {
  if (!date) return "";
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

// ============================================
// CLOUDINARY UPLOAD (same pattern as js/resources.js)
// ============================================
function uploadImageToCloudinary(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", CLOUDINARY_UPLOAD_URL, true);
    xhr.timeout = 120000;
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText).secure_url);
      } else {
        reject(new Error(`Image upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error uploading image."));
    xhr.ontimeout = () => reject(new Error("Image upload timed out."));
    const data = new FormData();
    data.append("file", file);
    data.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    xhr.send(data);
  });
}

// ============================================
// LOCAL "SEEN" TRACKING — one view counted per browser per post, and
// one like toggle cached locally so the heart reflects state instantly
// without waiting on a round trip.
// ============================================
const VIEWED_KEY = "agri_blog_viewed_v1";
function getViewedSet() {
  try { return new Set(JSON.parse(localStorage.getItem(VIEWED_KEY) || "[]")); }
  catch { return new Set(); }
}
function markViewed(postId) {
  const set = getViewedSet();
  set.add(postId);
  try { localStorage.setItem(VIEWED_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}

// ============================================
// SESSION / IDENTITY HELPERS
// ============================================
function requireSession() {
  const session = getSession();
  if (!session) {
    if (confirm("You need to be logged in to do that. Go to the login page now?")) {
      window.location.href = "login.html";
    }
    return null;
  }
  return session;
}

// ============================================
// DOM REFS
// ============================================
const composerLoggedOut = document.getElementById("composer-logged-out");
const composerLoggedIn = document.getElementById("composer-logged-in");
const composerAvatar = document.getElementById("composer-avatar");
const composerOpenBtn = document.getElementById("composer-open-btn");
const composerModal = document.getElementById("composer-modal");
const composerClose = document.getElementById("composer-close");
const postTitleInput = document.getElementById("post-title-input");
const postBodyInput = document.getElementById("post-body-input");
const postImageInput = document.getElementById("post-image-input");
const postSubmitBtn = document.getElementById("post-submit-btn");
const postError = document.getElementById("post-error");
const postUploadStatus = document.getElementById("post-upload-status");
const feedEl = document.getElementById("blog-feed");
const loadMoreBtn = document.getElementById("blog-load-more");
const feedEmpty = document.getElementById("blog-feed-empty");

const session = getSession();
if (session) {
  composerLoggedOut?.classList.add("hidden");
  composerLoggedIn?.classList.remove("hidden");
  if (composerAvatar) composerAvatar.src = session.avatarUrl || "assets/avatar-male.svg";
} else {
  composerLoggedOut?.classList.remove("hidden");
  composerLoggedIn?.classList.add("hidden");
}

// ============================================
// COMPOSER — open/close modal
// ============================================
function openComposer() {
  if (!requireSession()) return;
  composerModal.classList.remove("hidden");
  postTitleInput.focus();
}
function closeComposer() {
  composerModal.classList.add("hidden");
  postError.classList.add("hidden");
  postUploadStatus.textContent = "";
}
composerOpenBtn?.addEventListener("click", openComposer);
composerClose?.addEventListener("click", closeComposer);
composerModal?.addEventListener("click", (e) => { if (e.target === composerModal) closeComposer(); });

// ============================================
// COMPOSER — formatting toolbar (Bold/Italic/Underline/List) via
// execCommand on the contenteditable body. Whatever this produces gets
// re-sanitized before it's ever sent to Firestore (see sanitizeHTML).
// ============================================
document.querySelectorAll(".composer-format-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    postBodyInput.focus();
    document.execCommand(btn.dataset.cmd, false, null);
  });
});

// ============================================
// COMPOSER — insert image inline at the cursor
// ============================================
postImageInput?.addEventListener("change", async () => {
  const files = Array.from(postImageInput.files || []);
  postImageInput.value = "";
  if (files.length === 0) return;

  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    if (file.size > MAX_IMAGE_SIZE) {
      postError.textContent = `"${file.name}" is larger than 8MB — please use a smaller image.`;
      postError.classList.remove("hidden");
      continue;
    }
    postUploadStatus.textContent = `Uploading ${file.name}…`;
    try {
      const url = await uploadImageToCloudinary(file, (pct) => {
        postUploadStatus.textContent = `Uploading ${file.name}… ${pct}%`;
      });
      postBodyInput.focus();
      document.execCommand("insertHTML", false, `<img src="${url}" alt="">&nbsp;`);
      postUploadStatus.textContent = "";
    } catch (err) {
      console.error("[Blog] image upload failed:", err);
      postError.textContent = "Image upload failed — please try again.";
      postError.classList.remove("hidden");
      postUploadStatus.textContent = "";
    }
  }
});

// ============================================
// COMPOSER — submit new post
// ============================================
postSubmitBtn?.addEventListener("click", async () => {
  const session2 = requireSession();
  if (!session2) return;

  postError.classList.add("hidden");
  const title = postTitleInput.value.trim();
  const sanitized = sanitizeHTML(postBodyInput.innerHTML);
  const textLen = plainTextLength(sanitized);
  const hasImage = /<img\s/.test(sanitized);

  if (!title) { postError.textContent = "Please add a title."; postError.classList.remove("hidden"); return; }
  if (title.length > 200) { postError.textContent = "Title is too long (max 200 characters)."; postError.classList.remove("hidden"); return; }
  if (textLen === 0 && !hasImage) { postError.textContent = "Please write something before posting."; postError.classList.remove("hidden"); return; }
  if (sanitized.length > 20000) { postError.textContent = "Post is too long — please shorten it."; postError.classList.remove("hidden"); return; }

  postSubmitBtn.disabled = true;
  postSubmitBtn.textContent = "Posting…";
  try {
    await addDoc(collection(db, "blogPosts"), {
      title,
      content: sanitized,
      authorEmail: normalizeEmail(session2.email),
      authorRegId: session2.regId,
      authorName: session2.fullName || session2.email,
      authorAvatar: session2.avatarUrl || "assets/avatar-male.svg",
      authorStudentId: session2.studentIdNumber || "",
      status: "pending",
      likesCount: 0,
      commentsCount: 0,
      sharesCount: 0,
      views: 0,
      createdAt: serverTimestamp()
    });

    postTitleInput.value = "";
    postBodyInput.innerHTML = "";
    closeComposer();
    resetFeed();
    loadMorePosts();
  } catch (err) {
    console.error("[Blog] post submit failed:", err);
    postError.textContent = "Something went wrong posting your update. Please try again.";
    postError.classList.remove("hidden");
  } finally {
    postSubmitBtn.disabled = false;
    postSubmitBtn.textContent = "📝 Post";
  }
});

// ============================================
// FEED — render one post card
// ============================================
function statusBadgeHTML(status) {
  if (status === "approved") return `<span class="blog-badge blog-badge--approved">✅ Approved</span>`;
  if (status === "rejected") return `<span class="blog-badge blog-badge--rejected">❌ Not approved</span>`;
  return `<span class="blog-badge blog-badge--pending">🕓 Not verified</span>`;
}

function renderPostCard(id, item) {
  const created = item.createdAt?.toDate?.() || null;
  const article = document.createElement("article");
  article.className = "blog-post-card";
  article.dataset.id = id;

  const viewed = getViewedSet();
  const alreadyLiked = localStorage.getItem(`agri_blog_liked_${id}`) === "1";

  article.innerHTML = `
    ${statusBadgeHTML(item.status)}
    <header class="blog-post-header">
      <img class="blog-post-avatar" src="${esc(item.authorAvatar || "assets/avatar-male.svg")}" alt="">
      <div>
        <div class="blog-post-author">${esc(item.authorName || "Student")}${item.authorStudentId ? ` <span class="blog-post-studentid">· ${esc(item.authorStudentId)}</span>` : ""}</div>
        <div class="blog-post-time">${esc(timeAgo(created))}</div>
      </div>
    </header>
    <h2 class="blog-post-title">${esc(item.title)}</h2>
    <div class="blog-post-body">${item.content}</div>
    <div class="blog-post-stats">
      <span>👁️ ${item.views || 0} views</span>
      <span class="blog-like-count">❤️ ${item.likesCount || 0}</span>
      <span class="blog-comment-count">💬 ${item.commentsCount || 0}</span>
      <span>↗️ ${item.sharesCount || 0}</span>
    </div>
    <div class="blog-post-actions">
      <button type="button" class="blog-action-btn blog-like-btn ${alreadyLiked ? "is-active" : ""}">
        ${alreadyLiked ? "❤️" : "🤍"} Like
      </button>
      <button type="button" class="blog-action-btn blog-comment-toggle">💬 Comment</button>
      <button type="button" class="blog-action-btn blog-share-btn">↗️ Share</button>
    </div>
    <div class="blog-comments-section hidden">
      <div class="blog-comments-list"></div>
      <div class="blog-comment-composer"></div>
    </div>
  `;

  wirePostCard(article, id, item);

  // Count a view once per browser, the first time the card actually
  // scrolls into view (not just because the feed happened to fetch it).
  if (!viewed.has(id)) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          markViewed(id);
          updateDoc(doc(db, "blogPosts", id), { views: increment(1) }).catch(() => {});
          const el = article.querySelector(".blog-post-stats span");
          if (el) el.textContent = `👁️ ${(item.views || 0) + 1} views`;
          io.disconnect();
        }
      });
    }, { threshold: 0.4 });
    io.observe(article);
  }

  return article;
}

// ============================================
// FEED — wire up like / comment / share on a rendered card
// ============================================
function wirePostCard(article, id, item) {
  const likeBtn = article.querySelector(".blog-like-btn");
  const likeCountEl = article.querySelector(".blog-like-count");
  const commentToggle = article.querySelector(".blog-comment-toggle");
  const commentsSection = article.querySelector(".blog-comments-section");
  const commentsList = article.querySelector(".blog-comments-list");
  const commentComposer = article.querySelector(".blog-comment-composer");
  const commentCountEl = article.querySelector(".blog-comment-count");
  const shareBtn = article.querySelector(".blog-share-btn");

  let commentsLoaded = false;

  likeBtn.addEventListener("click", async () => {
    const s = requireSession();
    if (!s) return;
    const likeId = `${id}_${normalizeEmail(s.email)}`;
    const isLiked = likeBtn.classList.contains("is-active");
    likeBtn.disabled = true;
    try {
      if (isLiked) {
        await deleteDoc(doc(db, "blogLikes", likeId));
        await updateDoc(doc(db, "blogPosts", id), { likesCount: increment(-1) });
        item.likesCount = Math.max(0, (item.likesCount || 1) - 1);
        likeBtn.classList.remove("is-active");
        likeBtn.innerHTML = "🤍 Like";
        localStorage.removeItem(`agri_blog_liked_${id}`);
      } else {
        await setDoc(doc(db, "blogLikes", likeId), { postId: id, email: normalizeEmail(s.email), createdAt: serverTimestamp() });
        await updateDoc(doc(db, "blogPosts", id), { likesCount: increment(1) });
        item.likesCount = (item.likesCount || 0) + 1;
        likeBtn.classList.add("is-active");
        likeBtn.innerHTML = "❤️ Like";
        localStorage.setItem(`agri_blog_liked_${id}`, "1");
      }
      likeCountEl.textContent = `❤️ ${item.likesCount}`;
    } catch (err) {
      console.error("[Blog] like toggle failed:", err);
      alert("Something went wrong. Please try again.");
    } finally {
      likeBtn.disabled = false;
    }
  });

  commentToggle.addEventListener("click", async () => {
    commentsSection.classList.toggle("hidden");
    if (!commentsSection.classList.contains("hidden") && !commentsLoaded) {
      commentsLoaded = true;
      await loadComments(id, commentsList);
      renderCommentComposer(commentComposer, id, commentsList, commentCountEl, item);
    }
  });

  shareBtn.addEventListener("click", async () => {
    const url = `${window.location.origin}${window.location.pathname}?post=${id}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: item.title, url });
      } else {
        await navigator.clipboard.writeText(url);
        alert("Link copied to clipboard!");
      }
      await updateDoc(doc(db, "blogPosts", id), { sharesCount: increment(1) });
      item.sharesCount = (item.sharesCount || 0) + 1;
      const statEl = article.querySelectorAll(".blog-post-stats span")[3];
      if (statEl) statEl.textContent = `↗️ ${item.sharesCount}`;
    } catch (err) {
      // User cancelled the native share sheet — not an error worth logging.
    }
  });
}

// ============================================
// COMMENTS — load + render existing comments for a post
// ============================================
async function loadComments(postId, listEl) {
  listEl.innerHTML = `<p class="blog-comments-loading">Loading comments…</p>`;
  try {
    const q = query(collection(db, "blogComments"), where("postId", "==", postId));
    const snap = await getDocs(q);
    if (snap.empty) {
      listEl.innerHTML = `<p class="blog-comments-empty">No comments yet — be the first!</p>`;
      return;
    }
    const comments = snap.docs
      .map(d => d.data())
      .sort((a, b) => (a.createdAt?.toDate?.() || 0) - (b.createdAt?.toDate?.() || 0));

    listEl.innerHTML = comments.map(c => `
      <div class="blog-comment-row">
        <img src="${esc(c.authorAvatar || "assets/avatar-male.svg")}" alt="" class="blog-comment-avatar">
        <div class="blog-comment-bubble">
          <div class="blog-comment-author">${esc(c.authorName || "Student")}</div>
          <div class="blog-comment-text">${esc(c.text)}</div>
        </div>
      </div>
    `).join("");
  } catch (err) {
    console.error("[Blog] loading comments failed:", err);
    listEl.innerHTML = `<p class="blog-comments-empty">Couldn't load comments.</p>`;
  }
}

function renderCommentComposer(container, postId, listEl, commentCountEl, item) {
  const s = getSession();
  if (!s) {
    container.innerHTML = `<p class="blog-comment-login-hint"><a href="login.html">Log in</a> to leave a comment.</p>`;
    return;
  }
  container.innerHTML = `
    <div class="blog-comment-input-row">
      <img src="${esc(s.avatarUrl || "assets/avatar-male.svg")}" alt="" class="blog-comment-avatar">
      <input type="text" class="blog-comment-input" placeholder="Write a comment…" maxlength="2000">
      <button type="button" class="blog-comment-send-btn">Send</button>
    </div>
  `;
  const input = container.querySelector(".blog-comment-input");
  const sendBtn = container.querySelector(".blog-comment-send-btn");

  async function submitComment() {
    const text = input.value.trim();
    if (!text) return;
    sendBtn.disabled = true;
    try {
      await addDoc(collection(db, "blogComments"), {
        postId,
        text,
        authorEmail: normalizeEmail(s.email),
        authorRegId: s.regId,
        authorName: s.fullName || s.email,
        authorAvatar: s.avatarUrl || "assets/avatar-male.svg",
        createdAt: serverTimestamp()
      });
      await updateDoc(doc(db, "blogPosts", postId), { commentsCount: increment(1) });
      item.commentsCount = (item.commentsCount || 0) + 1;
      commentCountEl.textContent = `💬 ${item.commentsCount}`;
      input.value = "";
      await loadComments(postId, listEl);
    } catch (err) {
      console.error("[Blog] comment submit failed:", err);
      alert("Something went wrong posting your comment. Please try again.");
    } finally {
      sendBtn.disabled = false;
    }
  }

  sendBtn.addEventListener("click", submitComment);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submitComment(); });
}

// ============================================
// FEED — pagination
// ============================================
let lastDoc = null;
let feedDone = false;

function resetFeed() {
  feedEl.innerHTML = "";
  lastDoc = null;
  feedDone = false;
  feedEmpty.classList.add("hidden");
  loadMoreBtn.classList.remove("hidden");
}

async function loadMorePosts() {
  if (feedDone) return;
  loadMoreBtn.disabled = true;
  loadMoreBtn.textContent = "Loading…";
  try {
    let q = query(collection(db, "blogPosts"), orderBy("createdAt", "desc"), limit(PAGE_SIZE));
    if (lastDoc) q = query(collection(db, "blogPosts"), orderBy("createdAt", "desc"), startAfter(lastDoc), limit(PAGE_SIZE));

    const snap = await getDocs(q);
    if (snap.empty && !lastDoc) {
      feedEmpty.classList.remove("hidden");
      loadMoreBtn.classList.add("hidden");
      return;
    }
    if (snap.docs.length < PAGE_SIZE) {
      feedDone = true;
      loadMoreBtn.classList.add("hidden");
    }
    lastDoc = snap.docs[snap.docs.length - 1] || lastDoc;

    snap.docs.forEach(d => {
      const item = d.data();
      // Rejected posts stay out of the public timeline entirely — the
      // admin already told the author it wasn't approved elsewhere.
      if (item.status === "rejected") return;
      feedEl.appendChild(renderPostCard(d.id, item));
    });
  } catch (err) {
    console.error("[Blog] failed to load feed:", err);
    feedEl.insertAdjacentHTML("beforeend", `<p style="color:var(--terracotta-500);text-align:center;">Couldn't load the timeline. Please refresh.</p>`);
  } finally {
    loadMoreBtn.disabled = false;
    loadMoreBtn.textContent = "Load more";
  }
}

loadMoreBtn?.addEventListener("click", loadMorePosts);

// ============================================
// DEEP LINK — ?post=ID shows that single post pinned above the feed
// (used by the admin panel's "View" links and Share links).
// ============================================
async function loadDeepLinkedPost() {
  const params = new URLSearchParams(window.location.search);
  const postId = params.get("post");
  if (!postId) return;
  try {
    const snap = await getDoc(doc(db, "blogPosts", postId));
    if (!snap.exists()) return;
    const item = snap.data();
    const wrapper = document.createElement("div");
    wrapper.className = "blog-pinned-post";
    wrapper.innerHTML = `<div class="blog-pinned-label">📌 Shared post</div>`;
    wrapper.appendChild(renderPostCard(snap.id, item));
    feedEl.parentNode.insertBefore(wrapper, feedEl);
  } catch (err) {
    console.error("[Blog] failed to load shared post:", err);
  }
}

loadDeepLinkedPost();
loadMorePosts();
