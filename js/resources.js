import { db, CLOUDINARY_UPLOAD_URL, CLOUDINARY_UPLOAD_PRESET } from "./firebase-config.js";
import {
  collection, addDoc, serverTimestamp, query, where, getDocs, setDoc, doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const MAX_FILES = 20;
const MAX_SIZE = 50 * 1024 * 1024; // 50MB

function uploadFileToCloudinary(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", CLOUDINARY_UPLOAD_URL, true);
    xhr.timeout = 120000;
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const json = JSON.parse(xhr.responseText);
        resolve({ url: json.secure_url, name: file.name });
      } else {
        reject(new Error(`Upload failed for ${file.name} (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error uploading " + file.name + "."));
    xhr.ontimeout = () => reject(new Error(file.name + " timed out. Try again."));
    const data = new FormData();
    data.append("file", file);
    data.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    xhr.send(data);
  });
}

// ============================================
// XSS ESCAPE HELPER
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
// UPLOAD FORM MODAL (resources.html)
// ============================================
const openUploadBtn = document.getElementById("open-upload-form");
const uploadModal = document.getElementById("upload-form-modal");
const uploadModalClose = document.getElementById("upload-form-close");

if (openUploadBtn) openUploadBtn.addEventListener("click", () => uploadModal?.classList.remove("hidden"));
if (uploadModalClose) uploadModalClose.addEventListener("click", () => uploadModal?.classList.add("hidden"));
if (uploadModal) {
  uploadModal.addEventListener("click", (e) => { if (e.target === uploadModal) uploadModal.classList.add("hidden"); });
  if (window.location.hash === "#upload") uploadModal.classList.remove("hidden");
}

// ============================================
// UPLOAD FORM (resources.html)
// ============================================
const uploadForm = document.getElementById("upload-form");
if (uploadForm) {
  const resourceTypeSelect = document.getElementById("resourceType");
  const examTypeWrap = document.getElementById("examType-wrap");
  const fileInput = document.getElementById("files");
  const statusBox = document.getElementById("upload-status");
  const submitBtn = document.getElementById("upload-submit");
  const successBox = document.getElementById("upload-success");
  const courseCodeInput = document.getElementById("courseCode");
  const courseNameInput = document.getElementById("courseName");
  const facultyNameInput = document.getElementById("facultyName");
  const progressWrap = document.getElementById("upload-progress-wrap");
  const progressBar = document.getElementById("progress-ring-bar");
  const progressText = document.getElementById("progress-ring-text");
  const CIRCUMFERENCE = 226.19;

  let matchedCourse = null;

  courseCodeInput.addEventListener("blur", async () => {
    const code = courseCodeInput.value.trim().toUpperCase();
    if (!code) { matchedCourse = null; courseNameInput.readOnly = false; courseNameInput.value = ""; return; }
    try {
      const courseSnap = await getDoc(doc(db, "courses", code));
      if (courseSnap.exists()) {
        matchedCourse = courseSnap.data();
        courseNameInput.value = matchedCourse.courseName;
        courseNameInput.readOnly = true;
      } else {
        matchedCourse = null;
        courseNameInput.readOnly = false;
      }
    } catch (err) { console.error("Error checking canonical course:", err); }
  });

  resourceTypeSelect.addEventListener("change", () => {
    examTypeWrap.classList.toggle("hidden", resourceTypeSelect.value !== "previous_questions");
  });

  function setProgress(pct) {
    progressBar.style.strokeDashoffset = CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE;
    progressText.textContent = pct + "%";
  }
  function showError(msg) {
    progressWrap.classList.add("hidden");
    statusBox.textContent = msg;
    statusBox.style.color = "var(--terracotta-500)";
    statusBox.classList.remove("hidden");
  }
  function showStatus(msg, isError = false) {
    progressWrap.classList.remove("hidden");
    statusBox.textContent = msg;
    statusBox.style.color = isError ? "var(--terracotta-500)" : "var(--moss-600)";
    if (isError) progressBar.style.stroke = "var(--terracotta-500)";
  }

  uploadForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const rawCourseCode = courseCodeInput.value.trim().toUpperCase();
    const rawCourseName = courseNameInput.value.trim();
    const facultyName = facultyNameInput.value.trim();
    const resourceType = resourceTypeSelect.value;
    const examType = document.getElementById("examType").value;
    const uploaderName = document.getElementById("uploaderName").value.trim();
    const uploaderEmail = document.getElementById("uploaderEmail").value.trim();
    const files = Array.from(fileInput.files);

    if (files.length === 0) { showError("Please choose at least one file."); return; }
    if (files.length > MAX_FILES) { showError(`Maximum ${MAX_FILES} files allowed.`); return; }
    const nonPdf = files.find(f => !f.name.toLowerCase().endsWith(".pdf") || (f.type && f.type !== "application/pdf"));
    if (nonPdf) { showError(`"${nonPdf.name}" is not a PDF. Only PDF files are accepted.`); return; }
    const oversized = files.find(f => f.size > MAX_SIZE);
    if (oversized) { showError(`"${oversized.name}" is over 50MB.`); return; }

    const finalCourseCode = matchedCourse ? matchedCourse.courseCode : rawCourseCode;
    const finalCourseName = matchedCourse ? matchedCourse.courseName : rawCourseName;

    submitBtn.disabled = true;
    submitBtn.textContent = "Uploading…";
    setProgress(0);
    showStatus(`Uploading ${files.length} file(s) in parallel…`);

    try {
      const progressByFile = new Array(files.length).fill(0);
      const updateOverall = () => {
        const avg = Math.round(progressByFile.reduce((a, b) => a + b, 0) / files.length);
        setProgress(avg);
        showStatus(avg >= 100 ? "Processing on server…" : `Uploading ${files.length} file(s)…`);
      };
      const fileUrls = await Promise.all(
        files.map((file, i) => uploadFileToCloudinary(file, (pct) => { progressByFile[i] = pct; updateOverall(); }))
      );
      showStatus("Saving details…");
      setProgress(100);
      if (!matchedCourse) {
        await setDoc(doc(db, "courses", finalCourseCode), { courseCode: finalCourseCode, courseName: finalCourseName });
      }
      const docData = {
        courseCode: finalCourseCode, courseName: finalCourseName, facultyName,
        resourceType, uploaderEmail, fileUrls, status: "pending", submittedAt: serverTimestamp()
      };
      if (uploaderName) docData.uploaderName = uploaderName;
      if (resourceType === "previous_questions" && examType) docData.examType = examType;
      await addDoc(collection(db, "resources"), docData);
      uploadForm.reset();
      uploadForm.classList.add("hidden");
      statusBox.classList.add("hidden");
      successBox.classList.remove("hidden");
      matchedCourse = null;
      courseNameInput.readOnly = false;
    } catch (err) {
      console.error("[Upload] failed:", err);
      showStatus("Something went wrong. Please try again.", true);
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit for Review";
    }
  });
}

// ============================================
// SLIDES & NOTES BROWSING (slides-notes.html)
// ============================================
const courseButtonsWrap = document.getElementById("course-buttons");
// Guard: only run on slides-notes.html where this element exists
if (courseButtonsWrap) {
  const slidesList = document.getElementById("slides-list");
  const slidesSearchInput = document.getElementById("slides-search");
  let allSlides = [];

  async function loadSlides() {
    try {
      // Single where() — avoids composite index requirement
      const q = query(collection(db, "resources"), where("resourceType", "==", "slides_notes"));
      const snap = await getDocs(q);
      // Filter approved client-side
      allSlides = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => d.status === "approved");
      renderCourseButtons(allSlides);
    } catch (err) {
      console.error("[Slides] loadSlides failed:", err);
      courseButtonsWrap.innerHTML = `<p style="color:var(--terracotta-500);font-family:var(--font-mono);font-size:.85rem;">Could not load courses. Please refresh and try again.</p>`;
    }
  }

  function renderCourseButtons(items) {
    const codes = [...new Set(items.map(i => i.courseCode))].sort();
    if (codes.length === 0) {
      courseButtonsWrap.innerHTML = `<p style="color:var(--moss-600);font-family:var(--font-mono);font-size:.85rem;">No approved course materials yet — check back soon.</p>`;
      return;
    }
    courseButtonsWrap.innerHTML = codes.map(code => {
      const faculty = [...new Set(items.filter(i => i.courseCode === code).map(i => i.facultyName).filter(Boolean))].join(", ");
      return `
        <button class="course-btn" data-code="${esc(code)}">
          ${esc(code)}
          ${faculty ? `<div style="font-size:.7rem;font-weight:400;color:inherit;opacity:.75;margin-top:.2rem;">${esc(faculty)}</div>` : ""}
        </button>`;
    }).join("");
    courseButtonsWrap.querySelectorAll(".course-btn").forEach(btn => {
      btn.addEventListener("click", () => renderResourceList(btn.dataset.code));
    });
  }

  function renderResourceList(code) {
    const items = allSlides.filter(i => i.courseCode === code);
    if (!slidesList) return;
    slidesList.classList.remove("hidden");
    slidesList.innerHTML = `<h3 style="margin-bottom:1rem;">${esc(code)} — Lecture Materials</h3>` +
      items.map(item => `
        <div class="resource-row">
          <div>
            <strong>${esc(item.courseName || code)}</strong>
            <div style="font-size:.8rem;color:var(--moss-600);">${item.fileUrls.length} file(s)</div>
          </div>
          <div class="resource-row-files">
            ${item.fileUrls.map(f => `<a href="view.html?url=${encodeURIComponent(f.url)}&name=${encodeURIComponent(f.name)}" class="view-link">View: ${esc(f.name)}</a>`).join("")}
          </div>
        </div>`).join("");
  }

  if (slidesSearchInput) {
    slidesSearchInput.addEventListener("input", () => {
      const term = slidesSearchInput.value.trim().toUpperCase();
      const filtered = term ? allSlides.filter(i => i.courseCode.includes(term)) : allSlides;
      renderCourseButtons(filtered);
      if (slidesList) slidesList.classList.add("hidden");
    });
  }

  loadSlides().then(() => {
    // Deep link support: slides-notes.html?course=CODE (from homepage search)
    const courseParam = new URLSearchParams(location.search).get("course");
    if (courseParam) renderResourceList(courseParam.toUpperCase());
  });
}

// ============================================
// SUGGESTIONS ACCESS GATE (previous-questions.html)
// ============================================
const pqGate = document.getElementById("pq-gate");
const pqContent = document.getElementById("pq-content");
const pqList = document.getElementById("pq-list");
const pqSearchBtn = document.getElementById("pq-search-btn");
let loadPQ;

// Guard: only run on previous-questions.html
if (pqGate && pqContent && pqList) {
  const gateInput = document.getElementById("pq-gate-input");
  const gateSubmit = document.getElementById("pq-gate-submit");
  const gateStatus = document.getElementById("pq-gate-status");

  function showGateStatus(html, stateClass) {
    gateStatus.innerHTML = html;
    gateStatus.className = "access-status " + stateClass;
    gateStatus.classList.remove("hidden");
  }

  function grantAccess() {
    pqGate.classList.add("hidden");
    pqContent.classList.remove("hidden");
    if (typeof loadPQ === "function") loadPQ();
  }

  // CVE-8: Always re-verify from Firestore — no sessionStorage caching
  if (gateSubmit) {
    gateSubmit.addEventListener("click", async () => {
      const studentId = gateInput.value.trim();
      if (!studentId) { showGateStatus("Please enter your Student ID.", "is-unknown"); return; }
      gateSubmit.disabled = true;
      gateSubmit.textContent = "Checking…";
      showGateStatus("Checking your registration…", "is-unknown");
      try {
        const q = query(collection(db, "registrations"), where("studentIdNumber", "==", studentId));
        const snap = await getDocs(q);
        if (snap.empty) {
          showGateStatus(`❌ NOT REGISTERED<div class="access-status-note">We couldn't find that Student ID. Please register first.</div>`, "is-rejected");
        } else {
          const reg = snap.docs[0].data();
          const status = reg.status || "unverified";
          if (status === "verified") {
            showGateStatus("✅ ACCESS GRANTED", "is-granted");
            setTimeout(grantAccess, 700);
          } else if (status === "rejected") {
            showGateStatus(`❌ REJECTED<div class="access-status-note">Your registration was rejected. Please register again.</div>`, "is-rejected");
          } else {
            showGateStatus(`⏳ PENDING APPROVAL<div class="access-status-note">Your registration is awaiting admin review. Please check back later.</div>`, "is-pending");
          }
        }
      } catch (err) {
        console.error("[PQ Gate] check failed:", err);
        showGateStatus("Something went wrong. Please try again.", "is-unknown");
      } finally {
        gateSubmit.disabled = false;
        gateSubmit.textContent = "Check Access";
      }
    });
  }

  // ============================================
  // PREVIOUS QUESTIONS BROWSING
  // ============================================
  loadPQ = async function () {
    const facultyFilter = document.getElementById("pq-faculty")?.value.trim() || "";
    const courseFilter = (document.getElementById("pq-course")?.value.trim() || "").toUpperCase();
    const examFilter = document.getElementById("pq-exam")?.value || "";

    try {
      // Single where() — avoids composite index requirement
      const q = query(collection(db, "resources"), where("resourceType", "==", "previous_questions"));
      const snap = await getDocs(q);
      // Filter approved client-side
      let items = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => d.status === "approved");

      if (facultyFilter) items = items.filter(i => (i.facultyName || "").toLowerCase().includes(facultyFilter.toLowerCase()));
      if (courseFilter) items = items.filter(i => i.courseCode.includes(courseFilter));
      if (examFilter) items = items.filter(i => i.examType === examFilter);

      if (items.length === 0) {
        pqList.innerHTML = `<p style="color:var(--moss-600);font-family:var(--font-mono);font-size:.85rem;">No matching previous questions found yet.</p>`;
        return;
      }
      pqList.innerHTML = items.map(item => `
        <div class="seed-card" style="cursor:default;">
          <div class="tag-strip"><span class="tag-dot"></span><span class="tag">${esc(item.examType || "Question")}</span></div>
          <div class="card-body">
            <h3>${esc(item.courseCode)}</h3>
            <p style="font-size:.85rem;color:var(--moss-600);margin-bottom:.7rem;">${esc(item.facultyName || "")}</p>
            ${item.fileUrls.map(f => `<a href="view.html?url=${encodeURIComponent(f.url)}&name=${encodeURIComponent(f.name)}" class="view-link">View Question</a>`).join("<br>")}
          </div>
        </div>`).join("");
    } catch (err) {
      console.error("[PQ] loadPQ failed:", err);
      pqList.innerHTML = `<p style="color:var(--terracotta-500);font-family:var(--font-mono);font-size:.85rem;">Could not load questions. Please refresh and try again.</p>`;
    }
  };

  if (pqSearchBtn) pqSearchBtn.addEventListener("click", loadPQ);

  // Deep link support: previous-questions.html?course=CODE (from homepage
  // search) — pre-fills the course filter for once access is granted.
  const pqCourseParam = new URLSearchParams(location.search).get("course");
  const pqCourseInput = document.getElementById("pq-course");
  if (pqCourseParam && pqCourseInput) pqCourseInput.value = pqCourseParam.toUpperCase();
}
