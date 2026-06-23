// ============================================
// AGRISTUDENT BD — alumni.js
// ============================================
import { db, CLOUDINARY_UPLOAD_URL, CLOUDINARY_UPLOAD_PRESET } from "./firebase-config.js";
import {
  collection, addDoc, serverTimestamp, query, where, getDocs,
  doc, updateDoc, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const CIRCUMFERENCE = 226.19;
let allAlumni = [];

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
        reject(new Error(`Photo upload failed (${xhr.status})`));
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
    allAlumni = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    countLabel.textContent = `🎓 ${allAlumni.length} Alumni Profile${allAlumni.length !== 1 ? "s" : ""}`;
    renderGrid(allAlumni);
  } catch (err) {
    console.error("Failed to load alumni:", err);
    grid.innerHTML = `<p style="color:var(--terracotta-500);font-family:var(--font-mono);font-size:.85rem;grid-column:1/-1;">Could not load alumni. Please check your connection.</p>`;
  }
}

function renderGrid(list) {
  const grid = document.getElementById("alumni-grid");
  if (list.length === 0) {
    grid.innerHTML = `<p style="color:var(--moss-600);font-family:var(--font-mono);font-size:.85rem;grid-column:1/-1;">No alumni profiles yet — be the first to register!</p>`;
    return;
  }
  grid.innerHTML = list.map(a => `
    <div class="alumni-card" data-id="${a.id}">
      ${a.photoUrl
        ? `<img class="alumni-avatar" src="${a.photoUrl}" alt="${a.fullName}">`
        : `<div class="alumni-avatar-placeholder">🎓</div>`}
      <div class="alumni-name">${a.fullName}</div>
      <div class="alumni-batch">Batch ${a.batch || "—"}</div>
      <div class="alumni-job">${a.currentJob || ""}</div>
      ${a.phone ? `<div class="alumni-contact">📞 ${a.phone}</div>` : ""}
      <div class="alumni-contact" style="color:var(--moss-600);">✉️ ${a.email}</div>
    </div>
  `).join("");

  grid.querySelectorAll(".alumni-card").forEach(card => {
    card.addEventListener("click", () => {
      const alum = allAlumni.find(a => a.id === card.dataset.id);
      openProfileModal(alum);
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
            ${h.job}${h.org ? ` — ${h.org}` : ""}
            <div class="job-date">${h.date || ""}</div>
          </div>`).join("")}
      </div>`
    : "";

  body.innerHTML = `
    ${alum.photoUrl
      ? `<img class="alumni-modal-avatar" src="${alum.photoUrl}" alt="${alum.fullName}">`
      : `<div class="alumni-modal-avatar-placeholder">🎓</div>`}
    <h3 style="text-align:center;margin-bottom:.2rem;">${alum.fullName}</h3>
    <p style="text-align:center;font-family:var(--font-mono);font-size:.75rem;color:var(--terracotta-500);margin-bottom:.8rem;">Batch ${alum.batch || "—"}</p>

    <div style="display:flex;flex-direction:column;gap:.4rem;margin-bottom:.8rem;">
      <div style="font-size:.88rem;"><strong>💼 Current Role:</strong> ${alum.currentJob || "—"}${alum.organization ? ` at ${alum.organization}` : ""}</div>
      <div style="font-size:.88rem;">✉️ ${alum.email}</div>
      ${alum.phone ? `<div style="font-size:.88rem;">📞 ${alum.phone}</div>` : ""}
    </div>

    ${historyHtml}

    <div class="edit-section">
      <p style="font-weight:600;font-size:.88rem;margin-bottom:.7rem;color:var(--moss-700);">✏️ Update Your Job Details</p>
      <p style="font-size:.8rem;color:var(--moss-600);margin-bottom:.8rem;">Enter your Student ID and Email to verify identity before editing.</p>
      <div class="edit-gate" id="edit-gate-${alum.id}">
        <input type="text" id="edit-sid-${alum.id}" placeholder="Your Student ID">
        <input type="email" id="edit-email-${alum.id}" placeholder="Your Email">
        <button class="btn-primary verify-edit-btn" data-id="${alum.id}" style="padding:.6rem;">Verify & Edit</button>
        <p class="edit-gate-status" id="edit-gate-status-${alum.id}" style="font-size:.8rem;display:none;"></p>
      </div>
      <div id="edit-form-${alum.id}" style="display:none;">
        <div class="form-field" style="margin-bottom:.8rem;">
          <label style="font-size:.85rem;">New Job Title / Position *</label>
          <input type="text" id="edit-job-${alum.id}" placeholder="e.g., Senior Agronomist" style="width:100%;padding:.6rem .8rem;border:1px solid var(--line);border-radius:8px;font-size:.9rem;">
        </div>
        <div class="form-field" style="margin-bottom:.8rem;">
          <label style="font-size:.85rem;">Organization</label>
          <input type="text" id="edit-org-${alum.id}" placeholder="Company / Organization" style="width:100%;padding:.6rem .8rem;border:1px solid var(--line);border-radius:8px;font-size:.9rem;">
        </div>
        <button class="btn-primary save-job-btn" data-id="${alum.id}" style="width:100%;padding:.65rem;">Save Job Update</button>
        <p id="save-job-status-${alum.id}" style="font-size:.8rem;text-align:center;margin-top:.5rem;display:none;"></p>
      </div>
    </div>`;

  modal.classList.remove("hidden");

  // Verify identity before showing edit form
  body.querySelector(`.verify-edit-btn`)?.addEventListener("click", async () => {
    const sid = document.getElementById(`edit-sid-${alum.id}`).value.trim();
    const email = document.getElementById(`edit-email-${alum.id}`).value.trim().toLowerCase();
    const statusEl = document.getElementById(`edit-gate-status-${alum.id}`);

    if (!sid || !email) {
      statusEl.textContent = "Please enter both fields.";
      statusEl.style.color = "var(--terracotta-500)";
      statusEl.style.display = "block";
      return;
    }

    if (sid === alum.studentId && email === alum.email.toLowerCase()) {
      document.getElementById(`edit-gate-${alum.id}`).style.display = "none";
      document.getElementById(`edit-form-${alum.id}`).style.display = "block";
    } else {
      statusEl.textContent = "❌ Student ID or Email does not match this profile.";
      statusEl.style.color = "var(--terracotta-500)";
      statusEl.style.display = "block";
    }
  });

  // Save job update and archive old job to history
  body.querySelector(`.save-job-btn`)?.addEventListener("click", async () => {
    const newJob = document.getElementById(`edit-job-${alum.id}`).value.trim();
    const newOrg = document.getElementById(`edit-org-${alum.id}`).value.trim();
    const statusEl = document.getElementById(`save-job-status-${alum.id}`);

    if (!newJob) {
      statusEl.textContent = "Please enter a job title.";
      statusEl.style.color = "var(--terracotta-500)";
      statusEl.style.display = "block";
      return;
    }

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

      // Update local state and refresh grid
      alum.jobHistory = [...(alum.jobHistory || []), historyEntry];
      alum.currentJob = newJob;
      alum.organization = newOrg;
      renderGrid(allAlumni);

      setTimeout(() => modal.classList.add("hidden"), 1200);
    } catch (err) {
      statusEl.textContent = "Failed: " + err.message;
      statusEl.style.color = "var(--terracotta-500)";
      statusEl.style.display = "block";
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
  if (photoFile.size > 5 * 1024 * 1024) { showError("Photo must be under 5MB."); return; }

  // Check for duplicate studentId
  try {
    const dupQ = query(collection(db, "alumni"), where("studentId", "==", studentId));
    const dupSnap = await getDocs(dupQ);
    if (!dupSnap.empty) {
      showError("An alumni profile with this Student ID already exists.");
      return;
    }
  } catch (err) { /* proceed */ }

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
    console.error(err);
    showStatus("Something went wrong: " + err.message, true);
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit for Review";
  }
});

loadAlumni();
