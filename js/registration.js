import { db, CLOUDINARY_UPLOAD_URL, CLOUDINARY_UPLOAD_PRESET } from "./firebase-config.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const form = document.getElementById("register-form");
const submitBtn = document.getElementById("submit-btn");
const statusBox = document.getElementById("form-status");
const successBox = document.getElementById("form-success");

function showStatus(message, isError = false) {
  statusBox.textContent = message;
  statusBox.style.color = isError ? "var(--terracotta-500)" : "var(--moss-600)";
  statusBox.classList.remove("hidden");
}

async function uploadToCloudinary(file) {
  const data = new FormData();
  data.append("file", file);
  data.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  const res = await fetch(CLOUDINARY_UPLOAD_URL, { method: "POST", body: data });
  if (!res.ok) throw new Error("Cloudinary upload failed");
  const json = await res.json();
  return json.secure_url;
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
  showStatus("Submitting your registration…");

  try {
    let studentIdUrl = null;
    if (idFile) {
      studentIdUrl = await uploadToCloudinary(idFile);
    }

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
