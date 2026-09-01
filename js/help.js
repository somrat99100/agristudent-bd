import { db } from "./firebase-config.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getSession } from "./session.js";

const form = document.getElementById("help-form");
const nameInput = document.getElementById("help-name");
const emailInput = document.getElementById("help-email");
const submitBtn = document.getElementById("help-submit");
const statusBox = document.getElementById("help-status");
const successBox = document.getElementById("help-success");

// Auto-fill user information if logged in
function autofillUserInfo() {
  const session = getSession();
  if (session) {
    if (session.displayName) {
      nameInput.value = session.displayName;
    }
    if (session.email) {
      emailInput.value = session.email;
    }
  }
}

// Load user info when page loads
window.addEventListener("load", autofillUserInfo);

function showStatus(msg, isError = false) {
  statusBox.textContent = msg;
  statusBox.style.color = isError ? "var(--terracotta-500)" : "var(--moss-600)";
  statusBox.classList.remove("hidden");
}

// Help messages are stored in Firestore. A trusted Cloud Function sends the
// optional admin notification server-side, so no EmailJS credentials or SDK
// are exposed to the browser.
async function sendHelpMessage(name, email, message) {
  await addDoc(collection(db, "messages"), {
    name, email, message,
    submittedAt: serverTimestamp(),
    read: false
  });
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  const email = emailInput.value.trim();
  const message = document.getElementById("help-message").value.trim();

  if (!name || !email || !message) {
    showStatus("Please fill in all fields", true);
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Sending…";
  showStatus("Sending your message…");

  try {
    await sendHelpMessage(name, email, message);
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
