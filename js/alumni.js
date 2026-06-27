// ============================================
// AGRISTUDENT BD — alumni.js  (security-hardened)
// ============================================
import { db, CLOUDINARY_UPLOAD_URL, CLOUDINARY_UPLOAD_PRESET } from "./firebase-config.js";
import {
  collection, addDoc, serverTimestamp, query, where, getDocs,
  doc, updateDoc, arrayUnion, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const CIRCUMFERENCE = 226.19;
let allAlumni = [];

// ============================================
// XSS ESCAPE HELPER — used on ALL user data
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
// CLOUDINARY UPLOAD
// ============================================
function uploadPhoto(file, onProgress) {
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
        reject(new Error("Photo upload failed. Please try again."));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.ontimeout = () => reject(new Error("Upload timed out. Try again."));
    const data = new FormData();
    data.append("file", file);
    data.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    xhr.send(data);
  });
}

// ============================================
// LOAD & RENDER ALUMNI
// ============================================
async function loadAlumni() {
  const grid = document.getElementById("alumni-grid");
  const countLabel = document.getElementById("alumni-count");

  try {
    const q = query(collection(db, "alumni"), where("status", "==", "approved"));
    const snap = await getDocs(q);
    // Only keep fields needed for display — never expose studentId to JS memory
    allAlumni = snap.docs.map(d => {
      const { studentId, ...safeData } = d.data(); // strip studentId from client memory
      return { id: d.id, ...safeData };
    });
    countLabel.textContent = `🎓 ${allAlumni.length} Alumni Profile${allAlumni.length !== 1 ? "s" : ""}`;
    renderGrid(allAlumni);
  } catch (err) {
    console.error("[Alumni] load failed:", err);
    grid.innerHTML = `<p style="color:var(--terracotta-500);font-family:var(--font-mono);font-size:.85rem;grid-column:1/-1;">Could not load alumni. Please check your connection.</p>`;
  }
}

function renderGrid(list) {
  const grid = document.getElementById("alumni-grid");
  if (list.length === 0) {
    grid.innerHTML = `<p style="color:var(--moss-600);font-family:var(--font-mono);font-size:.85rem;grid-column:1/-1;">No alumni profiles yet — be the first to register!</p>`;
    return;
  }
  // All user data escaped with esc() before entering innerHTML
  grid.innerHTML = list.map(a => `
    <div class="alumni-card" data-id="${esc(a.id)}">
      ${a.photoUrl
        ? `<img class="alumni-avatar" src="${esc(a.photoUrl)}" alt="${esc(a.fullName)}" loading="lazy">`
        : `<div class="alumni-avatar-placeholder">🎓</div>`}
      <div class="alumni-name">${esc(a.fullName)}</div>
      <div class="alumni-batch">Batch ${esc(a.batch || "—")}</div>
      <div class="alumni-job">${esc(a.currentJob || "")}</div>
      ${a.phone ? `<div class="alumni-contact">📞 ${esc(a.phone)}</div>` : ""}
      <div class="alumni-contact" style="color:var(--moss-600);">✉️ ${esc(a.email)}</div>
    </div>
  `).join("");

  grid.querySelectorAll(".alumni-card").forEach(card => {
    card.addEventListener("click", () => {
      const alum = allAlumni.find(a => a.id === card.dataset.id);
      if (alum) openProfileModal(alum);
    });
  });
}

// ============================================
// PROFILE VIEW MODAL
// ============================================
function openProfileModal(alum) {
  const modal = document.getElementById("alumni-profile-modal");
  const body = document.getElementById("alumni-profile-body");

  const historyHtml = (alum.jobHistory || []).length > 0
    ? `<div class="job-history">
        <p style="font-weight:600;font-size:.85rem;margin-bottom:.5rem;color:var(--moss-700);">Previous Roles</p>
        ${alum.jobHistory.map(h => `
          <div class="job-history-item">
            ${esc(h.job)}${h.org ? ` — ${esc(h.org)}` : ""}
            <div class="job-date">${esc(h.date || "")}</div>
          </div>`).join("")}
      </div>`
    : "";

  // All fields escaped — alum object comes from Firestore user-submitted data
  body.innerHTML = `
    ${alum.photoUrl
      ? `<img class="alumni-modal-avatar" src="${esc(alum.photoUrl)}" alt="${esc(alum.fullName)}">`
      : `<div class="alumni-modal-avatar-placeholder">🎓</div>`}
    <h3 style="text-align:center;margin-bottom:.2rem;">${esc(alum.fullName)}</h3>
    <p style="text-align:center;font-family:var(--font-mono);font-size:.75rem;color:var(--terracotta-500);margin-bottom:.8rem;">Batch ${esc(alum.batch || "—")}</p>

    <div style="display:flex;flex-direction:column;gap:.4rem;margin-bottom:.8rem;">
      <div style="font-size:.88rem;"><strong>💼 Current Role:</strong> ${esc(alum.currentJob || "—")}${alum.organization ? ` at ${esc(alum.organization)}` : ""}</div>
      <div style="font-size:.88rem;">✉️ ${esc(alum.email)}</div>
      ${alum.phone ? `<div style="font-size:.88rem;">📞 ${esc(alum.phone)}</div>` : ""}
    </div>

    ${historyHtml}

    <div class="edit-section">
      <p style="font-weight:600;font-size:.88rem;margin-bottom:.7rem;color:var(--moss-700);">✏️ Update Your Job Details</p>
      <p style="font-size:.8rem;color:var(--moss-600);margin-bottom:.8rem;">Enter your Student ID and Email to verify identity.</p>
      <div class="edit-gate" id="edit-gate">
        <input type="text" id="edit-sid" placeholder="Your Student ID" autocomplete="off">
        <input type="email" id="edit-email" placeholder="Your Email" autocomplete="off">
        <button class="btn-primary" id="verify-edit-btn" style="padding:.6rem;">Verify & Edit</button>
        <p id="edit-gate-status" style="font-size:.8rem;display:none;"></p>
      </div>
      <div id="edit-form" style="display:none;">
        <div class="form-field" style="margin-bottom:.8rem;">
          <label style="font-size:.85rem;">New Job Title / Position *</label>
          <input type="text" id="edit-job" placeholder="e.g., Senior Agronomist" style="width:100%;padding:.6rem .8rem;border:1px solid var(--line);border-radius:8px;font-size:.9rem;">
        </div>
        <div class="form-field" style="margin-bottom:.8rem;">
          <label style="font-size:.85rem;">Organization</label>
          <input type="text" id="edit-org" placeholder="Company / Organization" style="width:100%;padding:.6rem .8rem;border:1px solid var(--line);border-radius:8px;font-size:.9rem;">
        </div>
        <button class="btn-primary" id="save-job-btn" style="width:100%;padding:.65rem;">Save Job Update</button>
        <p id="save-job-status" style="font-size:.8rem;text-align:center;margin-top:.5rem;display:none;"></p>
      </div>
    </div>`;

  modal.classList.remove("hidden");

  // ── VERIFY: re-fetch from Firestore server to check studentId + email ──
  // This means the clientside allAlumni object never needs to hold studentId,
  // and DevTools manipulation of allAlumni cannot bypass the gate.
  document.getElementById("verify-edit-btn").addEventListener("click", async () => {
    const sid = document.getElementById("edit-sid").value.trim();
    const email = document.getElementById("edit-email").value.trim().toLowerCase();
    const statusEl = document.getElementById("edit-gate-status");

    if (!sid || !email) {
      statusEl.textContent = "Please enter both fields.";
      statusEl.style.color = "var(--terracotta-500)";
      statusEl.style.display = "block";
      return;
    }

    const btn = document.getElementById("verify-edit-btn");
    btn.disabled = true;
    btn.textContent = "Verifying…";
    statusEl.style.display = "none";

    try {
      // Re-fetch the actual document from Firestore — never use client memory for auth
      const snap = await getDoc(doc(db, "alumni", alum.id));
      if (!snap.exists()) throw new Error("Profile not found.");

      const serverData = snap.data();
      const sidMatch = serverData.studentId === sid;
      const emailMatch = (serverData.email || "").toLowerCase() === email;

      if (sidMatch && emailMatch) {
        document.getElementById("edit-gate").style.display = "none";
        document.getElementById("edit-form").style.display = "block";
      } else {
        statusEl.textContent = "❌ Student ID or Email does not match.";
        statusEl.style.color = "var(--terracotta-500)";
        statusEl.style.display = "block";
      }
    } catch (err) {
      console.error("[Alumni] verify failed:", err);
      statusEl.textContent = "Verification failed. Please try again.";
      statusEl.style.color = "var(--terracotta-500)";
      statusEl.style.display = "block";
    } finally {
      btn.disabled = false;
      btn.textContent = "Verify & Edit";
    }
  });

  // ── SAVE: update job details ──
  document.getElementById("save-job-btn").addEventListener("click", async () => {
    const newJob = document.getElementById("edit-job").value.trim();
    const newOrg = document.getElementById("edit-org").value.trim();
    const statusEl = document.getElementById("save-job-status");

    if (!newJob) {
      statusEl.textContent = "Please enter a job title.";
      statusEl.style.color = "var(--terracotta-500)";
      statusEl.style.display = "block";
      return;
    }

    const btn = document.getElementById("save-job-btn");
    btn.disabled = true;
    btn.textContent = "Saving…";

    try {
      const historyEntry = {
        job: alum.currentJob || "",
        org: alum.organization || "",
        date: new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" })
      };

      await updateDoc(doc(db, "alumni", alum.id), {
        currentJob: newJob,
        organization: newOrg,
        jobHistory: arrayUnion(historyEntry),
        lastUpdated: serverTimestamp()
      });

      statusEl.textContent = "✅ Job details updated!";
      statusEl.style.color = "var(--leaf-500)";
      statusEl.style.display = "block";

      alum.jobHistory = [...(alum.jobHistory || []), historyEntry];
      alum.currentJob = newJob;
      alum.organization = newOrg;
      renderGrid(allAlumni);

      setTimeout(() => modal.classList.add("hidden"), 1200);
    } catch (err) {
      console.error("[Alumni] save failed:", err);
      statusEl.textContent = "Could not save. Please try again.";
      statusEl.style.color = "var(--terracotta-500)";
      statusEl.style.display = "block";
    } finally {
      btn.disabled = false;
      btn.textContent = "Save Job Update";
    }
  });
}

document.getElementById("alumni-profile-close").addEventListener("click", () => {
  document.getElementById("alumni-profile-modal").classList.add("hidden");
});
document.getElementById("alumni-profile-modal").addEventListener("click", (e) => {
  if (e.target === document.getElementById("alumni-profile-modal"))
    document.getElementById("alumni-profile-modal").classList.add("hidden");
});

// ============================================
// SEARCH
// ============================================
document.getElementById("alumni-search").addEventListener("input", () => {
  const term = document.getElementById("alumni-search").value.trim().toLowerCase();
  const filtered = term
    ? allAlumni.filter(a =>
        a.fullName.toLowerCase().includes(term) ||
        (a.batch || "").toLowerCase().includes(term))
    : allAlumni;
  renderGrid(filtered);
});

// ============================================
// REGISTRATION FORM
// ============================================
const formModal = document.getElementById("alumni-form-modal");
document.getElementById("open-alumni-form").addEventListener("click", () => formModal.classList.remove("hidden"));
document.getElementById("alumni-form-close").addEventListener("click", () => formModal.classList.add("hidden"));
formModal.addEventListener("click", (e) => { if (e.target === formModal) formModal.classList.add("hidden"); });

const form = document.getElementById("alumni-form");
const submitBtn = document.getElementById("alumni-submit");
const progressWrap = document.getElementById("alumni-progress-wrap");
const progressBar = document.getElementById("alumni-progress-bar");
const progressText = document.getElementById("alumni-progress-text");
const statusBox = document.getElementById("alumni-status");
const successBox = document.getElementById("alumni-success");

function setProgress(pct) {
  progressBar.style.strokeDashoffset = CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE;
  progressText.textContent = pct + "%";
}
function showStatus(msg, isError = false) {
  progressWrap.classList.remove("hidden");
  statusBox.textContent = msg;
  statusBox.style.color = isError ? "var(--terracotta-500)" : "var(--moss-600)";
  if (isError) progressBar.style.stroke = "var(--terracotta-500)";
}
function showError(msg) {
  progressWrap.classList.add("hidden");
  alert(msg);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const fullName = document.getElementById("alumni-fullname").value.trim();
  const studentId = document.getElementById("alumni-studentid").value.trim();
  const email = document.getElementById("alumni-email").value.trim();
  const batch = document.getElementById("alumni-batch").value.trim();
  const phone = document.getElementById("alumni-phone").value.trim();
  const currentJob = document.getElementById("alumni-job").value.trim();
  const organization = document.getElementById("alumni-org").value.trim();
  const photoFile = document.getElementById("alumni-photo").files[0];

  if (!photoFile) { showError("Please select a photo."); return; }
  if (photoFile.size > 10 * 1024 * 1024) { showError("Photo must be under 10MB."); return; }

  // Duplicate check
  try {
    const dupQ = query(collection(db, "alumni"), where("studentId", "==", studentId));
    const dupSnap = await getDocs(dupQ);
    if (!dupSnap.empty) {
      showError("An alumni profile with this Student ID already exists.");
      return;
    }
  } catch (err) { /* non-blocking — proceed */ }

  submitBtn.disabled = true;
  submitBtn.textContent = "Uploading…";
  setProgress(0);
  showStatus("Uploading photo…");

  try {
    const photoUrl = await uploadPhoto(photoFile, (pct) => {
      setProgress(pct);
      showStatus(pct >= 100 ? "Processing on server…" : "Uploading photo…");
    });

    showStatus("Saving profile…");
    setProgress(100);

    const docData = {
      fullName, studentId, email, batch, currentJob,
      photoUrl, status: "pending",
      jobHistory: [],
      submittedAt: serverTimestamp()
    };
    if (phone) docData.phone = phone;
    if (organization) docData.organization = organization;

    await addDoc(collection(db, "alumni"), docData);

    form.classList.add("hidden");
    statusBox.classList.add("hidden");
    successBox.classList.remove("hidden");
  } catch (err) {
    console.error("[Alumni] submit failed:", err);
    showStatus("Something went wrong. Please try again.", true);
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit for Review";
  }
});

loadAlumni();
