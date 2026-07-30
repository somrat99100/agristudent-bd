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
// SHARED RESOURCES ACCESS GATE
// (resources.html, slides-notes.html, previous-questions.html)
// ============================================
// One Student-ID check unlocks All Slides & Suggestions together for the
// rest of the browser session. The student ID (not a plain "verified" flag)
// is cached in sessionStorage purely for convenience — every page load still
// re-checks the student's live status in Firestore before granting access,
// so a rejected/removed registration loses access immediately.
const resourceGate = document.getElementById("resource-gate");
const resourceContent = document.getElementById("resource-content");

if (resourceGate && resourceContent) {
  const gateInput = document.getElementById("resource-gate-input");
  const gateSubmit = document.getElementById("resource-gate-submit");
  const gateStatus = document.getElementById("resource-gate-status");
  const STORAGE_KEY = "agri_student_id";

  function showGateStatus(html, stateClass) {
    gateStatus.innerHTML = html;
    gateStatus.className = "access-status " + stateClass;
    gateStatus.classList.remove("hidden");
  }

  function grantAccess() {
    resourceGate.classList.add("hidden");
    resourceContent.classList.remove("hidden");
    (window.__onResourceAccessGranted || []).forEach(fn => fn());
  }

  async function checkAccess(studentId, { silent } = {}) {
    if (!silent) {
      gateSubmit.disabled = true;
      gateSubmit.textContent = "Checking…";
      showGateStatus("Checking your registration…", "is-unknown");
    }
    try {
      const q = query(collection(db, "registrations"), where("studentIdNumber", "==", studentId));
      const snap = await getDocs(q);
      if (snap.empty) {
        sessionStorage.removeItem(STORAGE_KEY);
        if (!silent) showGateStatus(`❌ NOT REGISTERED<div class="access-status-note">We couldn't find that Student ID. Please register first.</div>`, "is-rejected");
        return;
      }
      const reg = snap.docs[0].data();
      const status = reg.status || "unverified";
      if (status === "verified") {
        sessionStorage.setItem(STORAGE_KEY, studentId);
        if (!silent) {
          showGateStatus("✅ ACCESS GRANTED", "is-granted");
          setTimeout(grantAccess, 700);
        } else {
          grantAccess();
        }
      } else {
        sessionStorage.removeItem(STORAGE_KEY);
        if (!silent) {
          if (status === "rejected") {
            showGateStatus(`❌ REJECTED<div class="access-status-note">Your registration was rejected. Please register again.</div>`, "is-rejected");
          } else {
            showGateStatus(`⏳ PENDING APPROVAL<div class="access-status-note">Your registration is awaiting admin review. Please check back later.</div>`, "is-pending");
          }
        }
      }
    } catch (err) {
      console.error("[Resource Gate] check failed:", err);
      if (!silent) showGateStatus("Something went wrong. Please try again.", "is-unknown");
    } finally {
      if (!silent) {
        gateSubmit.disabled = false;
        gateSubmit.textContent = "Check Access";
      }
    }
  }

  if (gateSubmit) {
    gateSubmit.addEventListener("click", () => {
      const studentId = gateInput.value.trim();
      if (!studentId) { showGateStatus("Please enter your Student ID.", "is-unknown"); return; }
      checkAccess(studentId);
    });
  }

  // Silently re-verify a previously-entered Student ID from this session,
  // rather than asking the student to type it again on every page.
  const cachedId = sessionStorage.getItem(STORAGE_KEY);
  if (cachedId) {
    gateInput.value = cachedId;
    checkAccess(cachedId, { silent: true });
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
    localStorage.setItem(HN_STORAGE_KEY, userEmail);
    handNotesGate.classList.add("hidden");
    handNotesContent.classList.remove("hidden");
    hnCheckAndDisplayStatus(userEmail);
    (window.__onResourceAccessGranted || []).forEach(fn => fn());
  }

  async function hnCheckAndDisplayStatus(userEmail) {
    if (!accessStatusBar) return;
    try {
      const q = query(
        collection(db, "resources"),
        where("uploaderEmail", "==", userEmail),
        where("resourceType", "==", "slides_notes")
      );
      const snap = await getDocs(q);
      
      if (snap.empty) {
        accessStatusBar.classList.add("hidden");
        return;
      }

      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const latest = docs.sort((a, b) => (b.submittedAt?.toDate() || 0) - (a.submittedAt?.toDate() || 0))[0];

      accessStatusBar.classList.remove("hidden");
      accessStatusBar.classList.remove("approved", "pending", "rejected");

      if (latest.status === "approved") {
        accessStatusBar.classList.add("approved");
        const submittedDate = latest.submittedAt?.toDate?.()?.toLocaleDateString?.() || "recently";
        accessStatusBar.querySelector(".status-content").innerHTML = `
          <strong>✅ APPROVED — Full Access</strong>
          <div class="file-info">Your file: "${esc(latest.fileUrls[0]?.name || 'Document')}"<br>Approved on ${submittedDate}</div>
        `;
      } else if (latest.status === "pending") {
        accessStatusBar.classList.add("pending");
        const submittedDate = latest.submittedAt?.toDate?.()?.toLocaleDateString?.() || "today";
        accessStatusBar.querySelector(".status-content").innerHTML = `
          <strong>⏳ PENDING — Temporary Access (48 hours)</strong>
          <div class="file-info">Your file: "${esc(latest.fileUrls[0]?.name || 'Document')}"<br>Uploaded on ${submittedDate}<br>Still waiting for admin review...</div>
        `;
      } else if (latest.status === "rejected") {
        accessStatusBar.classList.add("rejected");
        handNotesGate.classList.remove("hidden");
        handNotesContent.classList.add("hidden");
        accessStatusBar.querySelector(".status-content").innerHTML = `
          <strong>❌ ACCESS EXPIRED — File Rejected</strong>
          <div class="file-info">Your file: "${esc(latest.fileUrls[0]?.name || 'Document')}"</div>
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

  // Check if user already has access (from previous upload)
  const cachedEmail = localStorage.getItem(HN_STORAGE_KEY);
  if (cachedEmail) {
    // Verify current status
    const q = query(
      collection(db, "resources"),
      where("uploaderEmail", "==", cachedEmail),
      where("resourceType", "==", "slides_notes")
    );
    getDocs(q).then(snap => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (!docs.empty) {
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
      const uploaderEmail = document.getElementById("hn-uploaderEmail").value.trim();
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

        await addDoc(collection(db, "resources"), {
          courseCode, courseName: finalCourseName, facultyName,
          resourceType: "slides_notes", uploaderEmail, fileUrls, fileType: currentFileType,
          status: "pending", submittedAt: serverTimestamp()
        });

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
const imageGrid = document.getElementById("image-grid");
const pptList = document.getElementById("ppt-list");
const imageSearch = document.getElementById("image-search");

if (pdfList || imageGrid || pptList) {
  let allSlides = [];
  let allImages = [];
  let allPpts = [];

  async function loadThreeCardLayout() {
    try {
      const q = query(
        collection(db, "resources"),
        where("resourceType", "==", "slides_notes"),
        where("status", "==", "approved")
      );
      const snap = await getDocs(q);
      const resources = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      // Separate by file type
      allSlides = resources.filter(r => r.fileType === "pdf" || !r.fileType); // Default to PDF for backward compatibility
      allImages = resources.filter(r => r.fileType === "image");
      allPpts = resources.filter(r => r.fileType === "ppt");

      renderPdfCard();
      renderImageCard();
      renderPptCard();
    } catch (err) {
      console.error("[Three Card Layout] load failed:", err);
    }
  }

  function renderPdfCard() {
    const pdfCount = allSlides.length;
    document.getElementById("pdf-count").textContent = `(${pdfCount})`;

    if (pdfCount === 0) {
      pdfList.innerHTML = `<p style="color:var(--moss-600);font-size:.9rem;text-align:center;padding:1rem;">No PDF files yet.</p>`;
      document.getElementById("pdf-view-all").style.display = "none";
      return;
    }

    const displayCount = Math.min(5, pdfCount);
    const displayed = allSlides.slice(0, displayCount);

    pdfList.innerHTML = displayed.map(item => `
      <div class="file-item">
        <span class="file-status">✓</span>
        <span class="file-name">${esc(item.courseCode)}: ${esc(item.courseName)}</span>
        <a href="view.html?url=${encodeURIComponent(item.fileUrls[0].url)}&name=${encodeURIComponent(item.fileUrls[0].name)}" class="file-action">View</a>
      </div>
    `).join("");

    document.getElementById("pdf-view-all").style.display = pdfCount > displayCount ? "block" : "none";
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
      const viewHref = `view.html?url=${encodeURIComponent(file.url)}&name=${encodeURIComponent(file.name)}`
        + `&code=${encodeURIComponent(img.courseCode || "")}&title=${encodeURIComponent(file.title || "")}`;
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

  function renderPptCard() {
    const pptCount = allPpts.length;
    document.getElementById("ppt-count").textContent = `(${pptCount})`;

    if (pptCount === 0) {
      pptList.innerHTML = `<p style="color:var(--moss-600);font-size:.9rem;text-align:center;padding:1rem;">No presentations yet.</p>`;
      document.getElementById("ppt-view-all").style.display = "none";
      return;
    }

    const displayCount = Math.min(5, pptCount);
    const displayed = allPpts.slice(0, displayCount);

    pptList.innerHTML = displayed.map(item => `
      <div class="file-item">
        <span class="file-status">✓</span>
        <span class="file-name">${esc(item.courseCode)}: ${esc(item.courseName)}</span>
        <a href="view.html?url=${encodeURIComponent(item.fileUrls[0].url)}&name=${encodeURIComponent(item.fileUrls[0].name)}" class="file-action">View</a>
      </div>
    `).join("");

    document.getElementById("ppt-view-all").style.display = pptCount > displayCount ? "block" : "none";
  }

  window.__onResourceAccessGranted = window.__onResourceAccessGranted || [];
  window.__onResourceAccessGranted.push(loadThreeCardLayout);
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
            ${item.fileUrls.map(f => `<a href="view.html?url=${encodeURIComponent(f.url)}&name=${encodeURIComponent(f.name)}" class="view-link">View Question</a>`).join("<br>")}
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
