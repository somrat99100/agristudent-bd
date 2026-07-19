import { db, CLOUDINARY_UPLOAD_URL, CLOUDINARY_UPLOAD_PRESET } from "./firebase-config.js";
import {
  collection, addDoc, serverTimestamp, query, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const CIRCUMFERENCE = 226.19;

let allTerms = [];

// ============================================
// BROWSE + SEARCH + MODAL (with Zoom & Pan)
// ============================================
const grid = document.getElementById("term-grid");
const searchInput = document.getElementById("term-search");
const countLabel = document.getElementById("term-count");
const modal = document.getElementById("term-modal");
const modalImg = document.getElementById("modal-img");
const modalName = document.getElementById("modal-name");
const modalDesc = document.getElementById("modal-desc");
const modalClose = document.getElementById("modal-close");

// Zoom & Pan state variables
let imgScale = 1;
let isDragging = false;
let isMoved = false; 
let startX, startY;
let translateX = 0, translateY = 0;

function updateImageTransform() {
  modalImg.style.transform = `translate(${translateX}px, ${translateY}px) scale(${imgScale})`;
}

// --- Unified Drag Handlers for Mouse & Touch ---
function handleDragStart(clientX, clientY) {
  if (imgScale > 1) {
    isDragging = true;
    isMoved = false;
    startX = clientX - translateX;
    startY = clientY - translateY;
    modalImg.classList.add("panning");
  }
}

function handleDragMove(clientX, clientY) {
  if (!isDragging) return;
  isMoved = true; 
  translateX = clientX - startX;
  translateY = clientY - startY;
  updateImageTransform();
}

function handleDragEnd() {
  if (isDragging) {
    isDragging = false;
    modalImg.classList.remove("panning");
  }
}

// Mouse Events (Laptop/Desktop)
modalImg.addEventListener("mousedown", (e) => {
  e.preventDefault(); 
  handleDragStart(e.clientX, e.clientY);
});
window.addEventListener("mousemove", (e) => {
  handleDragMove(e.clientX, e.clientY);
});
window.addEventListener("mouseup", handleDragEnd);

// Touch Events (Mobile/Tablet)
modalImg.addEventListener("touchstart", (e) => {
  if (imgScale > 1) {
    handleDragStart(e.touches[0].clientX, e.touches[0].clientY);
  }
}, { passive: true });

window.addEventListener("touchmove", (e) => {
  if (isDragging) {
    e.preventDefault(); // Stop the whole page from scrolling while panning
    handleDragMove(e.touches[0].clientX, e.touches[0].clientY);
  }
}, { passive: false });

window.addEventListener("touchend", handleDragEnd);

// Click to Zoom In/Out
modalImg.addEventListener("click", () => {
  if (isMoved && imgScale > 1) {
    isMoved = false;
    return; 
  }
  
  if (imgScale === 1) {
    imgScale = 1.8; 
    modalImg.style.cursor = "grab";
    modalImg.classList.add("zoomed"); // Adds touch-action: none for mobile
  } else {
    imgScale = 1; 
    translateX = 0;
    translateY = 0;
    modalImg.style.cursor = "zoom-in";
    modalImg.classList.remove("zoomed");
  }
  updateImageTransform();
});

function closeTermModal() {
  modal.classList.add("hidden");
  imgScale = 1;
  translateX = 0;
  translateY = 0;
  updateImageTransform();
  modalImg.style.cursor = "zoom-in";
  modalImg.classList.remove("zoomed");
}

modalClose.addEventListener("click", closeTermModal);
modal.addEventListener("click", (e) => { 
  if (e.target === modal) closeTermModal(); 
});

async function loadTerms() {
  try {
    const q = query(collection(db, "terms"), where("status", "==", "approved"));
    const snap = await getDocs(q);
    allTerms = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    countLabel.textContent = `📖 Total Terms Uploaded: ${allTerms.length}`;
    renderGrid(allTerms);
    openTermFromHash();
  } catch (err) {
    console.error("Failed to load terms:", err);
    grid.innerHTML = `<p style="color:var(--terracotta-500);font-family:var(--font-mono);font-size:.85rem;grid-column:1/-1;">Could not load terms. Please check your connection.</p>`;
  }
}

// Renders **bold** markdown syntax in description text safely
function renderDescription(text) {
  if (!text) return "";
  // Escape HTML first, then convert **text** to <strong>
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

function renderGrid(terms) {
  if (terms.length === 0) {
    grid.innerHTML = `<p style="color:var(--moss-600);font-family:var(--font-mono);font-size:.85rem;grid-column:1/-1;">No terms yet — be the first to add one below.</p>`;
    return;
  }
  grid.innerHTML = terms.map(t => `
    <div class="term-card" data-id="${t.id}">
      <img class="term-img" src="${t.imageUrl}" alt="${t.name}" loading="lazy">
      <div class="term-name">${t.name}</div>
    </div>
  `).join("");

  grid.querySelectorAll(".term-card").forEach(card => {
    card.addEventListener("click", () => {
      const term = allTerms.find(t => t.id === card.dataset.id);
      openModal(term);
    });
  });
}

function openModal(term) {
  modalImg.src = term.imageUrl;
  modalImg.alt = term.name;
  
  // Reset zoom properties when a new modal opens
  imgScale = 1;
  translateX = 0;
  translateY = 0;
  updateImageTransform();
  modalImg.style.cursor = "zoom-in";
  modalImg.classList.remove("zoomed");
  
  modalName.textContent = term.name;
  modalDesc.innerHTML = renderDescription(term.description);
  modal.classList.remove("hidden");
}

// Deep link support: arriving as knowledge-hub.html#term=<id> (from the
// homepage search) auto-opens that term's modal.
function openTermFromHash() {
  const match = location.hash.match(/^#term=(.+)$/);
  if (!match) return;
  const term = allTerms.find(t => t.id === decodeURIComponent(match[1]));
  if (term) openModal(term);
}
window.addEventListener("hashchange", openTermFromHash);

searchInput.addEventListener("input", () => {
  const term = searchInput.value.trim().toLowerCase();
  const filtered = term ? allTerms.filter(t => t.name.toLowerCase().includes(term)) : allTerms;
  renderGrid(filtered);
});

// ============================================
// UPLOAD TERM FORM (modal)
// ============================================
const formModal = document.getElementById("term-form-modal");
const openFormBtn = document.getElementById("open-term-form");
const closeFormBtn = document.getElementById("term-form-close");

openFormBtn.addEventListener("click", () => formModal.classList.remove("hidden"));
closeFormBtn.addEventListener("click", () => formModal.classList.add("hidden"));
formModal.addEventListener("click", (e) => { if (e.target === formModal) formModal.classList.add("hidden"); });

const form = document.getElementById("term-form");
const submitBtn = document.getElementById("term-submit");
const successBox = document.getElementById("term-success");
const dupWarning = document.getElementById("duplicate-warning");
const progressWrap = document.getElementById("term-progress-wrap");
const progressBar = document.getElementById("term-progress-bar");
const progressText = document.getElementById("term-progress-text");
const statusBox = document.getElementById("term-status");

function setProgress(pct) {
  const offset = CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE;
  progressBar.style.strokeDashoffset = offset;
  progressText.textContent = pct + "%";
}

function showError(msg) {
  progressWrap.classList.add("hidden");
  alert(msg);
}

function showStatus(msg, isError = false) {
  progressWrap.classList.remove("hidden");
  statusBox.textContent = msg;
  statusBox.style.color = isError ? "var(--terracotta-500)" : "var(--moss-600)";
  if (isError) progressBar.style.stroke = "var(--terracotta-500)";
}

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
        reject(new Error(`Image upload failed (server said: ${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.ontimeout = () => reject(new Error("Upload took too long. Try again."));
    const data = new FormData();
    data.append("file", file);
    data.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    xhr.send(data);
  });
}

// Live duplicate check
const termNameInput = document.getElementById("termName");
termNameInput.addEventListener("input", () => {
  const typed = termNameInput.value.trim().toLowerCase();
  if (!typed) { dupWarning.classList.add("hidden"); return; }
  const match = allTerms.find(t => t.name.toLowerCase() === typed);
  if (match) {
    dupWarning.textContent = `⚠️ "${match.name}" already exists in the Knowledge Hub. Your submission will be reviewed alongside the existing entry — admin may merge them instead of publishing a duplicate.`;
    dupWarning.classList.remove("hidden");
  } else {
    dupWarning.classList.add("hidden");
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const name = termNameInput.value.trim();
  const description = document.getElementById("termDescription").value.trim();
  const uploaderEmail = document.getElementById("termUploaderEmail").value.trim();
  const imageFile = document.getElementById("termImage").files[0];

  if (!imageFile) { showError("Please choose an image."); return; }
  if (imageFile.size > MAX_IMAGE_SIZE) { showError("Image must be under 5MB."); return; }

  submitBtn.disabled = true;
  submitBtn.textContent = "Uploading…";
  setProgress(0);
  showStatus("Uploading image…");

  try {
    const imageUrl = await uploadImageToCloudinary(imageFile, (pct) => {
      setProgress(pct);
      showStatus(pct >= 100 ? "Upload sent — processing on server, please wait…" : "Uploading image…");
    });

    showStatus("Saving details…");

    const dupQuery = query(collection(db, "terms"), where("status", "==", "approved"));
    const dupSnap = await getDocs(dupQuery);
    const isDuplicate = dupSnap.docs.some(d => (d.data().name || "").toLowerCase() === name.toLowerCase());

    await addDoc(collection(db, "terms"), {
      name,
      imageUrl,
      description,
      uploaderEmail,
      status: "pending",
      possibleDuplicate: isDuplicate,
      submittedAt: serverTimestamp()
    });

    form.classList.add("hidden");
    progressWrap.classList.add("hidden");
    dupWarning.classList.add("hidden");
    successBox.classList.remove("hidden");
  } catch (err) {
    console.error(err);
    showStatus("Something went wrong: " + err.message, true);
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit for Review";
  }
});

// Load terms at the very end to ensure all UI binds first
loadTerms();
