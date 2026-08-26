// ============================================
// AGRISTUDENT BD — blog.js (ENHANCED)
// Facebook-style student timeline with gallery image support
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
const MAX_IMAGES_PER_POST = 10;

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
// Only ever trust image URLs we uploaded ourselves (Cloudinary) — never a user-supplied src.
const TRUSTED_IMAGE_SRC = /^https:\/\/res\.cloudinary\.com\//;

function sanitizeNode(node, out) {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push(esc(node.textContent));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const tag = node.tagName;
  if (!ALLOWED_TAGS.has(tag)) {
    node.childNodes.forEach(child => sanitizeNode(child, out));
    return;
  }

  if (tag === "BR") { out.push("<br>"); return; }

  if (tag === "IMG") {
    const src = node.getAttribute("src") || "";
    if (!TRUSTED_IMAGE_SRC.test(src)) return; // drop anything that isn't one of our uploads
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
  // Strip composer-only UI chrome (resize handle, delete/align buttons) before sanitizing content
  template.content.querySelectorAll(".inline-image-resize, .inline-image-delete, .inline-image-toolbar, button").forEach(el => el.remove());
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
// VIEW TRACKING (localStorage)
// ============================================
function getViewedSet() {
  const viewed = localStorage.getItem("agri_blog_viewed");
  return new Set(viewed ? viewed.split(",") : []);
}

function markViewed(id) {
  const viewed = getViewedSet();
  viewed.add(id);
  localStorage.setItem("agri_blog_viewed", Array.from(viewed).join(","));
}

// ============================================
// PENDING IMAGES ARRAY (for composer preview)
// ============================================
let pendingImages = []; // Array of { name, url (blob or cloudinary), file }

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
const postUploadStatus = document.getElementById("post-upload-status");
const postError = document.getElementById("post-error");
const postSubmitBtn = document.getElementById("post-submit-btn");

// Tracks in-flight inline uploads so submit can wait for them, and the wrapper
// currently being dragged so it can be dropped at a new spot in the text.
let inlineUploadsInFlight = 0;
let draggedInlineImage = null;

const composerImagePreview = document.getElementById("composer-image-preview");
const composerPreviewGrid = document.getElementById("composer-preview-grid");

const blogFeed = document.getElementById("blog-feed");
const blogFeedEmpty = document.getElementById("blog-feed-empty");
const loadMoreBtn = document.getElementById("blog-load-more");

// Lightbox elements
const imageLightbox = document.getElementById("image-lightbox");
const lightboxImage = document.getElementById("lightbox-image");
const lightboxClose = document.getElementById("lightbox-close");
const lightboxPrev = document.getElementById("lightbox-prev");
const lightboxNext = document.getElementById("lightbox-next");
const lightboxCounter = document.getElementById("lightbox-counter");
let lightboxGallery = [];
let lightboxIndex = 0;

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
  composerImagePreview.classList.add("hidden");
  composerPreviewGrid.innerHTML = "";
}

// ============================================
// IMAGE PREVIEW MANAGEMENT (in composer)
// ============================================
function updateImagePreview() {
  if (pendingImages.length === 0) {
    composerImagePreview.classList.add("hidden");
    return;
  }
  composerImagePreview.classList.remove("hidden");
  composerPreviewGrid.innerHTML = pendingImages.map((img, idx) => `
    <div class="composer-preview-item">
      <img src="${typeof img.url === "string" ? img.url : URL.createObjectURL(img.url)}" alt="">
      <button type="button" class="composer-preview-remove" data-idx="${idx}">✕</button>
    </div>
  `).join("");

  // Wire remove buttons
  composerPreviewGrid.querySelectorAll(".composer-preview-remove").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const idx = parseInt(btn.dataset.idx);
      pendingImages.splice(idx, 1);
      updateImagePreview();
    });
  });
}

function totalImageCount() {
  return pendingImages.length + postBodyInput.querySelectorAll(".inline-image").length;
}

postImageInput?.addEventListener("change", (e) => {
  const files = Array.from(e.target.files || []);

  // Validate total images (gallery + inline combined)
  if (totalImageCount() + files.length > MAX_IMAGES_PER_POST) {
    postError.classList.remove("hidden");
    postError.textContent = `Max ${MAX_IMAGES_PER_POST} images per post`;
    return;
  }

  // Validate each file
  for (const file of files) {
    if (!file.type.startsWith("image/")) {
      postError.classList.remove("hidden");
      postError.textContent = `Only image files allowed: ${file.name}`;
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      postError.classList.remove("hidden");
      postError.textContent = `Image too large (max 8MB): ${file.name}`;
      return;
    }
  }

  // Add to pending
  files.forEach(file => {
    pendingImages.push({ name: file.name, url: file, file });
  });
  postError.classList.add("hidden");
  updateImagePreview();
  postImageInput.value = "";
});

// ============================================
// INLINE IMAGES — insert directly into the post text,
// draggable to reposition and resizable via a corner handle
// ============================================
postInlineImageInput?.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  postInlineImageInput.value = "";

  if (totalImageCount() + files.length > MAX_IMAGES_PER_POST) {
    postError.classList.remove("hidden");
    postError.textContent = `Max ${MAX_IMAGES_PER_POST} images per post`;
    return;
  }

  for (const file of files) {
    if (!file.type.startsWith("image/")) {
      postError.classList.remove("hidden");
      postError.textContent = `Only image files allowed: ${file.name}`;
      continue;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      postError.classList.remove("hidden");
      postError.textContent = `Image too large (max 8MB): ${file.name}`;
      continue;
    }
    postError.classList.add("hidden");
    await insertInlineImage(file);
  }
});

function insertNodeAtCursor(node) {
  postBodyInput.focus();
  const sel = window.getSelection();
  let range;
  if (sel && sel.rangeCount > 0 && postBodyInput.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    range = sel.getRangeAt(0);
  } else {
    range = document.createRange();
    range.selectNodeContents(postBodyInput);
    range.collapse(false); // end of content
  }
  range.deleteContents();
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function wireInlineImageWrapper(wrapper) {
  wrapper.setAttribute("draggable", "true");

  wrapper.addEventListener("dragstart", (ev) => {
    draggedInlineImage = wrapper;
    ev.dataTransfer.effectAllowed = "move";
    try { ev.dataTransfer.setData("text/plain", ""); } catch (err) { /* Firefox needs this set, ignore elsewhere */ }
    setTimeout(() => wrapper.classList.add("dragging"), 0);
  });
  wrapper.addEventListener("dragend", () => {
    wrapper.classList.remove("dragging");
    draggedInlineImage = null;
  });

  // Resize via bottom-right handle (pointer events cover mouse + touch)
  const resizeHandle = wrapper.querySelector(".inline-image-resize");
  resizeHandle?.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const startX = ev.clientX;
    const startWidth = wrapper.getBoundingClientRect().width;
    resizeHandle.setPointerCapture(ev.pointerId);

    function onMove(e2) {
      const delta = e2.clientX - startX;
      const newWidth = Math.max(80, Math.min(560, Math.round(startWidth + delta)));
      wrapper.style.width = `${newWidth}px`;
    }
    function onUp(e3) {
      try { resizeHandle.releasePointerCapture(e3.pointerId); } catch (err) {}
      resizeHandle.removeEventListener("pointermove", onMove);
      resizeHandle.removeEventListener("pointerup", onUp);
    }
    resizeHandle.addEventListener("pointermove", onMove);
    resizeHandle.addEventListener("pointerup", onUp);
  });

  // Delete
  const deleteBtn = wrapper.querySelector(".inline-image-delete");
  deleteBtn?.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    wrapper.remove();
  });

  // Alignment — "none" sits inline in the paragraph; left/right float so text wraps beside it; center stands alone
  wrapper.querySelectorAll(".inline-align-btn").forEach(btn => {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      wrapper.classList.remove("align-left", "align-right", "align-center", "align-none");
      wrapper.classList.add(`align-${btn.dataset.align}`);
      wrapper.querySelectorAll(".inline-align-btn").forEach(b => b.classList.toggle("is-active", b === btn));
    });
  });
}

async function insertInlineImage(file) {
  const wrapper = document.createElement("div");
  wrapper.className = "inline-image align-none is-uploading";
  wrapper.style.width = "260px";
  wrapper.contentEditable = "false";

  const img = document.createElement("img");
  img.src = URL.createObjectURL(file);
  img.alt = "Post image";
  wrapper.appendChild(img);

  const spinner = document.createElement("div");
  spinner.className = "inline-image-spinner";
  spinner.textContent = "Uploading…";
  wrapper.appendChild(spinner);

  const toolbar = document.createElement("div");
  toolbar.className = "inline-image-toolbar";
  toolbar.innerHTML = `
    <button type="button" class="inline-align-btn is-active" data-align="none" title="In text">🔤</button>
    <button type="button" class="inline-align-btn" data-align="left" title="Wrap text right">⬅️</button>
    <button type="button" class="inline-align-btn" data-align="center" title="Center, own line">⏺️</button>
    <button type="button" class="inline-align-btn" data-align="right" title="Wrap text left">➡️</button>
  `;
  wrapper.appendChild(toolbar);

  const resizeHandle = document.createElement("div");
  resizeHandle.className = "inline-image-resize";
  wrapper.appendChild(resizeHandle);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "inline-image-delete";
  deleteBtn.textContent = "✕";
  wrapper.appendChild(deleteBtn);

  wireInlineImageWrapper(wrapper);
  insertNodeAtCursor(wrapper);

  inlineUploadsInFlight++;
  try {
    const url = await uploadOneImage(file);
    img.src = url;
    wrapper.classList.remove("is-uploading");
  } catch (err) {
    console.error("[Blog] inline image upload failed:", err);
    wrapper.remove();
    postError.classList.remove("hidden");
    postError.textContent = `Failed to upload image: ${file.name}`;
  } finally {
    inlineUploadsInFlight--;
  }
}

// Drop target: reposition a dragged inline image at the new cursor spot
function getRangeFromPoint(x, y) {
  if (document.caretRangeFromPoint) {
    return document.caretRangeFromPoint(x, y);
  }
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    if (!pos) return null;
    const range = document.createRange();
    range.setStart(pos.offsetNode, pos.offset);
    range.collapse(true);
    return range;
  }
  return null;
}

postBodyInput?.addEventListener("dragover", (ev) => {
  if (!draggedInlineImage) return;
  ev.preventDefault();
  ev.dataTransfer.dropEffect = "move";
});

postBodyInput?.addEventListener("drop", (ev) => {
  if (!draggedInlineImage) return;
  ev.preventDefault();
  const node = draggedInlineImage;
  draggedInlineImage = null;
  const range = getRangeFromPoint(ev.clientX, ev.clientY);
  if (range) {
    range.collapse(true);
    range.insertNode(node);
  } else {
    postBodyInput.appendChild(node);
  }
  node.classList.remove("dragging");
});

// Select/deselect (shows the align/resize/delete controls on the active image)
postBodyInput?.addEventListener("click", (ev) => {
  const wrapper = ev.target.closest(".inline-image");
  postBodyInput.querySelectorAll(".inline-image.selected").forEach(w => {
    if (w !== wrapper) w.classList.remove("selected");
  });
  if (wrapper) wrapper.classList.add("selected");
});

document.addEventListener("click", (ev) => {
  if (!postBodyInput || postBodyInput.contains(ev.target)) return;
  postBodyInput.querySelectorAll(".inline-image.selected").forEach(w => w.classList.remove("selected"));
});

// ============================================
// TEXT FORMATTING BUTTONS
// ============================================
document.querySelectorAll(".composer-format-btn").forEach(btn => {
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    const cmd = btn.dataset.cmd;
    document.execCommand(cmd, false, null);
    postBodyInput.focus();
  });
});

// ============================================
// UPLOAD IMAGES TO CLOUDINARY & GET URLS
// ============================================
async function uploadOneImage(file) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

  const response = await fetch(CLOUDINARY_UPLOAD_URL, {
    method: "POST",
    body: formData
  });
  const data = await response.json();
  if (!data.secure_url) throw new Error("Upload failed");
  return data.secure_url;
}

async function uploadPendingImages() {
  if (pendingImages.length === 0) return [];

  const urls = [];
  postUploadStatus.textContent = `Uploading ${pendingImages.length} image(s)...`;

  for (let i = 0; i < pendingImages.length; i++) {
    const img = pendingImages[i];
    try {
      const url = await uploadOneImage(img.file);
      urls.push(url);
      postUploadStatus.textContent = `Uploading image ${i + 1}/${pendingImages.length}...`;
    } catch (err) {
      console.error(`Failed to upload image ${i + 1}:`, err);
      throw new Error(`Failed to upload image: ${img.name}`);
    }
  }

  postUploadStatus.textContent = "";
  return urls;
}

// ============================================
// POST SUBMISSION
// ============================================
postSubmitBtn?.addEventListener("click", async () => {
  const s = requireSession();
  if (!s) return;

  const title = postTitleInput.value.trim();
  const body = postBodyInput.innerHTML;
  const bodyText = plainTextLength(body);
  const inlineImageCount = postBodyInput.querySelectorAll(".inline-image").length;

  // Validate
  if (!title) {
    postError.classList.remove("hidden");
    postError.textContent = "Please add a title";
    return;
  }
  if (title.length > 200) {
    postError.classList.remove("hidden");
    postError.textContent = "Title too long (max 200 chars)";
    return;
  }
  if (bodyText === 0 && pendingImages.length === 0 && inlineImageCount === 0) {
    postError.classList.remove("hidden");
    postError.textContent = "Add some text or images";
    return;
  }
  if (bodyText > 20000) {
    postError.classList.remove("hidden");
    postError.textContent = "Post too long (max 20k chars)";
    return;
  }
  if (inlineUploadsInFlight > 0) {
    postError.classList.remove("hidden");
    postError.textContent = "Please wait for images to finish uploading";
    return;
  }
  if (postBodyInput.querySelectorAll(".inline-image.is-uploading").length > 0) {
    postError.classList.remove("hidden");
    postError.textContent = "Please wait for images to finish uploading";
    return;
  }

  postSubmitBtn.disabled = true;
  postError.classList.add("hidden");

  try {
    // Upload images
    const imageUrls = await uploadPendingImages();

    // Sanitize text
    const sanitized = sanitizeHTML(body);

    // Create post
    const docRef = await addDoc(collection(db, "blogPosts"), {
      title,
      content: sanitized,
      imageUrls,
      authorEmail: normalizeEmail(s.email),
      authorRegId: s.regId,
      authorName: s.fullName || s.email,
      authorAvatar: s.avatarUrl || "assets/avatar-male.svg",
      status: "pending",
      likesCount: 0,
      commentsCount: 0,
      sharesCount: 0,
      views: 0,
      createdAt: serverTimestamp()
    });

    // Success — reset and close
    resetComposer();
    composerModal.classList.add("hidden");
    postUploadStatus.textContent = "";

    // Reload feed to show new post at top
    resetFeed();
    loadMorePosts();

  } catch (err) {
    console.error("[Blog] Post submit failed:", err);
    postError.classList.remove("hidden");
    postError.textContent = err.message || "Failed to create post. Please try again.";
  } finally {
    postSubmitBtn.disabled = false;
  }
});

// ============================================
// IMAGE GALLERY BUILDER (Facebook-style)
// ============================================
function buildGalleryHTML(imageUrls) {
  if (!imageUrls || imageUrls.length === 0) return "";

  const count = Math.min(imageUrls.length, 4); // Show max 4 inline
  const visibleUrls = imageUrls.slice(0, 4);
  const overflowCount = imageUrls.length - 4;

  let galleryClass = `gallery-${count}`;
  if (imageUrls.length > 4) galleryClass = "gallery-5plus";

  const tileHTML = visibleUrls.map((url, idx) => {
    const isOverflow = (idx === 3 && overflowCount > 0);
    return `
      <div class="blog-gallery-tile ${isOverflow ? "tile-overflow" : ""}" 
           data-overflow="+${overflowCount}" 
           data-index="${idx}"
           data-full-index="${idx}">
        <img src="${esc(url)}" alt="Post image" loading="lazy">
      </div>
    `;
  }).join("");

  return `
    <div class="blog-gallery ${galleryClass}">
      <div class="blog-gallery-grid">
        ${tileHTML}
      </div>
    </div>
  `;
}

// ============================================
// LIGHTBOX HANDLERS
// ============================================
function openLightbox(gallery, index) {
  lightboxGallery = gallery;
  lightboxIndex = Math.max(0, Math.min(index, gallery.length - 1));
  showLightboxImage();
  imageLightbox.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  imageLightbox.classList.add("hidden");
  document.body.style.overflow = "";
  lightboxGallery = [];
  lightboxIndex = 0;
}

function showLightboxImage() {
  if (lightboxGallery.length === 0) return;
  const url = lightboxGallery[lightboxIndex];
  lightboxImage.src = url;
  lightboxCounter.textContent = `${lightboxIndex + 1} / ${lightboxGallery.length}`;
  
  lightboxPrev.classList.toggle("disabled", lightboxIndex === 0);
  lightboxNext.classList.toggle("disabled", lightboxIndex === lightboxGallery.length - 1);
}

lightboxClose?.addEventListener("click", closeLightbox);
lightboxPrev?.addEventListener("click", () => {
  if (lightboxIndex > 0) {
    lightboxIndex--;
    showLightboxImage();
  }
});
lightboxNext?.addEventListener("click", () => {
  if (lightboxIndex < lightboxGallery.length - 1) {
    lightboxIndex++;
    showLightboxImage();
  }
});

// Keyboard navigation
document.addEventListener("keydown", (e) => {
  if (imageLightbox.classList.contains("hidden")) return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowLeft" && lightboxIndex > 0) {
    lightboxIndex--;
    showLightboxImage();
  }
  if (e.key === "ArrowRight" && lightboxIndex < lightboxGallery.length - 1) {
    lightboxIndex++;
    showLightboxImage();
  }
});

// ============================================
// FEED — RENDER POST CARD
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

  // Build gallery HTML
  const galleryHTML = buildGalleryHTML(item.imageUrls);

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
    ${galleryHTML}
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

  // View tracking
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
// FEED — WIRE UP POST INTERACTIONS
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

  // Gallery tile clicks
  const galleryTiles = article.querySelectorAll(".blog-gallery-tile");
  if (galleryTiles.length > 0) {
    galleryTiles.forEach((tile, idx) => {
      tile.addEventListener("click", () => {
        openLightbox(item.imageUrls || [], idx);
      });
    });
  }

  // Like button
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
      // User cancelled share — not an error
    }
  });
}

// ============================================
// COMMENTS — LOAD & RENDER
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
// FEED — PAGINATION
// ============================================
let lastDoc = null;
let feedDone = false;

function resetFeed() {
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

    snap.docs.forEach(d => {
      const item = d.data();
      if (item.status === "rejected") return;
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
// INIT
// ============================================
updateComposerUI();
loadDeepLinkedPost();
loadMorePosts();
