import { db } from "./firebase-config.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const form = document.getElementById("help-form");
const submitBtn = document.getElementById("help-submit");
const statusBox = document.getElementById("help-status");
const successBox = document.getElementById("help-success");

function showStatus(msg, isError = false) {
  statusBox.textContent = msg;
  statusBox.style.color = isError ? "var(--terracotta-500)" : "var(--moss-600)";
  statusBox.classList.remove("hidden");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("help-name").value.trim();
  const email = document.getElementById("help-email").value.trim();
  const message = document.getElementById("help-message").value.trim();

  submitBtn.disabled = true;
  submitBtn.textContent = "Sending…";
  showStatus("Sending your message…");

  try {
    await addDoc(collection(db, "messages"), {
      name, email, message,
      submittedAt: serverTimestamp(),
      read: false
    });
    form.classList.add("hidden");
    statusBox.classList.add("hidden");
    successBox.classList.remove("hidden");
  } catch (err) {
    console.error(err);
    showStatus("Something went wrong: " + err.message, true);
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit";
  }
});
