import { db, CLOUDINARY_UPLOAD_URL, CLOUDINARY_UPLOAD_PRESET } from "./firebase-config.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const form = document.getElementById("register-form");
const submitBtn = document.getElementById("submit-btn");
const statusBox = document.getElementById("form-status");
const successBox = document.getElementById("form-success");
const progressWrap = document.getElementById("upload-progress-wrap");
const progressBar = document.getElementById("progress-ring-bar");
const progressText = document.getElementById("progress-ring-text");
const CIRCUMFERENCE = 226.19; // 2 * π * r(36)

function setProgress(pct) {
  const offset = CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE;
  progressBar.style.strokeDashoffset = offset;
  progressText.textContent = pct + "%";
}

function showStatus(message, isError = false) {
  progressWrap.classList.remove("hidden");
  statusBox.textContent = message;
  statusBox.style.color = isError ? "var(--terracotta-500)" : "var(--moss-600)";
  if (isError) progressWrap.classList.add("hidden");
}

function uploadToCloudinary(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", CLOUDINARY_UPLOAD_URL, true);

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const json = JSON.parse(xhr.responseText);
        resolve(json.secure_url);
      } else {
        reject(new Error("Cloudinary upload failed"));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));

    const data = new FormData();
    data.append("file", file);
    data.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    xhr.send(data);
  });
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const fullName = document.getElementById("fullName").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const whatsapp = document.getElementById("whatsapp").value.trim();
  const email = document.getElementById("email").value.trim();
  const institution = document.getElementById("institution").value.trim();
  const studentIdNumber = document.getElementById("studentIdNumber").value.trim();
  const idFile = document.getElementById("studentIdPhoto").files[0];

  // Validation: at least one of photo or number required
  if (!studentIdNumber && !idFile) {
    showStatus("Please provide either a Student ID photo or a Student ID number (at least one is required).", true);
    return;
  }

  // File size check (5MB max for ID photo)
  if (idFile && idFile.size > 5 * 1024 * 1024) {
    showStatus("Student ID photo must be under 5MB.", true);
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Submitting…";
  setProgress(0);

  try {
    let studentIdUrl = null;
    if (idFile) {
      showStatus("Uploading Student ID photo…");
      studentIdUrl = await uploadToCloudinary(idFile, (pct) => {
        setProgress(pct);
      });
    }
    setProgress(100);
    showStatus("Saving your registration…");

    const docData = {
      fullName,
      phone,
      whatsapp,
      email,
      institution,
      status: "unverified",
      submittedAt: serverTimestamp()
    };
    if (studentIdUrl) docData.studentIdUrl = studentIdUrl;
    if (studentIdNumber) docData.studentIdNumber = studentIdNumber;

    await addDoc(collection(db, "registrations"), docData);

    form.classList.add("hidden");
    statusBox.classList.add("hidden");
    successBox.classList.remove("hidden");
  } catch (err) {
    console.error(err);
    showStatus("Something went wrong. Please try again. (" + err.message + ")", true);
    submitBtn.disabled = false;
    submitBtn.textContent = "Register";
  }
});
