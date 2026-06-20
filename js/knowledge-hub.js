import { db, CLOUDINARY_UPLOAD_URL, CLOUDINARY_UPLOAD_PRESET } from "./firebase-config.js";
import {
  collection, addDoc, serverTimestamp, query, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const CIRCUMFERENCE = 226.19;

let allTerms = [];

// ============================================
// BROWSE + SEARCH + MODAL
// ============================================
const grid = document.getElementById("term-grid");
const searchInput = document.getElementById("term-search");
const countLabel = document.getElementById("term-count");
const modal = document.getElementById("term-modal");
const modalImg = document.getElementById("modal-img");
const modalName = document.getElementById("modal-name");
const modalDesc = document.getElementById("modal-desc");
const modalClose = document.getElementById("modal-close");

async function loadTerms() {
  const q = query(collection(db, "terms"), where("status", "==", "approved"));
  const snap = await getDocs(q);
  allTerms = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  countLabel.textContent = `📖 Total Terms Uploaded: ${allTerms.length}`;
  renderGrid(allTerms);
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
  modalName.textContent = term.name;
  modalDesc.textContent = term.description;
  modal.classList.remove("hidden");
}
modalClose.addEventListener("click", () => modal.classList.add("hidden"));
modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });

searchInput.addEventListener("input", () => {
  const term = searchInput.value.trim().toLowerCase();
  const filtered = term ? allTerms.filter(t => t.name.toLowerCase().includes(term)) : allTerms;
  renderGrid(filtered);
});

loadTerms();

// ============================================
// UPLOAD TERM FORM
// ============================================
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
  alert(msg); // simple, since this form has no separate error slot
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

// Live duplicate check as the person types a term name
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

    // Re-check for duplicates right before saving (data may have changed since page load)
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
