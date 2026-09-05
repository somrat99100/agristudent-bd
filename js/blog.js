// ============================================
// AGRI CORE — blog.js (ENHANCED v2)
// Facebook-style student timeline with multi-reaction support + proper view counting
// ============================================
import { db, CLOUDINARY_UPLOAD_URL, CLOUDINARY_UPLOAD_PRESET } from "./firebase-config.js";
import {
  collection, addDoc, updateDoc, deleteDoc, doc, getDoc, setDoc,
  query, orderBy, limit, startAfter, getDocs, where, serverTimestamp, increment, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { normalizeEmail } from "./identity.js";
import { getSession } from "./session.js";
import { initEmailNotifications } from "./email-config.js";

initEmailNotifications();

const PAGE_SIZE = 8;
const MAX_IMAGE_SIZE = 8 * 1024 * 1024; // 8MB per image
const MAX_IMAGES_PER_POST = 10;

// ============================================
// REACTION TYPES - Facebook style
// ============================================
const REACTION_TYPES = {
  LIKE: "like",
  LOVE: "love",
  HAHA: "haha",
  WOW: "wow",
  SAD: "sad",
  ANGRY: "angry"
};

const REACTION_EMOJIS = {
  like: "👍",
  love: "❤️",
  haha: "😂",
  wow: "😮",
  sad: "😢",
  angry: "😠"
};

const REACTION_LABELS = {
  like: "Like",
  love: "Love",
  haha: "Haha",
  wow: "Wow",
  sad: "Sad",
  angry: "Angry"
};

// ============================================
// ESCAPE HELPER
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
// ============================================
const ALLOWED_TAGS = new Set(["B", "STRONG", "I", "EM", "U", "BR", "P", "DIV", "UL", "OL", "LI", "SPAN", "IMG"]);
const ALLOWED_WRAPPER_CLASSES = ["inline-image", "align-left", "align-right", "align-center", "align-none"];
const TRUSTED_IMAGE_SRC = /^https:\/\/res\.cloudinary\.com\//;

function sanitizeNode(node, out) {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push(esc(node.textContent));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const tag = node.tagName;

  if (/^H[1-6]$/.test(tag)) {
    out.push("<p><strong>");
    node.childNodes.forEach(child => sanitizeNode(child, out));
    out.push("</strong></p>");
    return;
  }
  if (tag === "A") {
    const href = node.getAttribute("href") || "";
    if (/^https?:\/\//i.test(href)) {
      out.push(`<a href="${esc(href)}" target="_blank" rel="noopener noreferrer nofollow">`);
      node.childNodes.forEach(child => sanitizeNode(child, out));
      out.push("</a>");
    } else {
      node.childNodes.forEach(child => sanitizeNode(child, out));
    }
    return;
  }
  if (tag === "TABLE" || tag === "TBODY" || tag === "THEAD") {
    node.childNodes.forEach(child => sanitizeNode(child, out));
    return;
  }
  if (tag === "TR") {
    let cellIndex = 0;
    node.childNodes.forEach(child => {
      if (child.nodeType === Node.ELEMENT_NODE && (child.tagName === "TD" || child.tagName === "TH")) {
        if (cellIndex > 0) out.push(" &nbsp;|&nbsp; ");
        cellIndex++;
      }
      sanitizeNode(child, out);
    });
    out.push("<br>");
    return;
  }
  if (tag === "TD" || tag === "TH") {
    node.childNodes.forEach(child => sanitizeNode(child, out));
    return;
  }

  if (!ALLOWED_TAGS.has(tag)) {
    node.childNodes.forEach(child => sanitizeNode(child, out));
    return;
  }

  if (tag === "BR") { out.push("<br>"); return; }

  if (tag === "IMG") {
    const src = node.getAttribute("src") || "";
    if (!TRUSTED_IMAGE_SRC.test(src)) return;
    const alt = esc(node.getAttribute("alt") || "Post image");
    out.push(`<img src="${esc(src)}" alt="${alt}" loading="lazy">`);
    return;
  }

  if (tag === "DIV") {
    const classes = (node.getAttribute("class") || "")
      .split(/\s+/)
      .filter(c => ALLOWED_WRAPPER_CLASSES.includes(c));

    if (classes.includes("inline-image")) {
      let styleAttr = "";
      const width = node.style && node.style.width;
      if (width && /^\d{2,4}px$/.test(width)) styleAttr = ` style="width:${width}"`;
      out.push(`<div class="${classes.join(" ")}"${styleAttr}>`);
      node.childNodes.forEach(child => sanitizeNode(child, out));
      out.push("</div>");
      return;
    }

    out.push("<div>");
    node.childNodes.forEach(child => sanitizeNode(child, out));
    out.push("</div>");
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
  template.content.querySelectorAll(".inline-image-resize, .inline-image-delete, .inline-image-toolbar, .inline-image-spinner, button").forEach(el => el.remove());
  template.content.querySelectorAll(".inline-image").forEach(el => el.classList.remove("selected", "is-uploading", "dragging"));
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
  if (!date) return "Just now";
  const now = Date.now();
  const elapsed = now - date.getTime();
  const secs = Math.floor(elapsed / 1000);
  const mins = Math.floor(secs / 60);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (secs < 60) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

// ============================================
// SESSION & AUTH HELPERS
// ============================================
function requireSession() {
  const s = getSession();
  if (!s) {
    alert("You must be logged in to do that.");
    window.location.href = "login.html";
  }
  return s;
}

// ============================================
// VIEW TRACKING (FIXED)
// Now counts EVERY view without 24h limit
// Uses session-based tracking instead
// ============================================
const VIEW_SESSION_KEY = "agri_blog_session_id";

function getSessionId() {
  let sessionId = sessionStorage.getItem(VIEW_SESSION_KEY);
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    sessionStorage.setItem(VIEW_SESSION_KEY, sessionId);
  }
  return sessionId;
}

function getViewedThisSessionMap() {
  try {
    const raw = sessionStorage.getItem("agri_blog_viewed_session");
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === "object") ? parsed : {};
  } catch {
    return {};
  }
}

function hasViewedThisSession(id) {
  return !!getViewedThisSessionMap()[id];
}

function markViewedThisSession(id) {
  const map = getViewedThisSessionMap();
  map[id] = true;
  try {
    sessionStorage.setItem("agri_blog_viewed_session", JSON.stringify(map));
  } catch (err) {
    console.error("[Blog] Failed to persist session view:", err);
  }
}

// Page-wide registry for view tracking (prevents double counting)
const activeViewTrackers = new Map();

function stopViewTracking(id) {
  const tracker = activeViewTrackers.get(id);
  if (!tracker) return;
  if (tracker.timer) clearTimeout(tracker.timer);
  if (tracker.observer) tracker.observer.disconnect();
  activeViewTrackers.delete(id);
}

function stopAllViewTracking() {
  activeViewTrackers.forEach((tracker) => {
    if (tracker.timer) clearTimeout(tracker.timer);
    if (tracker.observer) tracker.observer.disconnect();
  });
  activeViewTrackers.clear();
}

// ============================================
// LIVE STATS SYNC (views / reactions / comments / shares)
// ============================================
const activeStatsListeners = new Map();

function stopStatsListening(id) {
  const unsub = activeStatsListeners.get(id);
  if (!unsub) return;
  unsub();
  activeStatsListeners.delete(id);
}

function stopAllStatsListening() {
  activeStatsListeners.forEach(unsub => unsub());
  activeStatsListeners.clear();
}

function applyLiveStats(id, data) {
  document.querySelectorAll(`.blog-post-card[data-id="${id}"]`).forEach(card => {
    const stats = card.querySelector(".blog-post-stats");
    if (stats && stats.children[0]) stats.children[0].textContent = `👁️ ${data.views || 0} views`;
    
    // Update all reaction counts
    const reactionCountEl = card.querySelector(".blog-reaction-count");
    if (reactionCountEl) {
      let totalReactions = 0;
      Object.keys(REACTION_TYPES).forEach(key => {
        const type = REACTION_TYPES[key];
        totalReactions += data[`${type}Count`] || 0;
      });
      reactionCountEl.textContent = totalReactions > 0 ? `${totalReactions}` : "";
    }

    const commentCountEl = card.querySelector(".blog-comment-count");
    if (commentCountEl) commentCountEl.textContent = `💬 ${data.commentsCount || 0}`;
    if (stats && stats.children[3]) stats.children[3].textContent = `↗️ ${data.sharesCount || 0}`;
  });
}

function subscribeToLiveStats(id) {
  if (activeStatsListeners.has(id)) return;
  const unsub = onSnapshot(doc(db, "blogPosts", id), (snap) => {
    if (!snap.exists()) return;
    applyLiveStats(id, snap.data());
  }, (err) => {
    console.error("[Blog] live stats listener failed:", err);
  });
  activeStatsListeners.set(id, unsub);
}

// ============================================
// REACTION STATE (multi-reaction support)
// ============================================
let myReactions = new Map(); // postId -> reactionType

async function loadMyReactions() {
  myReactions.clear();
  const s = getSession();
  if (!s || !s.email) return;
  try {
    const email = normalizeEmail(s.email);
    const snap = await getDocs(query(collection(db, "blogReactions"), where("email", "==", email)));
    snap.forEach(d => {
      const data = d.data();
      if (data.postId) {
        myReactions.set(data.postId, data.reactionType);
      }
    });
  } catch (err) {
    console.error("[Blog] failed to load your reactions:", err);
  }
}

// ============================================
// PENDING IMAGES ARRAY (for composer preview)
// ============================================
let pendingImages = [];

// ============================================
// DOM REFS
// ============================================
const composerLoggedIn = document.getElementById("composer-logged-in");
const composerLoggedOut = document.getElementById("composer-logged-out");
const composerOpenBtn = document.getElementById("composer-open-btn");
const composerCloseBtn = document.getElementById("composer-close");
const composerModal = document.getElementById("composer-modal");
const composerAvatarImg = document.getElementById("composer-avatar");

const postTitleInput = document.getElementById("post-title-input");
const postBodyInput = document.getElementById("post-body-input");
const postImageInput = document.getElementById("post-image-input");
const postInlineImageInput = document.getElementById("post-inline-image-input");
const postInlineImageLabel = document.getElementById("post-inline-image-label");
const postDocxInput = document.getElementById("post-docx-input");
const postUploadStatus = document.getElementById("post-upload-status");
const postError = document.getElementById("post-error");
const postSubmitBtn = document.getElementById("post-submit-btn");

let inlineUploadsInFlight = 0;
let draggedInlineImage = null;
let savedRange = null;

function captureBodySelection() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && postBodyInput.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    savedRange = sel.getRangeAt(0).cloneRange();
  }
}

const composerImagePreview = document.getElementById("composer-image-preview");
const composerPreviewGrid = document.getElementById("composer-preview-grid");
const postGalleryImageLabel = document.getElementById("post-gallery-image-label");
const composerImageHint = document.getElementById("composer-image-hint");

const blogFeed = document.getElementById("blog-feed");
const blogFeedEmpty = document.getElementById("blog-feed-empty");
const loadMoreBtn = document.getElementById("blog-load-more");

// Full post modal
const postModal = document.getElementById("post-modal");
const postModalContent = document.getElementById("post-modal-content");
const postModalClose = postModal?.querySelector(".post-modal-close");

// ============================================
// COMPOSER UI LOGIC
// ============================================
function updateComposerUI() {
  const s = getSession();
  if (s) {
    composerLoggedIn.classList.remove("hidden");
    composerLoggedOut.classList.add("hidden");
    composerAvatarImg.src = s.avatarUrl || "assets/avatar-male.svg";
  } else {
    composerLoggedIn.classList.add("hidden");
    composerLoggedOut.classList.remove("hidden");
  }
}

composerOpenBtn?.addEventListener("click", () => {
  composerModal.classList.remove("hidden");
  postTitleInput.focus();
  updateImageModeUI();
});

composerCloseBtn?.addEventListener("click", () => {
  composerModal.classList.add("hidden");
  resetComposer();
});

composerModal?.addEventListener("click", (e) => {
  if (e.target === composerModal) {
    composerModal.classList.add("hidden");
    resetComposer();
  }
});

function resetComposer() {
  postTitleInput.value = "";
  postBodyInput.innerHTML = "";
  postError.classList.add("hidden");
  postError.textContent = "";
  postUploadStatus.textContent = "";
  pendingImages = [];
  inlineUploadsInFlight = 0;
  draggedInlineImage = null;
  savedRange = null;
  composerImagePreview.classList.add("hidden");
  composerPreviewGrid.innerHTML = "";
  delete composerModal.dataset.editingPostId;
  postSubmitBtn.textContent = "📝 Post";
  updateImageModeUI();
}

function openPostEditor(id, item) {
  resetComposer();
  postTitleInput.value = item.title || "";
  postBodyInput.innerHTML = item.content || "";
  pendingImages = (item.imageUrls || []).map(entry => {
    if (typeof entry === "string") return { name: "existing-image", url: entry, title: "" };
    return { name: "existing-image", url: entry.url, title: entry.title || "" };
  });
  updateImagePreview();
  composerModal.dataset.editingPostId = id;
  composerModal.classList.remove("hidden");
  postSubmitBtn.textContent = "💾 Save Changes";
  postTitleInput.focus();
}

// ============================================
// IMAGE PREVIEW MANAGEMENT (in composer)
// ============================================
function updateImagePreview() {
  if (pendingImages.length === 0) {
    composerImagePreview.classList.add("hidden");
    updateImageModeUI();
    return;
  }
  composerImagePreview.classList.remove("hidden");
  composerPreviewGrid.innerHTML = pendingImages.map((img, idx) => `
    <div class="composer-preview-item">
      <div class="composer-preview-thumb">
        <img src="${typeof img.url === "string" ? img.url : URL.createObjectURL(img.url)}" alt="">
        <button type="button" class="composer-preview-remove" data-idx="${idx}">✕</button>
      </div>
      <input type="text" class="composer-preview-title-input" data-idx="${idx}"
        placeholder="Add a title (optional)" value="${esc(img.title || "")}" maxlength="120">
    </div>
  `).join("");

  composerPreviewGrid.querySelectorAll(".composer-preview-remove").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const idx = parseInt(btn.dataset.idx);
      pendingImages.splice(idx, 1);
      updateImagePreview();
      updateImageModeUI();
    });
  });

  composerPreviewGrid.querySelectorAll(".composer-preview-title-input").forEach(input => {
    input.addEventListener("input", () => {
      const idx = parseInt(input.dataset.idx);
      if (pendingImages[idx]) pendingImages[idx].title = input.value;
    });
  });

  updateImageModeUI();
}

function totalImageCount() {
  return pendingImages.length + postBodyInput.querySelectorAll(".inline-image").length;
}

// ============================================
// IMAGE MODE LOCK
// ============================================
function updateImageModeUI() {
  const inlineCount = postBodyInput.querySelectorAll(".inline-image").length;
  const galleryCount = pendingImages.length;

  const galleryLocked = inlineCount > 0 && galleryCount === 0;
  const inlineLocked = galleryCount > 0 && inlineCount === 0;

  postGalleryImageLabel?.classList.toggle("is-disabled", galleryLocked);
  if (postImageInput) postImageInput.disabled = galleryLocked;
  if (postGalleryImageLabel) {
    postGalleryImageLabel.title = galleryLocked
      ? "Remove your inline images first to switch to a photo grid"
      : "Add photos to a grid below the post";
  }

  postInlineImageLabel?.classList.toggle("is-disabled", inlineLocked);
  if (postInlineImageInput) postInlineImageInput.disabled = inlineLocked;
  if (postInlineImageLabel) {
    postInlineImageLabel.title = inlineLocked
      ? "Remove your photo grid first to switch to inline images"
      : "Insert an image inside the text — drag & resize it";
  }

  if (composerImageHint) {
    if (inlineCount > 0) {
      composerImageHint.textContent = "📄 Using inline images for this post — click one to resize, drag the corner, or drag it to move. Remove all inline images to switch to a photo grid instead.";
    } else if (galleryCount > 0) {
      composerImageHint.textContent = "🖼️ Using a photo grid for this post — remove all grid photos to switch to inline images instead.";
    } else {
      composerImageHint.textContent = "📄 Inline — drops an image right in your text; click it to resize, drag the corner, or drag the whole image to move it. 🖼️ Gallery — adds a premium photo grid under the post. A post can use one style at a time.";
    }
  }
}

postImageInput?.addEventListener("change", (e) => {
  const files = Array.from(e.target.files || []);

  if (postBodyInput.querySelectorAll(".inline-image").length > 0) {
    postError.classList.remove("hidden");
    postError.textContent = "This post already uses inline images — remove them first to use a photo grid instead.";
    postImageInput.value = "";
    return;
  }

  if (files.length + pendingImages.length > MAX_IMAGES_PER_POST) {
    postError.classList.remove("hidden");
    postError.textContent = `Too many images. Maximum ${MAX_IMAGES_PER_POST} per post.`;
    postImageInput.value = "";
    return;
  }

  for (const file of files) {
    if (file.size > MAX_IMAGE_SIZE) {
      postError.classList.remove("hidden");
      postError.textContent = `Image too large (max 8MB per image).`;
      postImageInput.value = "";
      return;
    }
  }

  postError.classList.add("hidden");
  files.forEach(file => {
    pendingImages.push({ name: file.name, url: file, file, title: "" });
  });
  updateImagePreview();
  postImageInput.value = "";
});

// ============================================
// GALLERY HTML BUILDER
// ============================================
function buildGalleryHTML(imageUrls) {
  if (!imageUrls || imageUrls.length === 0) return "";
  return `
    <div class="blog-gallery">
      <div class="blog-gallery-grid">
        ${imageUrls.map((img, idx) => {
          const imgUrl = typeof img === "string" ? img : (img?.url || "");
          const imgTitle = typeof img === "string" ? "" : (img?.title || "");
          return `
            <div class="blog-gallery-tile" data-idx="${idx}" role="button" tabindex="0">
              <img src="${esc(imgUrl)}" alt="${esc(imgTitle || `Gallery image ${idx + 1}`)}" loading="lazy">
              ${imgTitle ? `<div class="blog-gallery-title">${esc(imgTitle)}</div>` : ""}
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

// ============================================
// LIGHTBOX
// ============================================
function openLightbox(imageUrls, initialIdx) {
  if (!postModal) return;
  
  const imgs = imageUrls.map(img => typeof img === "string" ? img : (img?.url || ""));
  let currentIdx = initialIdx;

  postModalContent.innerHTML = `
    <div class="lightbox-container">
      <button class="lightbox-prev" aria-label="Previous image">‹</button>
      <img class="lightbox-image" src="${esc(imgs[currentIdx])}" alt="">
      <button class="lightbox-next" aria-label="Next image">›</button>
      <div class="lightbox-counter">${currentIdx + 1} / ${imgs.length}</div>
    </div>
  `;

  postModal.classList.remove("hidden");

  const updateImage = () => {
    const img = postModalContent.querySelector(".lightbox-image");
    if (img) img.src = esc(imgs[currentIdx]);
    const counter = postModalContent.querySelector(".lightbox-counter");
    if (counter) counter.textContent = `${currentIdx + 1} / ${imgs.length}`;
  };

  postModalContent.querySelector(".lightbox-prev")?.addEventListener("click", () => {
    currentIdx = (currentIdx - 1 + imgs.length) % imgs.length;
    updateImage();
  });

  postModalContent.querySelector(".lightbox-next")?.addEventListener("click", () => {
    currentIdx = (currentIdx + 1) % imgs.length;
    updateImage();
  });
}

// ============================================
// See-more handler
// ============================================
function wireSeeMore(bodyEl, item) {
  const evaluate = () => {
    if (bodyEl.dataset.seeMoreWired) return;
    
    const minHeight = 300;
    if (bodyEl.scrollHeight > minHeight) {
      bodyEl.classList.add("is-collapsed");
      if (!bodyEl.querySelector(".blog-post-see-more")) {
        const btn = document.createElement("button");
        btn.className = "blog-post-see-more";
        btn.textContent = "See more";
        btn.addEventListener("click", () => {
          bodyEl.classList.remove("is-collapsed");
          btn.remove();
        });
        bodyEl.parentNode.insertBefore(btn, bodyEl.nextSibling);
      }
    }
  };

  bodyEl.dataset.seeMoreWired = "1";
  requestAnimationFrame(evaluate);
  bodyEl.querySelectorAll("img").forEach(img => {
    if (!img.complete) img.addEventListener("load", evaluate, { once: true });
  });
}

// ============================================
// FEED — RENDER POST CARD
// ============================================
function statusBadgeHTML(status, isEdited) {
  if (isEdited || status === "pending_edit" || status === "pending") {
    return `<span class="blog-badge blog-badge--pending">🕓 Pending Admin Approval</span>`;
  }
  if (status === "approved") return `<span class="blog-badge blog-badge--approved">✅ Public</span>`;
  if (status === "rejected") return `<span class="blog-badge blog-badge--pending">❌ Rejected</span>`;
  return `<span class="blog-badge blog-badge--pending">🕓 Pending Admin Approval</span>`;
}

function calculateTotalReactions(item) {
  let total = 0;
  Object.keys(REACTION_TYPES).forEach(key => {
    const type = REACTION_TYPES[key];
    total += item[`${type}Count`] || 0;
  });
  return total;
}

function renderPostCard(id, item) {
  const created = item.createdAt?.toDate?.() || null;
  const article = document.createElement("article");
  article.className = "blog-post-card";
  article.dataset.id = id;
  article.dataset.searchTitle = (item.title || "").toLowerCase();
  article.dataset.searchAuthor = (item.authorName || "").toLowerCase();

  const userReaction = myReactions.get(id) || null;
  const galleryHTML = buildGalleryHTML(item.imageUrls);

  const s = getSession();
  const isAuthor = s && normalizeEmail(s.email) === item.authorEmail;
  const isEdited = item.status === "pending_edit";
  const totalReactions = calculateTotalReactions(item);

  article.innerHTML = `
    <header class="blog-post-header">
      <img class="blog-post-avatar" src="${esc(item.authorAvatar || "assets/avatar-male.svg")}" alt="">
      <div>
        <div class="blog-post-author">${esc(item.authorName || "Student")}${item.authorStudentId ? ` <span class="blog-post-studentid">· ${esc(item.authorStudentId)}</span>` : ""}</div>
        <div class="blog-post-time">${esc(timeAgo(created))}</div>
      </div>
      <div class="blog-post-menu" ${!isAuthor ? 'style="display:none;"' : ''}>
        <button type="button" class="blog-menu-btn blog-edit-btn" title="Edit this post">✏️ Edit</button>
        <button type="button" class="blog-menu-btn blog-delete-btn" title="Delete this post">🗑️ Delete</button>
      </div>
    </header>
    <h2 class="blog-post-title">${esc(item.title)}</h2>
    ${statusBadgeHTML(item.status, isEdited)}
    <div class="blog-post-body">${item.content}</div>
    ${galleryHTML}
    <div class="blog-post-stats">
      <span>👁️ ${item.views || 0} views</span>
      <span class="blog-reaction-count">${totalReactions > 0 ? totalReactions : ""}</span>
      <span class="blog-comment-count">💬 ${item.commentsCount || 0}</span>
      <span>↗️ ${item.sharesCount || 0}</span>
    </div>
    <div class="blog-post-actions">
      <div class="blog-reaction-menu-container">
        <button type="button" class="blog-action-btn blog-reaction-main-btn ${userReaction ? "is-active" : ""}">
          ${userReaction ? REACTION_EMOJIS[userReaction] : "🤍"} ${userReaction ? REACTION_LABELS[userReaction] : "React"}
        </button>
        <div class="blog-reaction-menu hidden">
          ${Object.keys(REACTION_TYPES).map(key => {
            const type = REACTION_TYPES[key];
            return `<button type="button" class="blog-reaction-option" data-reaction="${type}" title="${REACTION_LABELS[type]}">${REACTION_EMOJIS[type]}</button>`;
          }).join("")}
        </div>
      </div>
      <button type="button" class="blog-action-btn blog-comment-toggle">💬 Comment</button>
      <button type="button" class="blog-action-btn blog-share-btn">↗️ Share</button>
    </div>
    <div class="blog-comments-section hidden">
      <div class="blog-comments-list"></div>
      <div class="blog-comment-composer"></div>
    </div>
  `;

  wirePostCard(article, id, item);
  wireSeeMore(article.querySelector(".blog-post-body"), item);
  subscribeToLiveStats(id);

  // ============================================
  // VIEW TRACKING (FIXED - counts every view)
  // ============================================
  async function bumpView() {
    try {
      await updateDoc(doc(db, "blogPosts", id), { views: increment(1) });
      document.querySelectorAll(`.blog-post-card[data-id="${id}"] .blog-post-stats span:first-child`).forEach(el => {
        const currentViews = parseInt(el.textContent) || 0;
        el.textContent = `👁️ ${currentViews + 1} views`;
      });
    } catch (err) {
      console.error("[Blog] View update failed:", err);
    }
  }

  if (!hasViewedThisSession(id)) {
    stopViewTracking(id);

    const tracker = { timer: null, observer: null };
    activeViewTrackers.set(id, tracker);

    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (hasViewedThisSession(id)) {
          stopViewTracking(id);
          return;
        }
        if (entry.isIntersecting) {
          if (tracker.timer) return;
          tracker.timer = setTimeout(() => {
            markViewedThisSession(id);
            bumpView();
            stopViewTracking(id);
          }, 5000);
        } else if (tracker.timer) {
          clearTimeout(tracker.timer);
          tracker.timer = null;
        }
      });
    }, { threshold: 0.5 });

    tracker.observer = io;
    io.observe(article);
  }

  return article;
}

// ============================================
// FEED — WIRE UP POST INTERACTIONS
// ============================================
function wirePostCard(article, id, item) {
  const reactionMainBtn = article.querySelector(".blog-reaction-main-btn");
  const reactionMenu = article.querySelector(".blog-reaction-menu");
  const reactionOptions = article.querySelectorAll(".blog-reaction-option");
  const reactionCountEl = article.querySelector(".blog-reaction-count");
  const commentToggle = article.querySelector(".blog-comment-toggle");
  const commentsSection = article.querySelector(".blog-comments-section");
  const commentsList = article.querySelector(".blog-comments-list");
  const commentComposer = article.querySelector(".blog-comment-composer");
  const commentCountEl = article.querySelector(".blog-comment-count");
  const shareBtn = article.querySelector(".blog-share-btn");
  const editBtn = article.querySelector(".blog-edit-btn");
  const deleteBtn = article.querySelector(".blog-delete-btn");

  let commentsLoaded = false;

  // Edit button
  editBtn?.addEventListener("click", () => {
    const s = getSession();
    if (!s || normalizeEmail(s.email) !== item.authorEmail) {
      alert("You can only edit your own posts");
      return;
    }
    openPostEditor(id, item);
  });

  // Delete button
  deleteBtn?.addEventListener("click", () => {
    const s = getSession();
    if (!s || normalizeEmail(s.email) !== item.authorEmail) {
      alert("You can only delete your own posts");
      return;
    }
    if (!confirm("Are you sure you want to delete this post? This cannot be undone.")) {
      return;
    }
    deleteDoc(doc(db, "blogPosts", id)).then(() => {
      stopViewTracking(id);
      stopStatsListening(id);
      article.remove();
      alert("Post deleted successfully");
    }).catch(err => {
      console.error("Delete failed:", err);
      alert("Failed to delete post");
    });
  });

  // Gallery tile clicks
  const galleryTiles = article.querySelectorAll(".blog-gallery-tile");
  if (galleryTiles.length > 0) {
    galleryTiles.forEach((tile, idx) => {
      tile.addEventListener("click", () => {
        openLightbox(item.imageUrls || [], idx);
      });
    });
  }

  // Reaction menu toggle
  reactionMainBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    reactionMenu.classList.toggle("hidden");
  });

  // Reaction options
  reactionOptions.forEach(option => {
    option.addEventListener("click", async (e) => {
      e.stopPropagation();
      const s = requireSession();
      if (!s) return;

      const newReactionType = option.dataset.reaction;
      const currentReaction = myReactions.get(id) || null;
      
      reactionMainBtn.disabled = true;
      reactionMenu.classList.add("hidden");

      try {
        const email = normalizeEmail(s.email);
        const reactionDocId = `${id}_${email}`;

        // Remove old reaction if exists
        if (currentReaction) {
          const oldCountField = `${currentReaction}Count`;
          await deleteDoc(doc(db, "blogReactions", reactionDocId));
          await updateDoc(doc(db, "blogPosts", id), { 
            [oldCountField]: increment(-1)
          });
        }

        // Add new reaction
        const newCountField = `${newReactionType}Count`;
        await setDoc(doc(db, "blogReactions", reactionDocId), {
          postId: id,
          email: email,
          reactionType: newReactionType,
          createdAt: serverTimestamp()
        });
        await updateDoc(doc(db, "blogPosts", id), { 
          [newCountField]: increment(1)
        });

        // Update UI
        myReactions.set(id, newReactionType);
        reactionMainBtn.classList.add("is-active");
        reactionMainBtn.innerHTML = `${REACTION_EMOJIS[newReactionType]} ${REACTION_LABELS[newReactionType]}`;

        // Update count
        let totalReactions = 0;
        Object.keys(REACTION_TYPES).forEach(key => {
          const type = REACTION_TYPES[key];
          totalReactions += item[`${type}Count`] || 0;
        });
        if (reactionCountEl) reactionCountEl.textContent = totalReactions > 0 ? `${totalReactions}` : "";

      } catch (err) {
        console.error("[Blog] reaction toggle failed:", err);
        alert("Something went wrong. Please try again.");
      } finally {
        reactionMainBtn.disabled = false;
      }
    });
  });

  // Close menu when clicking elsewhere
  document.addEventListener("click", (e) => {
    if (!article.contains(e.target)) {
      reactionMenu.classList.add("hidden");
    }
  });

  // Comment toggle
  commentToggle.addEventListener("click", async () => {
    commentsSection.classList.toggle("hidden");
    if (!commentsSection.classList.contains("hidden") && !commentsLoaded) {
      commentsLoaded = true;
      await loadComments(id, commentsList);
      renderCommentComposer(commentComposer, id, commentsList, commentCountEl, item);
    }
  });

  // Share button
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
      // User cancelled share
    }
  });
}

// ============================================
// COMMENTS — LOAD & RENDER
// ============================================
async function loadComments(postId, listEl) {
  listEl.innerHTML = `<p class="blog-comments-loading">Loading comments…</p>`;
  try {
    const q = query(collection(db, "blogComments"), where("postId", "==", postId), orderBy("createdAt", "asc"));
    const snap = await getDocs(q);
    if (snap.empty) {
      listEl.innerHTML = `<p class="blog-comments-empty">No comments yet. Be the first!</p>`;
      return;
    }
    listEl.innerHTML = snap.docs.map(d => {
      const c = d.data();
      const created = c.createdAt?.toDate?.() || null;
      return `
        <div class="blog-comment" data-id="${d.id}">
          <img class="blog-comment-avatar" src="${esc(c.authorAvatar || "assets/avatar-male.svg")}" alt="">
          <div class="blog-comment-content">
            <div class="blog-comment-header">
              <strong>${esc(c.authorName || "Student")}</strong>
              <span class="blog-comment-time">${timeAgo(created)}</span>
            </div>
            <div class="blog-comment-text">${c.content}</div>
          </div>
        </div>
      `;
    }).join("");
  } catch (err) {
    console.error("[Blog] failed to load comments:", err);
    listEl.innerHTML = `<p style="color:var(--terracotta-500);">Failed to load comments.</p>`;
  }
}

function renderCommentComposer(composerEl, postId, listEl, countEl, item) {
  const s = getSession();
  if (!s) {
    composerEl.innerHTML = `<p class="blog-comment-login-prompt">Please log in to comment</p>`;
    return;
  }

  composerEl.innerHTML = `
    <div class="blog-comment-form">
      <img class="blog-comment-avatar-sm" src="${esc(s.avatarUrl || "assets/avatar-male.svg")}" alt="">
      <input type="text" class="blog-comment-input" placeholder="Write a comment...">
      <button type="button" class="blog-comment-submit">Post</button>
    </div>
  `;

  const input = composerEl.querySelector(".blog-comment-input");
  const sendBtn = composerEl.querySelector(".blog-comment-submit");

  const submitComment = async () => {
    const text = input.value.trim();
    if (!text) return;

    sendBtn.disabled = true;
    try {
      await addDoc(collection(db, "blogComments"), {
        postId,
        content: text,
        authorEmail: normalizeEmail(s.email),
        authorName: s.name || "Student",
        authorAvatar: s.avatarUrl || "assets/avatar-male.svg",
        createdAt: serverTimestamp()
      });
      await updateDoc(doc(db, "blogPosts", postId), { commentsCount: increment(1) });
      input.value = "";
      item.commentsCount = (item.commentsCount || 0) + 1;
      if (countEl) countEl.textContent = `💬 ${item.commentsCount}`;
      await loadComments(postId, listEl);
    } catch (err) {
      console.error("[Blog] comment submit failed:", err);
      alert("Failed to post comment");
    } finally {
      sendBtn.disabled = false;
    }
  };

  sendBtn.addEventListener("click", submitComment);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submitComment(); });
}

// ============================================
// FEED — PAGINATION
// ============================================
let lastDoc = null;
let feedDone = false;

function resetFeed() {
  stopAllViewTracking();
  stopAllStatsListening();
  blogFeed.innerHTML = "";
  lastDoc = null;
  feedDone = false;
  blogFeedEmpty.classList.add("hidden");
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
      blogFeedEmpty.classList.remove("hidden");
      loadMoreBtn.classList.add("hidden");
      return;
    }
    if (snap.docs.length < PAGE_SIZE) {
      feedDone = true;
      loadMoreBtn.classList.add("hidden");
    }
    lastDoc = snap.docs[snap.docs.length - 1] || lastDoc;

    const session = getSession();
    const viewerEmail = session ? normalizeEmail(session.email) : "";
    snap.docs.forEach(d => {
      const item = d.data();
      const isAuthor = viewerEmail && normalizeEmail(item.authorEmail) === viewerEmail;
      if (item.status !== "approved" && !isAuthor) return;
      blogFeed.appendChild(renderPostCard(d.id, item));
    });
  } catch (err) {
    console.error("[Blog] failed to load feed:", err);
    blogFeed.insertAdjacentHTML("beforeend", `<p style="color:var(--terracotta-500);text-align:center;">Couldn't load the timeline. Please refresh.</p>`);
  } finally {
    loadMoreBtn.disabled = false;
    loadMoreBtn.textContent = "Load more";
  }
}

loadMoreBtn?.addEventListener("click", loadMorePosts);

// ============================================
// FEED — SEARCH (by title or author)
// ============================================
const searchInput = document.getElementById("blog-search-input");
const searchClearBtn = document.getElementById("blog-search-clear");
const searchEmptyEl = document.getElementById("blog-search-empty");
const searchEmptyTermEl = document.getElementById("blog-search-empty-term");

let searchDebounceTimer = null;
let isLoadingFullFeedForSearch = false;

async function ensureFullFeedLoaded() {
  if (isLoadingFullFeedForSearch) return;
  isLoadingFullFeedForSearch = true;
  loadMoreBtn.classList.add("hidden");
  try {
    while (!feedDone) {
      await loadMorePosts();
    }
  } finally {
    isLoadingFullFeedForSearch = false;
  }
}

function applyBlogSearch(rawQuery) {
  const q = rawQuery.trim().toLowerCase();
  searchClearBtn.classList.toggle("hidden", q.length === 0);

  if (q.length === 0) {
    blogFeed.querySelectorAll(".blog-post-card").forEach(card => card.classList.remove("search-hidden"));
    searchEmptyEl.classList.add("hidden");
    blogFeedEmpty.classList.toggle("hidden", blogFeed.querySelector(".blog-post-card") != null);
    loadMoreBtn.classList.toggle("hidden", feedDone);
    return;
  }

  let anyVisible = false;
  blogFeed.querySelectorAll(".blog-post-card").forEach(card => {
    const matches = card.dataset.searchTitle.includes(q) || card.dataset.searchAuthor.includes(q);
    card.classList.toggle("search-hidden", !matches);
    if (matches) anyVisible = true;
  });

  blogFeedEmpty.classList.add("hidden");
  loadMoreBtn.classList.add("hidden");
  searchEmptyTermEl.textContent = rawQuery.trim();
  searchEmptyEl.classList.toggle("hidden", anyVisible);
}

searchInput?.addEventListener("input", () => {
  clearTimeout(searchDebounceTimer);
  const value = searchInput.value;
  searchDebounceTimer = setTimeout(async () => {
    if (value.trim().length > 0) {
      await ensureFullFeedLoaded();
    }
    applyBlogSearch(searchInput.value);
  }, 250);
});

searchClearBtn?.addEventListener("click", () => {
  searchInput.value = "";
  applyBlogSearch("");
  searchInput.focus();
});

// ============================================
// DEEP LINK — ?post=ID
// ============================================
async function loadDeepLinkedPost() {
  const params = new URLSearchParams(window.location.search);
  const postId = params.get("post");
  if (!postId) return;
  try {
    const snap = await getDoc(doc(db, "blogPosts", postId));
    if (!snap.exists()) return;
    const item = snap.data();
    const s = getSession();
    const isAuthor = s && normalizeEmail(s.email) === normalizeEmail(item.authorEmail);
    if (item.status !== "approved" && !isAuthor) return;
    const wrapper = document.createElement("div");
    wrapper.className = "blog-pinned-post";
    wrapper.innerHTML = `<div class="blog-pinned-label">📌 Shared post</div>`;
    wrapper.appendChild(renderPostCard(snap.id, item));
    blogFeed.parentNode.insertBefore(wrapper, blogFeed);
  } catch (err) {
    console.error("[Blog] failed to load shared post:", err);
  }
}

// ============================================
// DEEP LINK — ?editPost=ID
// ============================================
async function loadDeepLinkedEdit() {
  const params = new URLSearchParams(window.location.search);
  const postId = params.get("editPost");
  if (!postId) return;
  const s = getSession();
  if (!s) return;
  try {
    const snap = await getDoc(doc(db, "blogPosts", postId));
    if (!snap.exists()) return;
    const item = snap.data();
    if (normalizeEmail(s.email) !== item.authorEmail) {
      alert("You can only edit your own posts");
      return;
    }
    openPostEditor(postId, item);
  } catch (err) {
    console.error("[Blog] failed to load post for editing:", err);
  }
}

// ============================================
// HERO STATS
// ============================================
async function loadHeroStats() {
  const postsEl = document.getElementById("blog-hero-stat-posts");
  const authorsEl = document.getElementById("blog-hero-stat-authors");
  if (!postsEl && !authorsEl) return;
  try {
    const snap = await getDocs(query(collection(db, "blogPosts"), where("status", "==", "approved")));
    const authors = new Set(snap.docs.map(d => normalizeEmail(d.data().authorEmail || "")).filter(Boolean));
    if (postsEl) postsEl.textContent = snap.size;
    if (authorsEl) authorsEl.textContent = authors.size;
  } catch (err) {
    console.error("[Blog] failed to load hero stats:", err);
  }
}

// ============================================
// INIT
// ============================================
async function initBlogFeed() {
  updateComposerUI();
  await loadMyReactions();
  loadDeepLinkedPost();
  loadDeepLinkedEdit();
  loadMorePosts();
  loadHeroStats();
}
initBlogFeed();
