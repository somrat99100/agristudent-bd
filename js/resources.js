import { db, CLOUDINARY_UPLOAD_URL, CLOUDINARY_UPLOAD_PRESET } from "./firebase-config.js";
import {
  collection, addDoc, serverTimestamp, query, where, getDocs, setDoc, doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { normalizeEmail, normalizeStudentId } from "./identity.js";
import { getSession } from "./session.js";

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
// PREFILL FROM SESSION
// If the student is logged in, prefill the uploader email (and name, if
// the field exists) so every upload is stamped with their canonical,
// already-normalized identity instead of a freshly-retyped one that
// could differ in case/whitespace and silently break credit tracking.
// ============================================
function prefillFromSession(emailInputId, nameInputId) {
  const session = getSession();
  if (!session) return;
  const emailInput = document.getElementById(emailInputId);
  if (emailInput && !emailInput.value) emailInput.value = session.email;
  if (nameInputId) {
    const nameInput = document.getElementById(nameInputId);
    if (nameInput && !nameInput.value && session.fullName) nameInput.value = session.fullName;
  }
}

// ============================================
// STUDENT ID LOOKUP (by registered email)
// Used to stamp every upload with the uploader's registered Student ID,
// so the viewer can show "who uploaded this" without asking the student
// to re-enter their ID on every upload form.
// ============================================
async function lookupStudentIdByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;
  try {
    const q = query(collection(db, "registrations"), where("email", "==", normalizedEmail));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const raw = snap.docs[0].data().studentIdNumber || null;
    return raw ? normalizeStudentId(raw) : null;
  } catch (err) {
    console.error("[Student ID Lookup] failed:", err);
    return null;
  }
}

// ============================================
// VIEW LINK BUILDER
// Centralizes the view.html query string so every resource card/list
// carries the same ownership + metadata params (see: ownership label &
// upload-count features).
// ============================================
function buildViewHref(file, item = {}) {
  let href = `view.html?url=${encodeURIComponent(file.url)}&name=${encodeURIComponent(file.name)}`;
  if (item.courseCode) href += `&code=${encodeURIComponent(item.courseCode)}`;
  if (file.title) href += `&title=${encodeURIComponent(file.title)}`;
  if (item.uploaderStudentId) href += `&owner=${encodeURIComponent(item.uploaderStudentId)}`;
  return href;
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
// Same premium file-type-picker experience as "Upload Another File" on
// slides-notes.html: PDF/Image/PPT choice, course-name hint, faculty
// suggestions, per-image titles — plus this form's own Hand Notes vs.
// Suggestions resourceType + examType fields, unchanged.
// ============================================
const uploadForm = document.getElementById("upload-form");
if (uploadForm) {
  prefillFromSession("uploaderEmail");
  const fileInput = document.getElementById("files");
  const filesLabel = document.getElementById("files-label");
  const statusBox = document.getElementById("upload-status");
  const submitBtn = document.getElementById("upload-submit");
  const successBox = document.getElementById("upload-success");
  const courseCodeInput = document.getElementById("courseCode");
  const courseNameInput = document.getElementById("courseName");
  const courseNameHint = document.getElementById("courseName-hint");
  const facultyNameInput = document.getElementById("facultyName");
  const facultySuggestions = document.getElementById("upload-faculty-suggestions");
  const imageTitlesWrap = document.getElementById("upload-image-titles-wrap");
  const imageTitlesListEl = document.getElementById("upload-image-titles-list");
  const progressWrap = document.getElementById("upload-progress-wrap");
  const progressBar = document.getElementById("progress-ring-bar");
  const progressText = document.getElementById("progress-ring-text");
  const CIRCUMFERENCE = 226.19;

  const fileTypeAccepts = {
    pdf: ".pdf,application/pdf",
    image: "image/*,.jpg,.jpeg,.png,.gif,.webp",
    ppt: ".ppt,.pptx,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
  };
  let currentFileType = "pdf";
  let matchedCourse = null;

  function cleanFileNameAsTitle(name) {
    return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  }
  function renderImageTitleInputs() {
    if (!imageTitlesWrap || !imageTitlesListEl) return;
    if (currentFileType !== "image" || !fileInput.files || fileInput.files.length === 0) {
      imageTitlesWrap.classList.add("hidden");
      imageTitlesListEl.innerHTML = "";
      return;
    }
    imageTitlesListEl.innerHTML = Array.from(fileInput.files).map((f, i) => `
      <input type="text" class="upload-image-title-input" data-index="${i}"
             placeholder="Title for: ${esc(f.name)}" value="${esc(cleanFileNameAsTitle(f.name))}"
             style="width:100%;padding:.5rem .7rem;border:1px solid var(--line);border-radius:6px;font-size:.85rem;">
    `).join("");
    imageTitlesWrap.classList.remove("hidden");
  }
  fileInput.addEventListener("change", renderImageTitleInputs);

  document.querySelectorAll('input[name="fileType"]').forEach(radio => {
    radio.addEventListener("change", () => {
      currentFileType = radio.value;
      fileInput.accept = fileTypeAccepts[currentFileType];
      const labels = {
        pdf: "PDF File(s) * (max 20 files, 50MB each)",
        image: "Image File(s) * (JPG, PNG, GIF, WebP — max 20 files, 50MB each)",
        ppt: "Presentation File(s) * (PPT/PPTX — max 20 files, 50MB each)"
      };
      if (filesLabel) filesLabel.textContent = labels[currentFileType];
      document.querySelectorAll('input[name="fileType"]').forEach(r => {
        r.closest("label").style.borderColor = r.checked ? "var(--leaf-500)" : "var(--line)";
        r.closest("label").style.background = r.checked ? "rgba(107, 155, 94, 0.05)" : "transparent";
      });
      renderImageTitleInputs();
    });
  });

  courseCodeInput.addEventListener("blur", async () => {
    const code = courseCodeInput.value.trim().toUpperCase();
    if (courseNameHint) courseNameHint.classList.add("hidden");
    if (facultySuggestions) facultySuggestions.innerHTML = "";
    if (!code) { matchedCourse = null; courseNameInput.readOnly = false; courseNameInput.value = ""; return; }
    try {
      const courseSnap = await getDoc(doc(db, "courses", code));
      if (courseSnap.exists()) {
        matchedCourse = courseSnap.data();
        courseNameInput.value = matchedCourse.courseName;
        courseNameInput.readOnly = true;
        if (courseNameHint) {
          courseNameHint.innerHTML = `Suggested from an existing course: <strong>${esc(matchedCourse.courseName)}</strong>.`;
          courseNameHint.classList.remove("hidden");
        }
      } else {
        matchedCourse = null;
        courseNameInput.readOnly = false;
      }
      if (facultySuggestions) {
        const q = query(collection(db, "resources"), where("courseCode", "==", code));
        const snap = await getDocs(q);
        const faculties = [...new Set(snap.docs.map(d => d.data().facultyName).filter(Boolean))];
        facultySuggestions.innerHTML = faculties.map(f => `<option value="${esc(f)}"></option>`).join("");
      }
    } catch (err) { console.error("Error checking canonical course:", err); }
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
    const resourceType = "slides_notes";
    const uploaderEmail = normalizeEmail(document.getElementById("uploaderEmail").value);
    const files = Array.from(fileInput.files);

    if (files.length === 0) { showError(`Please choose at least one ${currentFileType.toUpperCase()} file.`); return; }
    if (files.length > MAX_FILES) { showError(`Maximum ${MAX_FILES} files allowed.`); return; }

    let validationError = false;
    if (currentFileType === "pdf") {
      validationError = files.some(f => !f.name.toLowerCase().endsWith(".pdf"));
    } else if (currentFileType === "image") {
      validationError = files.some(f => !["jpg","jpeg","png","gif","webp"].includes(f.name.toLowerCase().split(".").pop()));
    } else if (currentFileType === "ppt") {
      validationError = files.some(f => !["ppt","pptx"].includes(f.name.toLowerCase().split(".").pop()));
    }
    if (validationError) { showError(`Some files are not valid ${currentFileType.toUpperCase()} files.`); return; }

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

      if (currentFileType === "image" && imageTitlesListEl) {
        const titleInputs = imageTitlesListEl.querySelectorAll(".upload-image-title-input");
        fileUrls.forEach((f, i) => {
          const t = titleInputs[i] ? titleInputs[i].value.trim() : "";
          f.title = t || cleanFileNameAsTitle(f.name);
        });
      }

      showStatus("Saving details…");
      setProgress(100);
      if (!matchedCourse) {
        await setDoc(doc(db, "courses", finalCourseCode), { courseCode: finalCourseCode, courseName: finalCourseName });
      }
      const docData = {
        courseCode: finalCourseCode, courseName: finalCourseName, facultyName,
        resourceType, uploaderEmail, fileUrls, fileType: currentFileType, status: "pending", submittedAt: serverTimestamp()
      };
      const uploaderStudentId = await lookupStudentIdByEmail(uploaderEmail);
      if (uploaderStudentId) docData.uploaderStudentId = uploaderStudentId;
      await addDoc(collection(db, "resources"), docData);
      uploadForm.reset();
      uploadForm.classList.add("hidden");
      statusBox.classList.add("hidden");
      successBox.classList.remove("hidden");
      matchedCourse = null;
      courseNameInput.readOnly = false;
      if (courseNameHint) courseNameHint.classList.add("hidden");
      if (imageTitlesWrap) imageTitlesWrap.classList.add("hidden");
    } catch (err) {
      console.error("[Upload] failed:", err);
      let userMessage = "Something went wrong. Please try again.";
      if (err.code === "permission-denied") {
        userMessage = "Upload was rejected. Please check the course code and file(s), then try again.";
      } else if (/network/i.test(err.message || "")) {
        userMessage = "Network error. Check your connection and try again.";
      } else if (/timed out/i.test(err.message || "")) {
        userMessage = "Upload took too long. Try again with a smaller file.";
      }
      showStatus(userMessage, true);
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
      // Two equality filters — still no composite index required.
      // status must be filtered in the query itself: the security rule
      // checks resource.data.status, so an unfiltered query is rejected
      // outright rather than silently returning fewer docs.
      const q = query(
        collection(db, "resources"),
        where("resourceType", "==", "slides_notes"),
        where("status", "==", "approved")
      );
      const snap = await getDocs(q);
      allSlides = snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
            ${item.fileUrls.map(f => `<a href="${buildViewHref(f, item)}" class="view-link">View: ${esc(f.name)}</a>`).join("")}
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

  // Runs once access is granted (see shared access gate below) —
  // loads the course list and honors the ?course=CODE deep link.
  window.__onResourceAccessGranted = window.__onResourceAccessGranted || [];
  window.__onResourceAccessGranted.push(() => {
    loadSlides().then(() => {
      const courseParam = new URLSearchParams(location.search).get("course");
      if (courseParam) renderResourceList(courseParam.toUpperCase());
    });
  });
}

// ============================================
// RESOURCES PAGE — LOGIN-ONLY GATE (resources.html)
// ============================================
// No more Student-ID "Check Access" step here — a logged-in session
// (see js/session.js) is all that's needed to browse the Resources hub
// and reach the Upload form. Real access control for the notes
// themselves happens on slides-notes.html's own Hand Notes gate below,
// keyed off the student's upload status.
const resourceGate = document.getElementById("resource-gate");
const resourceContent = document.getElementById("resource-content");

if (resourceGate && resourceContent) {
  if (getSession()) {
    resourceGate.classList.add("hidden");
    resourceContent.classList.remove("hidden");
    (window.__onResourceAccessGranted || []).forEach(fn => fn());
  }
}

// ============================================
// HAND NOTES UNLOCK GATE (slides-notes.html)
// ============================================
// Access is granted by uploading a file (PDF/Image/PPT).
// User keeps access while file is pending/approved.
// If rejected, they lose access and must upload new file.
const handNotesGate = document.getElementById("handnotes-gate");
const handNotesContent = document.getElementById("resource-content");
const accessStatusBar = document.getElementById("access-status-bar");

if (handNotesGate && handNotesContent) {
  prefillFromSession("hn-uploaderEmail");
  const HN_STORAGE_KEY = "agri_handnotes_user_email";
  const hnForm = document.getElementById("handnotes-unlock-form");
  const hnFiles = document.getElementById("hn-files");
  const hnSubmit = document.getElementById("hn-unlock-submit");
  const hnStatus = document.getElementById("hn-unlock-status");
  const hnProgressWrap = document.getElementById("hn-unlock-progress-wrap");
  const hnProgressBar = document.getElementById("hn-progress-ring-bar");
  const hnProgressText = document.getElementById("hn-progress-ring-text");
  const hnFilesLabel = document.getElementById("hn-files-label");
  const HN_CIRCUMFERENCE = 226.19;

  // File type acceptances
  const fileTypeAccepts = {
    pdf: ".pdf,application/pdf",
    image: "image/*,.jpg,.jpeg,.png,.gif,.webp",
    ppt: ".ppt,.pptx,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
  };

  let currentFileType = "pdf";

  function hnGrantAccess(userEmail) {
    const normalizedEmail = normalizeEmail(userEmail);
    localStorage.setItem(HN_STORAGE_KEY, normalizedEmail);
    handNotesGate.classList.add("hidden");
    handNotesContent.classList.remove("locked");
    document.getElementById("open-another-upload")?.classList.remove("hidden");
    hnCheckAndDisplayStatus(normalizedEmail);
    (window.__onResourceAccessGranted || []).forEach(fn => fn());
  }

  async function hnCheckAndDisplayStatus(userEmail) {
    if (!accessStatusBar) return;
    const normalizedEmail = normalizeEmail(userEmail);
    try {
      const q = query(
        collection(db, "resources"),
        where("uploaderEmail", "==", normalizedEmail),
        where("resourceType", "==", "slides_notes")
      );
      const snap = await getDocs(q);
      
      if (snap.empty) {
        accessStatusBar.classList.add("hidden");
        return;
      }

      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const latest = docs.sort((a, b) => (b.submittedAt?.toDate() || 0) - (a.submittedAt?.toDate() || 0))[0];

      // Uploads-by-Student-ID count — always the live total, recomputed on
      // every status check (i.e. right after every upload).
      const uploadCount = docs.length;
      let ownerStudentId = latest.uploaderStudentId;
      if (!ownerStudentId) ownerStudentId = await lookupStudentIdByEmail(userEmail);
      const uploadCountLine = `<div class="file-info">Uploads by ${ownerStudentId ? `Student ID <strong>${esc(ownerStudentId)}</strong>` : "this account"}: ${uploadCount}</div>`;

      accessStatusBar.classList.remove("hidden");
      accessStatusBar.classList.remove("approved", "pending", "rejected");

      if (latest.status === "approved") {
        accessStatusBar.classList.add("approved");
        const submittedDate = latest.submittedAt?.toDate?.()?.toLocaleDateString?.() || "recently";
        accessStatusBar.querySelector(".status-content").innerHTML = `
          <strong>✅ APPROVED — Full Access</strong>
          <div class="file-info">Approved on ${submittedDate}</div>
          ${uploadCountLine}
        `;
      } else if (latest.status === "pending") {
        accessStatusBar.classList.add("pending");
        const submittedDate = latest.submittedAt?.toDate?.()?.toLocaleDateString?.() || "today";
        accessStatusBar.querySelector(".status-content").innerHTML = `
          <strong>⏳ PENDING — Access Granted (Awaiting Review)</strong>
          <div class="file-info">Uploaded on ${submittedDate}<br>Still waiting for admin review — access stays on until then.</div>
          ${uploadCountLine}
        `;
      } else if (latest.status === "rejected") {
        accessStatusBar.classList.add("rejected");
        handNotesGate.classList.remove("hidden");
        handNotesContent.classList.add("locked");
        document.getElementById("open-another-upload")?.classList.add("hidden");
        accessStatusBar.querySelector(".status-content").innerHTML = `
          <strong>❌ ACCESS EXPIRED — File Rejected</strong>
          <button class="action-btn" onclick="document.getElementById('handnotes-gate').scrollIntoView({behavior:'smooth'});">Upload New File</button>
        `;
      }
    } catch (err) {
      console.error("[Access Status Check] failed:", err);
    }
  }

  function hnSetProgress(pct) {
    hnProgressBar.style.strokeDashoffset = HN_CIRCUMFERENCE - (pct / 100) * HN_CIRCUMFERENCE;
    hnProgressText.textContent = pct + "%";
  }

  function hnShowStatus(msg, isError = false) {
    hnProgressWrap.classList.remove("hidden");
    hnStatus.textContent = msg;
    hnStatus.style.color = isError ? "var(--terracotta-500)" : "var(--moss-600)";
  }

  // Check if user already has access (from a previous upload, or from
  // being logged in — see js/session.js, which seeds this same cache key
  // on login so this check picks it up for free).
  const cachedEmail = normalizeEmail(localStorage.getItem(HN_STORAGE_KEY) || getSession()?.email || "");
  if (cachedEmail) {
    // Verify current status
    const q = query(
      collection(db, "resources"),
      where("uploaderEmail", "==", cachedEmail),
      where("resourceType", "==", "slides_notes")
    );
    getDocs(q).then(snap => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // BUG FIX: `docs` is a plain array (from .map()), not a Firestore
      // QuerySnapshot — arrays have no `.empty` property, so the old
      // `!docs.empty` check was always true regardless of whether any
      // uploads actually existed, and would throw when the array really
      // was empty (accessing .status on undefined). Check .length instead.
      if (docs.length > 0) {
        const latest = docs.sort((a, b) => (b.submittedAt?.toDate() || 0) - (a.submittedAt?.toDate() || 0))[0];
        if (latest.status !== "rejected") {
          hnGrantAccess(cachedEmail);
        }
      }
    }).catch(err => console.error("[Access Verify] failed:", err));
  }

  // File type selector
  const fileTypeRadios = document.querySelectorAll('input[name="fileType"]');
  const imageTitlesWrap = document.getElementById("hn-image-titles-wrap");
  const imageTitlesList = document.getElementById("hn-image-titles-list");

  function cleanFileNameAsTitle(name) {
    return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  }

  function renderImageTitleInputs() {
    if (currentFileType !== "image" || !hnFiles.files || hnFiles.files.length === 0) {
      imageTitlesWrap.classList.add("hidden");
      imageTitlesList.innerHTML = "";
      return;
    }
    imageTitlesList.innerHTML = Array.from(hnFiles.files).map((f, i) => `
      <input type="text" class="hn-image-title-input" data-index="${i}"
             placeholder="Title for: ${esc(f.name)}" value="${esc(cleanFileNameAsTitle(f.name))}"
             style="width:100%;padding:.5rem .7rem;border:1px solid var(--line);border-radius:6px;font-size:.85rem;">
    `).join("");
    imageTitlesWrap.classList.remove("hidden");
  }

  hnFiles.addEventListener("change", renderImageTitleInputs);

  fileTypeRadios.forEach(radio => {
    radio.addEventListener("change", () => {
      currentFileType = radio.value;
      hnFiles.accept = fileTypeAccepts[currentFileType];
      
      // Update label
      const labels = {
        pdf: "PDF File(s) * (max 20 files, 50MB each)",
        image: "Image File(s) * (JPG, PNG, GIF, WebP - max 20 files, 50MB each)",
        ppt: "Presentation File(s) * (PPT/PPTX - max 20 files, 50MB each)"
      };
      hnFilesLabel.textContent = labels[currentFileType];

      // Visual feedback
      document.querySelectorAll('input[name="fileType"]').forEach(r => {
        r.closest("label").style.borderColor = r.checked ? "var(--leaf-500)" : "var(--line)";
        r.closest("label").style.background = r.checked ? "rgba(107, 155, 94, 0.05)" : "transparent";
      });

      renderImageTitleInputs();
    });
  });

  if (hnForm) {
    hnForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const courseCode = document.getElementById("hn-courseCode").value.trim().toUpperCase();
      const courseName = document.getElementById("hn-courseName").value.trim();
      const facultyName = document.getElementById("hn-facultyName").value.trim();
      const uploaderEmail = normalizeEmail(document.getElementById("hn-uploaderEmail").value);
      const files = Array.from(hnFiles.files);

      if (files.length === 0) { 
        hnShowStatus(`Please choose at least one ${currentFileType.toUpperCase()} file.`, true); 
        return; 
      }
      if (files.length > MAX_FILES) { 
        hnShowStatus(`Maximum ${MAX_FILES} files allowed.`, true); 
        return; 
      }

      const oversized = files.find(f => f.size > MAX_SIZE);
      if (oversized) { 
        hnShowStatus(`"${oversized.name}" is over 50MB.`, true); 
        return; 
      }

      // Validate file types
      let validationError = false;
      if (currentFileType === "pdf") {
        validationError = files.some(f => !f.name.toLowerCase().endsWith(".pdf"));
      } else if (currentFileType === "image") {
        validationError = files.some(f => !["jpg","jpeg","png","gif","webp"].includes(f.name.toLowerCase().split(".").pop()));
      } else if (currentFileType === "ppt") {
        validationError = files.some(f => !["ppt","pptx"].includes(f.name.toLowerCase().split(".").pop()));
      }

      if (validationError) {
        hnShowStatus(`Some files are not valid ${currentFileType.toUpperCase()} files.`, true);
        return;
      }

      hnSubmit.disabled = true;
      hnSubmit.textContent = "Uploading…";
      hnSetProgress(0);
      hnShowStatus(`Uploading ${files.length} file(s)…`);

      try {
        const progressByFile = new Array(files.length).fill(0);
        const updateOverall = () => {
          const avg = Math.round(progressByFile.reduce((a, b) => a + b, 0) / files.length);
          hnSetProgress(avg);
          hnShowStatus(avg >= 100 ? "Processing on server…" : `Uploading ${files.length} file(s)…`);
        };
        
        const fileUrls = await Promise.all(
          files.map((file, i) => uploadFileToCloudinary(file, (pct) => { progressByFile[i] = pct; updateOverall(); }))
        );

        // Attach the per-image title captured at upload time (if any),
        // so the gallery and viewer can display it under the image.
        if (currentFileType === "image") {
          const titleInputs = imageTitlesList.querySelectorAll(".hn-image-title-input");
          fileUrls.forEach((f, i) => {
            const t = titleInputs[i] ? titleInputs[i].value.trim() : "";
            f.title = t || cleanFileNameAsTitle(f.name);
          });
        }

        hnShowStatus("Saving details…");
        hnSetProgress(100);

        const courseSnap = await getDoc(doc(db, "courses", courseCode));
        const finalCourseName = courseSnap.exists() ? courseSnap.data().courseName : courseName;
        if (!courseSnap.exists()) {
          await setDoc(doc(db, "courses", courseCode), { courseCode, courseName: finalCourseName });
        }

        const hnDocData = {
          courseCode, courseName: finalCourseName, facultyName,
          resourceType: "slides_notes", uploaderEmail, fileUrls, fileType: currentFileType,
          status: "pending", submittedAt: serverTimestamp()
        };
        const hnUploaderStudentId = await lookupStudentIdByEmail(uploaderEmail);
        if (hnUploaderStudentId) hnDocData.uploaderStudentId = hnUploaderStudentId;
        await addDoc(collection(db, "resources"), hnDocData);

        hnShowStatus("✅ Submitted! Unlocking Hand Notes…");
        setTimeout(() => hnGrantAccess(uploaderEmail), 700);
      } catch (err) {
        console.error("[Hand Notes Unlock] failed:", err);
        let userMessage = "Something went wrong. Please try again.";
        if (err.code === "permission-denied") {
          userMessage = "Upload was rejected. Please check the details and try again.";
        } else if (/network/i.test(err.message || "")) {
          userMessage = "Network error. Check your connection and try again.";
        } else if (/timed out/i.test(err.message || "")) {
          userMessage = "Upload took too long. Try again with a smaller file.";
        }
        hnShowStatus(userMessage, true);
        hnSubmit.disabled = false;
        hnSubmit.textContent = "Upload & Unlock";
      }
    });
  }
}

// ============================================
// THREE-CARD PREMIUM LAYOUT (slides-notes.html)
// ============================================
const pdfList = document.getElementById("pdf-list");
const pdfSearch = document.getElementById("pdf-search");
const imageGrid = document.getElementById("image-grid");
const imageSearch = document.getElementById("image-search");

if (pdfList || imageGrid) {
  let allDocs = [];   // PDFs + Presentations, merged into one card
  let allImages = [];

  async function loadThreeCardLayout() {
    try {
      const q = query(
        collection(db, "resources"),
        where("resourceType", "==", "slides_notes"),
        where("status", "==", "approved")
      );
      const snap = await getDocs(q);
      const resources = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      // PDFs and Presentations share one card now; images stay separate.
      allDocs = resources.filter(r => r.fileType === "pdf" || r.fileType === "ppt" || !r.fileType); // no fileType defaults to PDF for backward compatibility
      allImages = resources.filter(r => r.fileType === "image");

      renderPdfCard();
      renderImageCard();
    } catch (err) {
      console.error("[Three Card Layout] load failed:", err);
    }
  }

  function docIcon(item) {
    return item.fileType === "ppt" ? "📊" : "📄";
  }

  let pdfSearchWired = false;

  function renderPdfCard() {
    const docCount = allDocs.length;
    document.getElementById("pdf-count").textContent = `(${docCount})`;

    if (docCount === 0) {
      pdfList.innerHTML = `<p style="color:var(--moss-600);font-size:.9rem;text-align:center;padding:1rem;">No files yet.</p>`;
      if (pdfSearch) pdfSearch.style.display = "none";
      document.getElementById("pdf-view-all").style.display = "none";
      return;
    }

    const displayCount = Math.min(5, docCount);

    if (pdfSearch) {
      pdfSearch.style.display = "block";
      renderPdfList(allDocs.slice(0, displayCount));

      if (!pdfSearchWired) {
        pdfSearchWired = true;
        pdfSearch.addEventListener("input", (e) => {
          const term = e.target.value.trim().toLowerCase();
          const filtered = term
            ? allDocs.filter(item =>
                (item.courseCode || "").toLowerCase().includes(term) ||
                (item.courseName || "").toLowerCase().includes(term)
              )
            : allDocs.slice(0, displayCount);
          renderPdfList(filtered);
        });
      }
    } else {
      renderPdfList(allDocs.slice(0, displayCount));
    }

    document.getElementById("pdf-view-all").style.display = docCount > displayCount ? "block" : "none";
  }

  function renderPdfList(items) {
    if (items.length === 0) {
      pdfList.innerHTML = `<p style="color:var(--moss-600);font-size:.9rem;text-align:center;padding:1rem;">No matching files found.</p>`;
      return;
    }
    pdfList.innerHTML = items.map(item => `
      <div class="file-item">
        <span class="file-status">${docIcon(item)}</span>
        <span class="file-name">${esc(item.courseCode)}: ${esc(item.courseName)}</span>
        <a href="${buildViewHref(item.fileUrls[0], item)}" class="file-action">View</a>
      </div>
    `).join("");
  }

  function renderImageCard() {
    const imageCount = allImages.length;
    document.getElementById("image-count").textContent = `(${imageCount})`;

    if (imageCount === 0) {
      imageGrid.innerHTML = `<p style="color:var(--moss-600);font-size:.9rem;text-align:center;padding:1rem;grid-column:1/-1;">No images yet.</p>`;
      imageSearch.style.display = "none";
      document.getElementById("image-view-all").style.display = "none";
      return;
    }

    imageSearch.style.display = "block";
    const displayCount = Math.min(6, imageCount);
    const displayed = allImages.slice(0, displayCount);

    renderImageGrid(displayed);
    document.getElementById("image-view-all").style.display = imageCount > displayCount ? "block" : "none";

    // Search functionality
    imageSearch.addEventListener("input", (e) => {
      const term = e.target.value.toLowerCase();
      const filtered = term 
        ? allImages.filter(img => 
            img.courseName.toLowerCase().includes(term) || 
            img.courseCode.toLowerCase().includes(term)
          )
        : allImages.slice(0, displayCount);
      renderImageGrid(filtered);
    });
  }

  function renderImageGrid(images) {
    if (images.length === 0) {
      imageGrid.innerHTML = `<p style="color:var(--moss-600);font-size:.9rem;text-align:center;padding:1rem;grid-column:1/-1;">No matching images found.</p>`;
      return;
    }

    imageGrid.innerHTML = images.map(img => {
      const file = img.fileUrls[0];
      const viewHref = buildViewHref(file, img);
      return `
      <a class="image-item" href="${viewHref}" style="text-decoration:none;">
        <div class="image-item-thumb">
          <img src="${encodeURI(file.url)}" alt="${esc(file.title || img.courseName)}" loading="lazy">
          <div class="status-badge">✓</div>
          <div class="view-overlay">
            <button type="button">View</button>
          </div>
        </div>
        <div class="image-item-caption">
          <span class="image-item-code">${esc(img.courseCode)}</span>
          ${file.title ? `<span class="image-item-title">${esc(file.title)}</span>` : ""}
        </div>
      </a>`;
    }).join("");
  }

  window.__onResourceAccessGranted = window.__onResourceAccessGranted || [];
  window.__onResourceAccessGranted.push(loadThreeCardLayout);

  // Load the preview immediately, regardless of unlock status — the
  // handnotes gate now shows a blurred/locked preview of real resources
  // rather than hiding them entirely, so this can't wait for access grant.
  loadThreeCardLayout();

  // ============================================
  // VIEW ALL MODALS
  // The small cards only ever preview up to 5/6 items. "View All" opens a
  // modal with the complete list — with a course-code search box, and (for
  // PDFs) a faculty filter that's populated from whatever the code search
  // currently matches.
  // ============================================
  function wireViewAllModal({ openBtnId, modalId, closeBtnId, searchId, facultyId, getItems, renderList, matchFn }) {
    const openBtn = document.getElementById(openBtnId);
    const modal = document.getElementById(modalId);
    if (!openBtn || !modal) return;
    const closeBtn = closeBtnId ? document.getElementById(closeBtnId) : null;
    const searchInput = searchId ? document.getElementById(searchId) : null;
    const facultySelect = facultyId ? document.getElementById(facultyId) : null;

    function apply() {
      const term = (searchInput?.value || "").trim();
      let items = getItems();
      if (term) items = items.filter(i => matchFn(i, term));

      if (facultySelect) {
        const faculties = [...new Set(items.map(i => i.facultyName).filter(Boolean))].sort();
        const current = facultySelect.value;
        facultySelect.innerHTML = `<option value="">All Faculties</option>` +
          faculties.map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join("");
        facultySelect.value = faculties.includes(current) ? current : "";
        if (facultySelect.value) items = items.filter(i => i.facultyName === facultySelect.value);
      }

      renderList(items);
    }

    openBtn.addEventListener("click", (e) => {
      e.preventDefault();
      if (searchInput) searchInput.value = "";
      if (facultySelect) facultySelect.value = "";
      modal.classList.remove("hidden");
      apply();
    });
    if (closeBtn) closeBtn.addEventListener("click", () => modal.classList.add("hidden"));
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });
    if (searchInput) searchInput.addEventListener("input", apply);
    if (facultySelect) facultySelect.addEventListener("change", apply);
  }

  function renderPdfRow(item) {
    return `
      <div class="file-item">
        <span class="file-status">${docIcon(item)}</span>
        <span class="file-name">${esc(item.courseCode)}: ${esc(item.courseName)}${item.facultyName ? ` <span style="opacity:.7;font-weight:400;">— ${esc(item.facultyName)}</span>` : ""}</span>
        <a href="${buildViewHref(item.fileUrls[0], item)}" class="file-action">View</a>
      </div>`;
  }

  wireViewAllModal({
    openBtnId: "pdf-view-all", modalId: "pdf-viewall-modal", closeBtnId: "pdf-viewall-close",
    searchId: "pdf-viewall-search", facultyId: "pdf-viewall-faculty",
    getItems: () => allDocs,
    matchFn: (i, term) => (i.courseCode || "").toUpperCase().includes(term.toUpperCase()),
    renderList: (items) => {
      const list = document.getElementById("pdf-viewall-list");
      list.innerHTML = items.length
        ? items.map(renderPdfRow).join("")
        : `<p style="color:var(--moss-600);font-size:.9rem;text-align:center;padding:1rem;">No matching files found.</p>`;
    }
  });

  wireViewAllModal({
    openBtnId: "image-view-all", modalId: "image-viewall-modal", closeBtnId: "image-viewall-close",
    searchId: "image-viewall-search", facultyId: null,
    getItems: () => allImages,
    matchFn: (i, term) => (i.courseCode || "").toLowerCase().includes(term.toLowerCase()) || (i.courseName || "").toLowerCase().includes(term.toLowerCase()),
    renderList: (items) => {
      const grid = document.getElementById("image-viewall-grid");
      if (!items.length) {
        grid.innerHTML = `<p style="color:var(--moss-600);font-size:.9rem;text-align:center;padding:1rem;grid-column:1/-1;">No matching images found.</p>`;
        return;
      }
      grid.innerHTML = items.map(img => {
        const file = img.fileUrls[0];
        const viewHref = buildViewHref(file, img);
        return `
        <a class="image-item" href="${viewHref}" style="text-decoration:none;">
          <div class="image-item-thumb">
            <img src="${encodeURI(file.url)}" alt="${esc(file.title || img.courseName)}" loading="lazy">
            <div class="status-badge">✓</div>
            <div class="view-overlay"><button type="button">View</button></div>
          </div>
          <div class="image-item-caption">
            <span class="image-item-code">${esc(img.courseCode)}</span>
            ${file.title ? `<span class="image-item-title">${esc(file.title)}</span>` : ""}
          </div>
        </a>`;
      }).join("");
    }
  });
}

// ============================================
// UPLOAD ANOTHER FILE (slides-notes.html)
// Same look-and-feel as the Hand Notes unlock upload above (file type
// picker, image titles, progress ring) instead of the plain PDF-only form.
// If the course code already exists, the course name and faculty name(s)
// are offered as suggestions — the student can still type a different
// faculty/section for the same course code.
// ============================================
const anotherUploadBtn = document.getElementById("open-another-upload");
const anotherUploadModal = document.getElementById("another-upload-modal");
if (anotherUploadBtn && anotherUploadModal) {
  prefillFromSession("au-uploaderEmail");
  const auClose = document.getElementById("another-upload-close");
  const auForm = document.getElementById("another-upload-form");
  const auCourseCode = document.getElementById("au-courseCode");
  const auCourseName = document.getElementById("au-courseName");
  const auCourseNameHint = document.getElementById("au-courseName-hint");
  const auFacultyName = document.getElementById("au-facultyName");
  const auFacultySuggestions = document.getElementById("au-faculty-suggestions");
  const auFiles = document.getElementById("au-files");
  const auFilesLabel = document.getElementById("au-files-label");
  const auSubmit = document.getElementById("au-submit");
  const auStatus = document.getElementById("au-status");
  const auProgressWrap = document.getElementById("au-progress-wrap");
  const auProgressBar = document.getElementById("au-progress-ring-bar");
  const auProgressText = document.getElementById("au-progress-ring-text");
  const auImageTitlesWrap = document.getElementById("au-image-titles-wrap");
  const auImageTitlesList = document.getElementById("au-image-titles-list");
  const auSuccess = document.getElementById("au-success");
  const AU_CIRCUMFERENCE = 226.19;
  let auFileType = "pdf";
  let auMatchedCourse = null;

  const auFileTypeAccepts = {
    pdf: ".pdf,application/pdf",
    image: "image/*,.jpg,.jpeg,.png,.gif,.webp",
    ppt: ".ppt,.pptx,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
  };

  function auResetForm() {
    auForm.reset();
    auForm.classList.remove("hidden");
    auSuccess.classList.add("hidden");
    auProgressWrap.classList.add("hidden");
    auStatus.textContent = "";
    auCourseNameHint.classList.add("hidden");
    auFacultySuggestions.innerHTML = "";
    auImageTitlesWrap.classList.add("hidden");
    auImageTitlesList.innerHTML = "";
    auMatchedCourse = null;
    auFileType = "pdf";
    auFiles.accept = auFileTypeAccepts.pdf;
    auFilesLabel.textContent = "PDF File(s) * (max 20 files, 50MB each)";
    const pdfRadio = document.querySelector('input[name="au-fileType"][value="pdf"]');
    if (pdfRadio) pdfRadio.checked = true;
    document.querySelectorAll('input[name="au-fileType"]').forEach(r => {
      r.closest("label").style.borderColor = r.checked ? "var(--leaf-500)" : "var(--line)";
      r.closest("label").style.background = r.checked ? "rgba(107, 155, 94, 0.05)" : "transparent";
    });
    auSubmit.disabled = false;
    auSubmit.textContent = "Submit for Review";
  }

  anotherUploadBtn.addEventListener("click", () => {
    auResetForm();
    anotherUploadModal.classList.remove("hidden");
  });
  if (auClose) auClose.addEventListener("click", () => anotherUploadModal.classList.add("hidden"));
  anotherUploadModal.addEventListener("click", (e) => { if (e.target === anotherUploadModal) anotherUploadModal.classList.add("hidden"); });

  // Suggest course name + faculty names once the course code matches an existing one.
  auCourseCode.addEventListener("blur", async () => {
    const code = auCourseCode.value.trim().toUpperCase();
    auFacultySuggestions.innerHTML = "";
    auCourseNameHint.classList.add("hidden");
    if (!code) { auMatchedCourse = null; return; }
    try {
      const courseSnap = await getDoc(doc(db, "courses", code));
      if (courseSnap.exists()) {
        auMatchedCourse = courseSnap.data();
        if (!auCourseName.value.trim()) auCourseName.value = auMatchedCourse.courseName;
        auCourseNameHint.innerHTML = `Suggested from an existing course: <strong>${esc(auMatchedCourse.courseName)}</strong> — edit if this is different.`;
        auCourseNameHint.classList.remove("hidden");
      } else {
        auMatchedCourse = null;
      }
      // Existing faculty names for this course code, offered as suggestions
      // (a datalist) — the student can still type any other faculty/section.
      const q = query(collection(db, "resources"), where("courseCode", "==", code));
      const snap = await getDocs(q);
      const faculties = [...new Set(snap.docs.map(d => d.data().facultyName).filter(Boolean))];
      auFacultySuggestions.innerHTML = faculties.map(f => `<option value="${esc(f)}"></option>`).join("");
    } catch (err) { console.error("[Another Upload] course lookup failed:", err); }
  });

  function auCleanFileNameAsTitle(name) {
    return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  }
  function renderAuImageTitleInputs() {
    if (auFileType !== "image" || !auFiles.files || auFiles.files.length === 0) {
      auImageTitlesWrap.classList.add("hidden");
      auImageTitlesList.innerHTML = "";
      return;
    }
    auImageTitlesList.innerHTML = Array.from(auFiles.files).map((f, i) => `
      <input type="text" class="au-image-title-input" data-index="${i}"
             placeholder="Title for: ${esc(f.name)}" value="${esc(auCleanFileNameAsTitle(f.name))}"
             style="width:100%;padding:.5rem .7rem;border:1px solid var(--line);border-radius:6px;font-size:.85rem;">
    `).join("");
    auImageTitlesWrap.classList.remove("hidden");
  }
  auFiles.addEventListener("change", renderAuImageTitleInputs);

  document.querySelectorAll('input[name="au-fileType"]').forEach(radio => {
    radio.addEventListener("change", () => {
      auFileType = radio.value;
      auFiles.accept = auFileTypeAccepts[auFileType];
      const labels = {
        pdf: "PDF File(s) * (max 20 files, 50MB each)",
        image: "Image File(s) * (JPG, PNG, GIF, WebP — max 20 files, 50MB each)",
        ppt: "Presentation File(s) * (PPT/PPTX — max 20 files, 50MB each)"
      };
      auFilesLabel.textContent = labels[auFileType];
      document.querySelectorAll('input[name="au-fileType"]').forEach(r => {
        r.closest("label").style.borderColor = r.checked ? "var(--leaf-500)" : "var(--line)";
        r.closest("label").style.background = r.checked ? "rgba(107, 155, 94, 0.05)" : "transparent";
      });
      renderAuImageTitleInputs();
    });
  });

  function auSetProgress(pct) {
    auProgressBar.style.strokeDashoffset = AU_CIRCUMFERENCE - (pct / 100) * AU_CIRCUMFERENCE;
    auProgressText.textContent = pct + "%";
  }
  function auShowStatus(msg, isError = false) {
    auProgressWrap.classList.remove("hidden");
    auStatus.textContent = msg;
    auStatus.style.color = isError ? "var(--terracotta-500)" : "var(--moss-600)";
  }

  auForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const courseCode = auCourseCode.value.trim().toUpperCase();
    const rawCourseName = auCourseName.value.trim();
    const facultyName = auFacultyName.value.trim();
    const uploaderEmail = normalizeEmail(document.getElementById("au-uploaderEmail").value);
    const files = Array.from(auFiles.files);

    if (files.length === 0) { auShowStatus(`Please choose at least one ${auFileType.toUpperCase()} file.`, true); return; }
    if (files.length > MAX_FILES) { auShowStatus(`Maximum ${MAX_FILES} files allowed.`, true); return; }
    const oversized = files.find(f => f.size > MAX_SIZE);
    if (oversized) { auShowStatus(`"${oversized.name}" is over 50MB.`, true); return; }

    let validationError = false;
    if (auFileType === "pdf") validationError = files.some(f => !f.name.toLowerCase().endsWith(".pdf"));
    else if (auFileType === "image") validationError = files.some(f => !["jpg","jpeg","png","gif","webp"].includes(f.name.toLowerCase().split(".").pop()));
    else if (auFileType === "ppt") validationError = files.some(f => !["ppt","pptx"].includes(f.name.toLowerCase().split(".").pop()));
    if (validationError) { auShowStatus(`Some files are not valid ${auFileType.toUpperCase()} files.`, true); return; }

    auSubmit.disabled = true;
    auSubmit.textContent = "Uploading…";
    auSetProgress(0);
    auShowStatus(`Uploading ${files.length} file(s)…`);

    try {
      const progressByFile = new Array(files.length).fill(0);
      const updateOverall = () => {
        const avg = Math.round(progressByFile.reduce((a, b) => a + b, 0) / files.length);
        auSetProgress(avg);
        auShowStatus(avg >= 100 ? "Processing on server…" : `Uploading ${files.length} file(s)…`);
      };
      const fileUrls = await Promise.all(
        files.map((file, i) => uploadFileToCloudinary(file, (pct) => { progressByFile[i] = pct; updateOverall(); }))
      );

      if (auFileType === "image") {
        const titleInputs = auImageTitlesList.querySelectorAll(".au-image-title-input");
        fileUrls.forEach((f, i) => {
          const t = titleInputs[i] ? titleInputs[i].value.trim() : "";
          f.title = t || auCleanFileNameAsTitle(f.name);
        });
      }

      auShowStatus("Saving details…");
      auSetProgress(100);

      const finalCourseName = rawCourseName || (auMatchedCourse ? auMatchedCourse.courseName : "");
      const courseSnap = await getDoc(doc(db, "courses", courseCode));
      if (!courseSnap.exists()) {
        await setDoc(doc(db, "courses", courseCode), { courseCode, courseName: finalCourseName });
      }

      const auDocData = {
        courseCode, courseName: finalCourseName, facultyName,
        resourceType: "slides_notes", uploaderEmail, fileUrls, fileType: auFileType,
        status: "pending", submittedAt: serverTimestamp()
      };
      const auUploaderStudentId = await lookupStudentIdByEmail(uploaderEmail);
      if (auUploaderStudentId) auDocData.uploaderStudentId = auUploaderStudentId;
      await addDoc(collection(db, "resources"), auDocData);

      auForm.classList.add("hidden");
      auProgressWrap.classList.add("hidden");
      auSuccess.classList.remove("hidden");
      auMatchedCourse = null;

      // Refresh whatever's currently on screen (three-card lists, status bar).
      (window.__onResourceAccessGranted || []).forEach(fn => fn());
    } catch (err) {
      console.error("[Another Upload] failed:", err);
      let userMessage = "Something went wrong. Please try again.";
      if (err.code === "permission-denied") userMessage = "Upload was rejected. Please check the details and try again.";
      else if (/network/i.test(err.message || "")) userMessage = "Network error. Check your connection and try again.";
      else if (/timed out/i.test(err.message || "")) userMessage = "Upload took too long. Try again with a smaller file.";
      auShowStatus(userMessage, true);
      auSubmit.disabled = false;
      auSubmit.textContent = "Submit for Review";
    }
  });
}

// ============================================
// SUGGESTIONS BROWSING (previous-questions.html)
// ============================================
const pqList = document.getElementById("pq-list");
const pqSearchBtn = document.getElementById("pq-search-btn");

// Guard: only run on previous-questions.html
if (pqList) {
  async function loadPQ() {
    const facultyFilter = document.getElementById("pq-faculty")?.value.trim() || "";
    const courseFilter = (document.getElementById("pq-course")?.value.trim() || "").toUpperCase();
    const examFilter = document.getElementById("pq-exam")?.value || "";

    try {
      // Two equality filters — still no composite index required.
      // status must be filtered in the query itself (see loadSlides note above).
      const q = query(
        collection(db, "resources"),
        where("resourceType", "==", "previous_questions"),
        where("status", "==", "approved")
      );
      const snap = await getDocs(q);
      let items = snap.docs.map(d => ({ id: d.id, ...d.data() }));

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
            ${item.fileUrls.map(f => `<a href="${buildViewHref(f, item)}" class="view-link">View Question</a>`).join("<br>")}
          </div>
        </div>`).join("");
    } catch (err) {
      console.error("[PQ] loadPQ failed:", err);
      pqList.innerHTML = `<p style="color:var(--terracotta-500);font-family:var(--font-mono);font-size:.85rem;">Could not load questions. Please refresh and try again.</p>`;
    }
  }

  if (pqSearchBtn) pqSearchBtn.addEventListener("click", loadPQ);

  // Deep link support: previous-questions.html?course=CODE (from homepage
  // search) — pre-fills the course filter for once access is granted.
  const pqCourseParam = new URLSearchParams(location.search).get("course");
  const pqCourseInput = document.getElementById("pq-course");
  if (pqCourseParam && pqCourseInput) pqCourseInput.value = pqCourseParam.toUpperCase();

  // Runs once access is granted (see shared access gate above)
  window.__onResourceAccessGranted = window.__onResourceAccessGranted || [];
  window.__onResourceAccessGranted.push(loadPQ);
}
