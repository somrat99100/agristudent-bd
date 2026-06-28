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
        reject(new Error(`Upload failed for ${file.name} (server said: ${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error uploading " + file.name + ". Check your connection and try again."));
    xhr.ontimeout = () => reject(new Error(file.name + " took too long to upload. Try again, or check your connection."));

    const data = new FormData();
    data.append("file", file);
    data.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    xhr.send(data);
  });
}

// ============================================
// UPLOAD FORM MODAL (resources.html)
// ============================================
const openUploadBtn = document.getElementById("open-upload-form");
const uploadModal = document.getElementById("upload-form-modal");
const uploadModalClose = document.getElementById("upload-form-close");

function openUploadModal() {
  if (uploadModal) uploadModal.classList.remove("hidden");
}
function closeUploadModal() {
  if (uploadModal) uploadModal.classList.add("hidden");
}
if (openUploadBtn) openUploadBtn.addEventListener("click", openUploadModal);
if (uploadModalClose) uploadModalClose.addEventListener("click", closeUploadModal);
if (uploadModal) {
  uploadModal.addEventListener("click", (e) => {
    if (e.target === uploadModal) closeUploadModal();
  });
}
if (uploadModal && window.location.hash === "#upload") {
  openUploadModal();
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

  let matchedCourse = null;

  // Canonical course checking logic
  courseCodeInput.addEventListener("blur", async () => {
    const code = courseCodeInput.value.trim().toUpperCase();
    if (!code) {
      matchedCourse = null;
      courseNameInput.readOnly = false;
      courseNameInput.value = "";
      return;
    }
    try {
      const courseSnap = await getDoc(doc(db, "courses", code));
      if (courseSnap.exists()) {
        matchedCourse = courseSnap.data();
        courseNameInput.value = matchedCourse.courseName;
        courseNameInput.readOnly = true;
        facultyNameInput.readOnly = false; // Faculty is strictly open
      } else {
        matchedCourse = null;
        courseNameInput.readOnly = false;
      }
    } catch (err) {
      console.error("Error checking canonical course:", err);
    }
  });

  resourceTypeSelect.addEventListener("change", () => {
    examTypeWrap.classList.toggle("hidden", resourceTypeSelect.value !== "previous_questions");
  });

  const progressWrap = document.getElementById("upload-progress-wrap");
  const progressBar = document.getElementById("progress-ring-bar");
  const progressText = document.getElementById("progress-ring-text");
  const CIRCUMFERENCE = 226.19; 

  function setProgress(pct) {
    const offset = CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE;
    progressBar.style.strokeDashoffset = offset;
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

    if (files.length === 0) {
      showError("Please choose at least one file.");
      return;
    }
    if (files.length > MAX_FILES) {
      showError(`Maximum ${MAX_FILES} files allowed.`);
      return;
    }
    const nonPdf = files.find(f => !f.name.toLowerCase().endsWith(".pdf") || (f.type && f.type !== "application/pdf"));
    if (nonPdf) {
      showError(`"${nonPdf.name}" is not a PDF. Only PDF files are accepted.`);
      return;
    }
    const oversized = files.find(f => f.size > MAX_SIZE);
    if (oversized) {
      showError(`"${oversized.name}" is over 50MB. Please reduce file size.`);
      return;
    }

    // Assign canonical overrides
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
        if (avg >= 100) {
          showStatus("Upload sent — processing on server, please wait…");
        } else {
          showStatus(`Uploading ${files.length} file(s) in parallel…`);
        }
      };

      const fileUrls = await Promise.all(
        files.map((file, i) =>
          uploadFileToCloudinary(file, (pct) => {
            progressByFile[i] = pct;
            updateOverall();
          })
        )
      );

      showStatus("Saving details…");
      setProgress(100);

      // Create new canonical course if it doesn't exist, strictly dropping facultyName
      if (!matchedCourse) {
        await setDoc(doc(db, "courses", finalCourseCode), {
          courseCode: finalCourseCode,
          courseName: finalCourseName
        });
      }

      // Write resource payload
      const docData = {
        courseCode: finalCourseCode,
        courseName: finalCourseName,
        facultyName: facultyName, // Never overridden
        resourceType,
        uploaderEmail,
        fileUrls,
        status: "pending",
        submittedAt: serverTimestamp()
      };
      if (uploaderName) docData.uploaderName = uploaderName;
      if (resourceType === "previous_questions" && examType) docData.examType = examType;

      await addDoc(collection(db, "resources"), docData);

      uploadForm.reset();
      uploadForm.classList.add("hidden");
      statusBox.classList.add("hidden");
      successBox.classList.remove("hidden");
      
      // Reset state 
      matchedCourse = null;
      courseNameInput.readOnly = false;
      
    } catch (err) {
      console.error(err);
      showStatus("Something went wrong: " + err.message, true);
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit for Review";
    }
  });
}

// ============================================
// SLIDES & NOTES BROWSING (slides-notes.html)
// ============================================
const courseButtonsWrap = document.getElementById("course-buttons");
const slidesList = document.getElementById("slides-list");
const slidesSearchInput = document.getElementById("slides-search");

if (courseButtonsWrap) {
  let allSlides = [];

  async function loadSlides() {
    const q = query(
      collection(db, "resources"),
      where("status", "==", "approved"),
      where("resourceType", "==", "slides_notes")
    );
    const snap = await getDocs(q);
    allSlides = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCourseButtons(allSlides);
  }

  function renderCourseButtons(items) {
    const codes = [...new Set(items.map(i => i.courseCode))].sort();
    if (codes.length === 0) {
      courseButtonsWrap.innerHTML = `<p style="color:var(--moss-600);font-family:var(--font-mono);font-size:.85rem;">No approved course materials yet — check back soon.</p>`;
      return;
    }
    courseButtonsWrap.innerHTML = codes.map(code => {
      const faculty = [...new Set(
        items.filter(i => i.courseCode === code).map(i => i.facultyName).filter(Boolean)
      )].join(", ");
      return `
        <button class="course-btn" data-code="${code}">
          ${code}
          ${faculty ? `<div style="font-size:.7rem;font-weight:400;color:inherit;opacity:.75;margin-top:.2rem;">${faculty}</div>` : ""}
        </button>
      `;
    }).join("");
    courseButtonsWrap.querySelectorAll(".course-btn").forEach(btn => {
      btn.addEventListener("click", () => renderResourceList(btn.dataset.code));
    });
  }

  function renderResourceList(code) {
    const items = allSlides.filter(i => i.courseCode === code);
    slidesList.classList.remove("hidden");
    slidesList.innerHTML = `<h3 style="margin-bottom:1rem;">${code} — Lecture Materials</h3>` +
      items.map(item => `
        <div class="resource-row">
          <div>
            <strong>${item.courseName || code}</strong>
            <div style="font-size:.8rem;color:var(--moss-600);">${item.fileUrls.length} file(s)</div>
          </div>
          <div class="resource-row-files">
            ${item.fileUrls.map(f => `<a href="view.html?url=${encodeURIComponent(f.url)}&name=${encodeURIComponent(f.name)}" class="view-link">View: ${f.name}</a>`).join("")}
          </div>
        </div>
      `).join("");
  }

  slidesSearchInput.addEventListener("input", () => {
    const term = slidesSearchInput.value.trim().toUpperCase();
    const filtered = term ? allSlides.filter(i => i.courseCode.includes(term)) : allSlides;
    renderCourseButtons(filtered);
    slidesList.classList.add("hidden");
  });

  loadSlides();
}

// ============================================
// SUGGESTIONS ACCESS GATE (previous-questions.html)
// ============================================
const pqList = document.getElementById("pq-list");
const pqSearchBtn = document.getElementById("pq-search-btn");
const pqGate = document.getElementById("pq-gate");
const pqContent = document.getElementById("pq-content");
let loadPQ; 

if (pqList && pqGate && pqContent) {
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
    loadPQ();
  }

  // CVE-8 FIX: Never use sessionStorage to grant access.
  // Always re-verify against Firestore on every page load.
  // sessionStorage can be set by anyone in one line: sessionStorage.setItem("pq_access","granted")
  // Real access control lives in Firestore Security Rules.
  gateSubmit.addEventListener("click", async () => {
      const studentId = gateInput.value.trim();
      if (!studentId) {
        showGateStatus("Please enter your Student ID.", "is-unknown");
        return;
      }

      gateSubmit.disabled = true;
      gateSubmit.textContent = "Checking…";
      showGateStatus("Checking your registration…", "is-unknown");

      try {
        const q = query(collection(db, "registrations"), where("studentIdNumber", "==", studentId));
        const snap = await getDocs(q);

        if (snap.empty) {
          showGateStatus(
            `❌ NOT REGISTERED<div class="access-status-note">We couldn't find that Student ID. Please register first with the correct information.</div>`,
            "is-rejected"
          );
        } else {
          const reg = snap.docs[0].data();
          const status = reg.status || "unverified";

          if (status === "verified") {
            showGateStatus("✅ ACCESS GRANTED", "is-granted");
            setTimeout(grantAccess, 700);
          } else if (status === "rejected") {
            showGateStatus(
              `❌ REJECTED<div class="access-status-note">Your registration was rejected. Please register again with correct information.</div>`,
              "is-rejected"
            );
          } else {
            showGateStatus(
              `⏳ PENDING APPROVAL<div class="access-status-note">Your registration is awaiting admin review. Please wait for approval and check back later.</div>`,
              "is-pending"
            );
          }
        }
      } catch (err) {
        console.error(err);
        showGateStatus("Something went wrong. Please try again.", "is-unknown");
      } finally {
        gateSubmit.disabled = false;
        gateSubmit.textContent = "Check Access";
      }
    });
}
}

// ============================================
// PREVIOUS QUESTIONS BROWSING (previous-questions.html)
// ============================================
if (pqList) {
  loadPQ = async function loadPQ() {
    const facultyFilter = document.getElementById("pq-faculty").value.trim();
    const courseFilter = document.getElementById("pq-course").value.trim().toUpperCase();
    const examFilter = document.getElementById("pq-exam").value;

    let q = query(
      collection(db, "resources"),
      where("status", "==", "approved"),
      where("resourceType", "==", "previous_questions")
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
        <div class="tag-strip"><span class="tag-dot"></span><span class="tag">${item.examType || "Question"}</span></div>
        <div class="card-body">
          <h3>${item.courseCode}</h3>
          <p style="font-size:.85rem;color:var(--moss-600);margin-bottom:.7rem;">${item.facultyName || ""}</p>
          ${item.fileUrls.map(f => `<a href="view.html?url=${encodeURIComponent(f.url)}&name=${encodeURIComponent(f.name)}" class="view-link">View Question</a>`).join("<br>")}
        </div>
      </div>
    `).join("");
  }

  pqSearchBtn.addEventListener("click", loadPQ);
  if (!pqGate) loadPQ();
}
