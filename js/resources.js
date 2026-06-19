import { db, CLOUDINARY_UPLOAD_URL, CLOUDINARY_UPLOAD_PRESET } from "./firebase-config.js";
import {
  collection, addDoc, serverTimestamp, query, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const MAX_FILES = 5;
const MAX_SIZE = 20 * 1024 * 1024; // 20MB

async function uploadFileToCloudinary(file) {
  const data = new FormData();
  data.append("file", file);
  data.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  const res = await fetch(CLOUDINARY_UPLOAD_URL, { method: "POST", body: data });
  if (!res.ok) throw new Error("Upload failed for " + file.name);
  const json = await res.json();
  return { url: json.secure_url, name: file.name };
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

  resourceTypeSelect.addEventListener("change", () => {
    examTypeWrap.classList.toggle("hidden", resourceTypeSelect.value !== "previous_questions");
  });

  function showStatus(msg, isError = false) {
    statusBox.textContent = msg;
    statusBox.style.color = isError ? "var(--terracotta-500)" : "var(--moss-600)";
    statusBox.classList.remove("hidden");
  }

  uploadForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const courseCode = document.getElementById("courseCode").value.trim().toUpperCase();
    const courseName = document.getElementById("courseName").value.trim();
    const facultyName = document.getElementById("facultyName").value.trim();
    const resourceType = resourceTypeSelect.value;
    const examType = document.getElementById("examType").value;
    const uploaderName = document.getElementById("uploaderName").value.trim();
    const uploaderEmail = document.getElementById("uploaderEmail").value.trim();
    const files = Array.from(fileInput.files);

    if (files.length === 0) {
      showStatus("Please choose at least one file.", true);
      return;
    }
    if (files.length > MAX_FILES) {
      showStatus(`Maximum ${MAX_FILES} files allowed.`, true);
      return;
    }
    const oversized = files.find(f => f.size > MAX_SIZE);
    if (oversized) {
      showStatus(`"${oversized.name}" is over 20MB. Please reduce file size.`, true);
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Uploading…";
    showStatus(`Uploading ${files.length} file(s)…`);

    try {
      const fileUrls = [];
      for (const file of files) {
        const uploaded = await uploadFileToCloudinary(file);
        fileUrls.push(uploaded);
      }

      const docData = {
        courseCode,
        courseName,
        facultyName,
        resourceType,
        uploaderEmail,
        fileUrls,
        status: "pending",
        submittedAt: serverTimestamp()
      };
      if (uploaderName) docData.uploaderName = uploaderName;
      if (resourceType === "previous_questions" && examType) docData.examType = examType;

      await addDoc(collection(db, "resources"), docData);

      uploadForm.classList.add("hidden");
      statusBox.classList.add("hidden");
      successBox.classList.remove("hidden");
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
    courseButtonsWrap.innerHTML = codes.map(code =>
      `<button class="course-btn" data-code="${code}">${code}</button>`
    ).join("");
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
            ${item.fileUrls.map(f => `<a href="${f.url}" target="_blank" rel="noopener" class="view-link">View: ${f.name}</a>`).join("")}
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
// PREVIOUS QUESTIONS BROWSING (previous-questions.html)
// ============================================
const pqList = document.getElementById("pq-list");
const pqSearchBtn = document.getElementById("pq-search-btn");

if (pqList) {
  async function loadPQ() {
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
        <span class="tag">${item.examType || "Question"}</span>
        <h3>${item.courseCode}</h3>
        <p style="font-size:.85rem;color:var(--moss-600);margin-bottom:.7rem;">${item.facultyName || ""}</p>
        ${item.fileUrls.map(f => `<a href="${f.url}" target="_blank" rel="noopener" class="view-link">View Question</a>`).join("<br>")}
      </div>
    `).join("");
  }

  pqSearchBtn.addEventListener("click", loadPQ);
  loadPQ();
}
