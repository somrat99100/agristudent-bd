import { db, auth, CLOUDINARY_UPLOAD_URL, CLOUDINARY_UPLOAD_PRESET } from "./firebase-config.js";
import {
  collection, getDocs, doc, updateDoc, deleteDoc, addDoc, orderBy, query, Timestamp, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initEmailNotifications, sendReviewEmail } from "./email-config.js";
import { normalizeEmail, normalizeStudentId } from "./identity.js";

initEmailNotifications();

// ============================================
// ESCAPE HELPER — prevents stored XSS from user-submitted
// content (course names, registration details, messages, etc.) being
// rendered as live HTML/JS via innerHTML.
// ============================================
function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ============================================
// SHOW A GENERIC ERROR IN A PANEL without leaking internals
// (full error still goes to console for debugging)
// ============================================
function showLoadError(container, label, err) {
  console.error(`[AgriAdmin] Failed to load ${label}:`, err);
  container.innerHTML = `<p style="color:var(--terracotta-500);">Couldn't load ${esc(label)}. Please refresh and try again.</p>`;
}

// ============================================
// AUTH
// ============================================
const loginBox = document.getElementById("login-box");
const adminPanel = document.getElementById("admin-panel");
const logoutBtn = document.getElementById("logout-btn");
const loginBtn = document.getElementById("login-btn");
const loginError = document.getElementById("login-error");

loginBtn.addEventListener("click", async () => {
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  loginError.classList.add("hidden");
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    console.error("[AgriAdmin] login failed:", err);
    loginError.textContent = "Login failed — please check your email and password.";
    loginError.classList.remove("hidden");
  }
});

logoutBtn.addEventListener("click", () => signOut(auth));

let currentAdminEmail = "";

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentAdminEmail = user.email || "";
    loginBox.classList.add("hidden");
    adminPanel.classList.remove("hidden");
    logoutBtn.classList.remove("hidden");
    loadResources();
  } else {
    loginBox.classList.remove("hidden");
    adminPanel.classList.add("hidden");
    logoutBtn.classList.add("hidden");
  }
});

// ============================================
// TABS
// ============================================
const list = document.getElementById("admin-resource-list");
const termList = document.getElementById("admin-term-list");
const timelineList = document.getElementById("admin-timeline-list");
const regList = document.getElementById("admin-registrations-list");
const msgList = document.getElementById("admin-messages-list");

// Caches of last-loaded docs, keyed by id — used to populate the "Edit any content" modal
// without a second round-trip to Firestore.
const resourcesCache = {};
const termsCache = {};
const timelineCache = {};
const registrationsCache = {};

const tabs = {
  resources: { btn: document.getElementById("tab-resources"), panel: document.getElementById("resources-panel"), load: loadResources },
  terms: { btn: document.getElementById("tab-terms"), panel: document.getElementById("terms-panel"), load: loadTerms },
  timeline: { btn: document.getElementById("tab-timeline"), panel: document.getElementById("timeline-panel"), load: loadTimeline },
  registrations: { btn: document.getElementById("tab-registrations"), panel: document.getElementById("registrations-panel"), load: loadRegistrations },
  messages: { btn: document.getElementById("tab-messages"), panel: document.getElementById("messages-panel"), load: loadMessages },
  danger: { btn: document.getElementById("tab-danger"), panel: document.getElementById("danger-panel"), load: () => {} }
};

Object.entries(tabs).forEach(([key, tab]) => {
  tab.btn.addEventListener("click", () => {
    Object.values(tabs).forEach(t => {
      t.btn.style.background = ""; t.btn.style.color = "";
      t.panel.classList.add("hidden");
    });
    tab.btn.style.background = "var(--moss-700)"; tab.btn.style.color = "#fff";
    tab.panel.classList.remove("hidden");
    tab.load();
  });
});

// ============================================
// RESOURCES
// ============================================
async function loadResources() {
  list.innerHTML = `<p style="color:var(--moss-600);">Loading…</p>`;
  try {
    const q = query(collection(db, "resources"), orderBy("submittedAt", "desc"));
    const snap = await getDocs(q);

    if (snap.empty) { list.innerHTML = `<p style="color:var(--moss-600);">No resources submitted yet.</p>`; return; }

    list.innerHTML = "";
    snap.forEach(d => {
      const item = d.data();
      resourcesCache[d.id] = item;
      const row = document.createElement("div");
      row.className = "resource-row";
      row.innerHTML = `
        <div>
          <strong>${esc(item.courseCode)} — ${esc(item.courseName) || ""}</strong>
          <div style="font-size:.8rem;color:var(--moss-600);">
            ${item.resourceType === "previous_questions" ? "💡 Suggestion" : "📚 Hand Notes"}
            ${item.examType ? " · " + esc(item.examType) : ""} · ${esc(item.facultyName) || ""}
          </div>
          <div style="font-size:.78rem;color:var(--moss-600);margin-top:.2rem;">By: ${esc(item.uploaderName) || "—"} (${esc(item.uploaderEmail) || "no email"})${item.uploaderStudentId ? ` · Student ID: <strong>${esc(item.uploaderStudentId)}</strong>` : ""}</div>
          <div style="margin-top:.4rem;">${(item.fileUrls || []).map(f => `<a href="${esc(f.url)}" target="_blank" rel="noopener" style="font-size:.78rem;color:var(--leaf-500);">${esc(f.name)}</a>`).join(" · ")}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:.4rem;align-items:flex-end;">
          <select data-id="${esc(d.id)}" class="status-select">
            <option value="pending" ${item.status === "pending" ? "selected" : ""}>🕓 Pending</option>
            <option value="approved" ${item.status === "approved" ? "selected" : ""}>✅ Approved</option>
            <option value="rejected" ${item.status === "rejected" ? "selected" : ""}>❌ Rejected</option>
          </select>
          <button type="button" class="edit-btn" data-schema="resources" data-id="${esc(d.id)}" style="background:none;border:1px solid var(--line);padding:.35rem .7rem;border-radius:6px;cursor:pointer;font-size:.78rem;">✏️ Edit</button>
        </div>`;
      list.appendChild(row);
    });

    list.querySelectorAll(".edit-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const item = resourcesCache[btn.dataset.id];
        if (item) openEditModal("resources", btn.dataset.id, item);
      });
    });

    list.querySelectorAll(".status-select").forEach(sel => {
      sel.addEventListener("change", async (e) => {
        e.target.disabled = true;
        const id = e.target.dataset.id;
        const newStatus = e.target.value;
        try {
          await updateDoc(doc(db, "resources", id), { status: newStatus, reviewedAt: new Date() });
          e.target.style.borderColor = "var(--leaf-500)";
          const item = resourcesCache[id];
          if (item) {
            const statusLabel = newStatus === "approved" ? "Approved" : newStatus === "rejected" ? "Rejected" : "Pending";
            sendReviewEmail({
              toEmail: item.uploaderEmail,
              toName: item.uploaderName || item.courseCode,
              status: statusLabel,
              itemType: item.resourceType === "previous_questions" ? "Suggestion upload" : "Hand Notes upload",
              courseCode: item.courseCode,
              courseName: item.courseName,
              detail: item.fileUrls?.[0]?.name || ""
            });
            item.status = newStatus;
          }
        } catch (err) {
          console.error("[AgriAdmin] resource status update failed:", err);
          alert("Something went wrong updating the status. Please try again.");
        }
        finally { e.target.disabled = false; }
      });
    });
  } catch (err) {
    showLoadError(list, "resources", err);
  }
}

// ============================================
// TERMS
// ============================================
async function loadTerms() {
  termList.innerHTML = `<p style="color:var(--moss-600);">Loading…</p>`;
  try {
    const q = query(collection(db, "terms"), orderBy("submittedAt", "desc"));
    const snap = await getDocs(q);

    if (snap.empty) { termList.innerHTML = `<p style="color:var(--moss-600);">No terms submitted yet.</p>`; return; }

    termList.innerHTML = "";
    snap.forEach(d => {
      const item = d.data();
      termsCache[d.id] = item;
      const row = document.createElement("div");
      row.className = "resource-row";
      row.innerHTML = `
        <div style="display:flex;gap:.8rem;align-items:flex-start;">
          <img src="${esc(item.imageUrl)}" alt="${esc(item.name)}" style="width:60px;height:60px;object-fit:cover;border-radius:6px;flex-shrink:0;">
          <div>
            <strong>${esc(item.name)}</strong>
            ${item.possibleDuplicate ? '<span style="color:var(--terracotta-500);font-size:.75rem;margin-left:.4rem;">⚠️ possible duplicate</span>' : ''}
            <div style="font-size:.8rem;color:var(--moss-600);max-width:380px;margin-top:.2rem;">${esc((item.description || "").slice(0, 140))}${(item.description || "").length > 140 ? "…" : ""}</div>
            <div style="font-size:.78rem;color:var(--moss-600);margin-top:.3rem;">By: ${esc(item.uploaderEmail) || "—"}</div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:.4rem;align-items:flex-end;">
          <select data-id="${esc(d.id)}" class="status-select-term">
            <option value="pending" ${item.status === "pending" ? "selected" : ""}>🕓 Pending</option>
            <option value="approved" ${item.status === "approved" ? "selected" : ""}>✅ Approved</option>
            <option value="rejected" ${item.status === "rejected" ? "selected" : ""}>❌ Rejected</option>
          </select>
          <button type="button" class="edit-btn" data-schema="terms" data-id="${esc(d.id)}" style="background:none;border:1px solid var(--line);padding:.35rem .7rem;border-radius:6px;cursor:pointer;font-size:.78rem;">✏️ Edit</button>
        </div>`;
      termList.appendChild(row);
    });

    termList.querySelectorAll(".edit-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const item = termsCache[btn.dataset.id];
        if (item) openEditModal("terms", btn.dataset.id, item);
      });
    });

    termList.querySelectorAll(".status-select-term").forEach(sel => {
      sel.addEventListener("change", async (e) => {
        e.target.disabled = true;
        const id = e.target.dataset.id;
        const newStatus = e.target.value;
        try {
          await updateDoc(doc(db, "terms", id), { status: newStatus, reviewedAt: new Date() });
          e.target.style.borderColor = "var(--leaf-500)";
          const item = termsCache[id];
          if (item) {
            const statusLabel = newStatus === "approved" ? "Approved" : newStatus === "rejected" ? "Rejected" : "Pending";
            sendReviewEmail({
              toEmail: item.uploaderEmail,
              toName: item.name,
              status: statusLabel,
              itemType: "Knowledge Hub term submission",
              courseName: item.name,
              detail: item.name
            });
            item.status = newStatus;
          }
        } catch (err) {
          console.error("[AgriAdmin] term status update failed:", err);
          alert("Something went wrong updating the status. Please try again.");
        }
        finally { e.target.disabled = false; }
      });
    });
  } catch (err) {
    showLoadError(termList, "terms", err);
  }
}

// ============================================
// TIMELINE
// ============================================
const TYPE_LABELS = {
  registration: "Registration", advising: "Advising", add_drop: "Add/Drop Deadline",
  class_test: "Class Test", midterm: "Midterm Examination", final: "Final Examination",
  break: "Semester Break", semester_end: "Semester Ends"
};

document.getElementById("add-event-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("event-title").value.trim();
  const dateVal = document.getElementById("event-date").value;
  const endDateVal = document.getElementById("event-end-date").value;
  const type = document.getElementById("event-type").value;
  if (!title || !dateVal) return;

  try {
    const docData = { title, date: Timestamp.fromDate(new Date(dateVal + "T00:00:00")), type, createdAt: new Date() };
    if (endDateVal) docData.endDate = Timestamp.fromDate(new Date(endDateVal + "T23:59:59"));
    await addDoc(collection(db, "timeline"), docData);
    document.getElementById("event-title").value = "";
    document.getElementById("event-date").value = "";
    document.getElementById("event-end-date").value = "";
    loadTimeline();
  } catch (err) {
    console.error("[AgriAdmin] add event failed:", err);
    alert("Something went wrong adding this event. Please try again.");
  }
});

async function loadTimeline() {
  timelineList.innerHTML = `<p style="color:var(--moss-600);">Loading…</p>`;
  try {
    const q = query(collection(db, "timeline"), orderBy("date", "asc"));
    const snap = await getDocs(q);

    if (snap.empty) { timelineList.innerHTML = `<p style="color:var(--moss-600);">No events added yet — use the form above.</p>`; return; }

    timelineList.innerHTML = "";
    snap.forEach(d => {
      const item = d.data();
      timelineCache[d.id] = item;
      const dateObj = item.date?.toDate ? item.date.toDate() : new Date(item.date);
      const endObj = item.endDate ? (item.endDate.toDate ? item.endDate.toDate() : new Date(item.endDate)) : null;
      const dateLabel = endObj
        ? `${dateObj.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })} - ${endObj.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}`
        : dateObj.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
      const row = document.createElement("div");
      row.className = "resource-row";
      row.innerHTML = `
        <div>
          <strong>${esc(item.title)}</strong>
          <div style="font-size:.8rem;color:var(--moss-600);">${dateLabel} · ${esc(TYPE_LABELS[item.type] || item.type)}</div>
        </div>
        <div style="display:flex;gap:.5rem;">
          <button type="button" data-id="${esc(d.id)}" class="edit-btn" data-schema="timeline" style="background:none;border:1px solid var(--line);padding:.4rem .8rem;border-radius:6px;cursor:pointer;font-size:.8rem;">✏️ Edit</button>
          <button data-id="${esc(d.id)}" class="delete-event-btn" style="background:none;border:1px solid var(--terracotta-500);color:var(--terracotta-500);padding:.4rem .8rem;border-radius:6px;cursor:pointer;font-size:.8rem;">🗑 Delete</button>
        </div>`;
      timelineList.appendChild(row);
    });

    timelineList.querySelectorAll(".edit-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const item = timelineCache[btn.dataset.id];
        if (item) openEditModal("timeline", btn.dataset.id, item);
      });
    });

    timelineList.querySelectorAll(".delete-event-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this event?")) return;
        try { await deleteDoc(doc(db, "timeline", btn.dataset.id)); loadTimeline(); }
        catch (err) {
          console.error("[AgriAdmin] timeline delete failed:", err);
          alert("Something went wrong deleting this event. Please try again.");
        }
      });
    });
  } catch (err) {
    showLoadError(timelineList, "timeline events", err);
  }
}

// ============================================
// REGISTRATIONS (student ID verification)
// ============================================
async function loadRegistrations() {
  regList.innerHTML = `<p style="color:var(--moss-600);">Loading…</p>`;
  try {
    const q = query(collection(db, "registrations"), orderBy("submittedAt", "desc"));
    const snap = await getDocs(q);

    if (snap.empty) { regList.innerHTML = `<p style="color:var(--moss-600);">No registrations yet.</p>`; return; }

    regList.innerHTML = "";
    snap.forEach(d => {
      const item = d.data();
      registrationsCache[d.id] = item;
      const row = document.createElement("div");
      row.className = "resource-row";
      row.innerHTML = `
        <div style="display:flex;gap:.8rem;align-items:flex-start;">
          <img src="${esc(item.avatarUrl) || (item.gender === 'female' ? 'assets/avatar-female.svg' : 'assets/avatar-male.svg')}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:50%;flex-shrink:0;">
          ${item.studentIdUrl ? `<a href="${esc(item.studentIdUrl)}" target="_blank" rel="noopener"><img src="${esc(item.studentIdUrl)}" alt="ID" style="width:60px;height:60px;object-fit:cover;border-radius:6px;flex-shrink:0;"></a>` : `<div style="width:60px;height:60px;background:var(--paper-100);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:.7rem;color:var(--moss-600);flex-shrink:0;">No ID photo</div>`}
          <div>
            <strong>${esc(item.fullName)}</strong>
            <div style="font-size:.8rem;color:var(--moss-600);">${esc(item.gender) || "—"}</div>
            <div style="font-size:.78rem;color:var(--moss-600);margin-top:.2rem;">✉️ ${esc(item.email) || "—"}</div>
            ${item.studentIdNumber ? `<div style="font-size:.78rem;color:var(--moss-600);">ID #: ${esc(item.studentIdNumber)}</div>` : ""}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:.4rem;align-items:flex-end;">
          <select data-id="${esc(d.id)}" class="status-select-reg">
            <option value="unverified" ${(!item.status || item.status === "unverified") ? "selected" : ""}>🕓 Unverified</option>
            <option value="verified" ${item.status === "verified" ? "selected" : ""}>✅ Verified</option>
            <option value="rejected" ${item.status === "rejected" ? "selected" : ""}>❌ Rejected</option>
          </select>
          <button type="button" class="edit-btn" data-schema="registrations" data-id="${esc(d.id)}" style="background:none;border:1px solid var(--line);padding:.35rem .7rem;border-radius:6px;cursor:pointer;font-size:.78rem;">✏️ Edit</button>
        </div>`;
      regList.appendChild(row);
    });

    regList.querySelectorAll(".edit-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const item = registrationsCache[btn.dataset.id];
        if (item) openEditModal("registrations", btn.dataset.id, item);
      });
    });

    regList.querySelectorAll(".status-select-reg").forEach(sel => {
      sel.addEventListener("change", async (e) => {
        e.target.disabled = true;
        const id = e.target.dataset.id;
        const newStatus = e.target.value;
        try {
          await updateDoc(doc(db, "registrations", id), { status: newStatus, reviewedAt: new Date() });
          e.target.style.borderColor = "var(--leaf-500)";
          const item = registrationsCache[id];
          if (item) {
            const statusLabel = newStatus === "verified" ? "Verified" : newStatus === "rejected" ? "Rejected" : "Unverified";
            sendReviewEmail({
              toEmail: item.email,
              toName: item.fullName,
              status: statusLabel,
              itemType: "Student registration",
              detail: item.studentIdNumber ? `Student ID #${item.studentIdNumber}` : ""
            });
            item.status = newStatus;
          }
        } catch (err) {
          console.error("[AgriAdmin] registration status update failed:", err);
          alert("Something went wrong updating the status. Please try again.");
        }
        finally { e.target.disabled = false; }
      });
    });
  } catch (err) {
    showLoadError(regList, "registrations", err);
  }
}

// ============================================
// MESSAGES (Ask For Help submissions)
// ============================================
async function loadMessages() {
  msgList.innerHTML = `<p style="color:var(--moss-600);">Loading…</p>`;
  try {
    const q = query(collection(db, "messages"), orderBy("submittedAt", "desc"));
    const snap = await getDocs(q);

    if (snap.empty) { msgList.innerHTML = `<p style="color:var(--moss-600);">No messages yet.</p>`; return; }

    msgList.innerHTML = "";
    snap.forEach(d => {
      const item = d.data();
      const row = document.createElement("div");
      row.className = "resource-row";
      row.innerHTML = `
        <div>
          <strong>${esc(item.name)}</strong> <span style="font-size:.8rem;color:var(--moss-600);">(${esc(item.email)})</span>
          <div style="font-size:.85rem;color:var(--moss-700);margin-top:.3rem;max-width:480px;">${esc(item.message)}</div>
        </div>`;
      msgList.appendChild(row);
    });
  } catch (err) {
    showLoadError(msgList, "messages", err);
  }
}

// ============================================
// DANGER ZONE — bulk delete (clear test data)
// ============================================
const dangerResult = document.getElementById("danger-result");

async function deleteAllDocsInCollection(collectionName) {
  const snap = await getDocs(collection(db, collectionName));
  if (snap.empty) return 0;
  const docs = snap.docs;
  const CHUNK = 450; // stay under Firestore's 500-write batch limit
  for (let i = 0; i < docs.length; i += CHUNK) {
    const batch = writeBatch(db);
    docs.slice(i, i + CHUNK).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
  return docs.length;
}

document.querySelectorAll(".danger-delete-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    const collectionName = btn.dataset.collection;
    const label = btn.dataset.label;

    const typed = prompt(`This will permanently delete ALL documents in "${label}".\nType DELETE (in capitals) to confirm.`);
    if (typed !== "DELETE") {
      dangerResult.textContent = "Cancelled — nothing was deleted.";
      dangerResult.style.color = "var(--moss-600)";
      dangerResult.classList.remove("hidden");
      return;
    }

    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Deleting…";

    try {
      const count = await deleteAllDocsInCollection(collectionName);
      dangerResult.textContent = `✅ Deleted ${count} document(s) from "${label}".`;
      dangerResult.style.color = "var(--leaf-500)";
      dangerResult.classList.remove("hidden");

      // Refresh whichever tab shows this data, if it's currently loaded
      if (collectionName === "resources") loadResources();
      if (collectionName === "terms") loadTerms();
      if (collectionName === "registrations") loadRegistrations();
      if (collectionName === "timeline") loadTimeline();
      if (collectionName === "messages") loadMessages();
    } catch (err) {
      console.error("[AgriAdmin] bulk delete failed:", err);
      dangerResult.textContent = `❌ Something went wrong deleting "${label}". Please try again.`;
      dangerResult.style.color = "var(--terracotta-500)";
      dangerResult.classList.remove("hidden");
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });
});

// ============================================
// GENERIC "EDIT ANY CONTENT" MODAL
// ============================================
// Each schema describes which fields can be edited for that collection,
// how to render an input for them, and how to read the value back out.
const EDIT_SCHEMAS = {
  resources: {
    collection: "resources",
    title: "Edit Resource",
    reload: loadResources,
    cache: resourcesCache,
    fields: [
      { key: "courseCode", label: "Course Code", type: "text" },
      { key: "courseName", label: "Course Name", type: "text" },
      { key: "facultyName", label: "Faculty Name", type: "text" },
      { key: "examType", label: "Exam Type", type: "text" },
      { key: "uploaderName", label: "Uploader Name", type: "text" },
      { key: "uploaderEmail", label: "Uploader Email", type: "text" }
    ]
  },
  terms: {
    collection: "terms",
    title: "Edit Term",
    reload: loadTerms,
    cache: termsCache,
    fields: [
      { key: "name", label: "Term Name", type: "text" },
      { key: "description", label: "Description", type: "textarea" },
      { key: "imageUrl", label: "Image URL", type: "text" }
    ]
  },
  timeline: {
    collection: "timeline",
    title: "Edit Timeline Event",
    reload: loadTimeline,
    cache: timelineCache,
    fields: [
      { key: "title", label: "Title", type: "text" },
      { key: "date", label: "Start Date", type: "date" },
      { key: "endDate", label: "End Date (optional)", type: "date" },
      { key: "type", label: "Type", type: "select", options: TYPE_LABELS }
    ]
  },
  registrations: {
    collection: "registrations",
    title: "Edit Registration",
    reload: loadRegistrations,
    cache: registrationsCache,
    fields: [
      { key: "fullName", label: "Full Name", type: "text" },
      { key: "email", label: "Email", type: "text" },
      { key: "gender", label: "Gender", type: "select", options: { male: "Male", female: "Female" } },
      { key: "studentIdNumber", label: "Student ID Number", type: "text" }
    ]
  }
};

const editModal = document.getElementById("edit-modal");
const editModalTitle = document.getElementById("edit-modal-title");
const editModalFields = document.getElementById("edit-modal-fields");
const editModalForm = document.getElementById("edit-modal-form");
const editModalError = document.getElementById("edit-modal-error");
const editModalSave = document.getElementById("edit-modal-save");

let currentEditSchemaKey = null;
let currentEditDocId = null;

function tsToDateInputValue(val) {
  if (!val) return "";
  const dateObj = val?.toDate ? val.toDate() : new Date(val);
  if (isNaN(dateObj.getTime())) return "";
  return dateObj.toISOString().slice(0, 10);
}

function openEditModal(schemaKey, docId, item) {
  const schema = EDIT_SCHEMAS[schemaKey];
  if (!schema) return;
  currentEditSchemaKey = schemaKey;
  currentEditDocId = docId;
  editModalTitle.textContent = schema.title;
  editModalError.classList.add("hidden");

  editModalFields.innerHTML = schema.fields.map(f => {
    const fieldId = `edit-field-${f.key}`;
    if (f.type === "textarea") {
      return `<div class="form-field"><label for="${fieldId}">${esc(f.label)}</label>
        <textarea id="${fieldId}" data-key="${esc(f.key)}">${esc(item[f.key] || "")}</textarea></div>`;
    }
    if (f.type === "date") {
      return `<div class="form-field"><label for="${fieldId}">${esc(f.label)}</label>
        <input type="date" id="${fieldId}" data-key="${esc(f.key)}" value="${esc(tsToDateInputValue(item[f.key]))}"></div>`;
    }
    if (f.type === "select") {
      const opts = Object.entries(f.options).map(([val, label]) =>
        `<option value="${esc(val)}" ${item[f.key] === val ? "selected" : ""}>${esc(label)}</option>`).join("");
      return `<div class="form-field"><label for="${fieldId}">${esc(f.label)}</label>
        <select id="${fieldId}" data-key="${esc(f.key)}">${opts}</select></div>`;
    }
    return `<div class="form-field"><label for="${fieldId}">${esc(f.label)}</label>
      <input type="text" id="${fieldId}" data-key="${esc(f.key)}" value="${esc(item[f.key] || "")}"></div>`;
  }).join("");

  editModal.classList.remove("hidden");
}

function closeEditModal() {
  editModal.classList.add("hidden");
  currentEditSchemaKey = null;
  currentEditDocId = null;
}

document.getElementById("edit-modal-close").addEventListener("click", closeEditModal);
document.getElementById("edit-modal-cancel").addEventListener("click", closeEditModal);
editModal.addEventListener("click", (e) => { if (e.target === editModal) closeEditModal(); });

editModalForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentEditSchemaKey || !currentEditDocId) return;
  const schema = EDIT_SCHEMAS[currentEditSchemaKey];

  const updateData = {};
  schema.fields.forEach(f => {
    const input = editModalFields.querySelector(`[data-key="${f.key}"]`);
    if (!input) return;
    if (f.type === "date") {
      updateData[f.key] = input.value ? Timestamp.fromDate(new Date(input.value + "T00:00:00")) : null;
    } else if (f.key === "email" || f.key === "uploaderEmail") {
      updateData[f.key] = normalizeEmail(input.value);
    } else if (f.key === "studentIdNumber") {
      updateData[f.key] = normalizeStudentId(input.value);
    } else {
      updateData[f.key] = input.value.trim();
    }
  });
  updateData.editedAt = new Date();

  editModalSave.disabled = true;
  editModalSave.textContent = "Saving…";
  editModalError.classList.add("hidden");

  try {
    await updateDoc(doc(db, schema.collection, currentEditDocId), updateData);
    closeEditModal();
    schema.reload();
  } catch (err) {
    console.error("[AgriAdmin] edit save failed:", err);
    editModalError.textContent = "Couldn't save changes. Please try again.";
    editModalError.classList.remove("hidden");
  } finally {
    editModalSave.disabled = false;
    editModalSave.textContent = "💾 Save Changes";
  }
});

// ============================================
// BULK UPLOAD TERMS
// ============================================
const bulkTermImagesInput = document.getElementById("bulk-term-images");
const bulkTermRows = document.getElementById("bulk-term-rows");
const bulkTermUploadBtn = document.getElementById("bulk-term-upload-btn");
const bulkTermStatus = document.getElementById("bulk-term-status");

let bulkTermFiles = [];

function filenameToTitle(name) {
  return name.replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function uploadFileToCloudinary(file, onProgress) {
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
        reject(new Error(`Image upload failed (server said: ${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.ontimeout = () => reject(new Error("Upload took too long. Try again."));
    const data = new FormData();
    data.append("file", file);
    data.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    xhr.send(data);
  });
}

bulkTermImagesInput.addEventListener("change", () => {
  bulkTermFiles = Array.from(bulkTermImagesInput.files || []);
  bulkTermRows.innerHTML = "";
  bulkTermStatus.textContent = "";

  if (!bulkTermFiles.length) {
    bulkTermUploadBtn.classList.add("hidden");
    return;
  }

  bulkTermFiles.forEach((file, idx) => {
    const row = document.createElement("div");
    row.className = "bulk-term-row";
    row.dataset.index = String(idx);
    const objectUrl = URL.createObjectURL(file);
    row.innerHTML = `
      <img src="${objectUrl}" alt="">
      <div class="bulk-term-fields">
        <input type="text" class="bulk-term-name" placeholder="Term name" value="${esc(filenameToTitle(file.name))}">
        <textarea class="bulk-term-desc" placeholder="Short description (optional)" rows="2"></textarea>
      </div>
      <span class="bulk-term-status">Ready</span>`;
    bulkTermRows.appendChild(row);
  });

  bulkTermUploadBtn.classList.remove("hidden");
});

bulkTermUploadBtn.addEventListener("click", async () => {
  const rows = Array.from(bulkTermRows.querySelectorAll(".bulk-term-row"));
  if (!rows.length) return;

  bulkTermUploadBtn.disabled = true;
  bulkTermUploadBtn.textContent = "Uploading…";
  bulkTermStatus.textContent = "";

  let successCount = 0;
  let failCount = 0;

  for (const row of rows) {
    const idx = Number(row.dataset.index);
    const file = bulkTermFiles[idx];
    const nameInput = row.querySelector(".bulk-term-name");
    const descInput = row.querySelector(".bulk-term-desc");
    const statusEl = row.querySelector(".bulk-term-status");
    const name = nameInput.value.trim();

    if (!name) {
      statusEl.textContent = "⚠️ Name required";
      statusEl.style.color = "var(--terracotta-500)";
      failCount++;
      continue;
    }

    statusEl.textContent = "Uploading…";
    statusEl.style.color = "var(--moss-600)";
    nameInput.disabled = true;
    descInput.disabled = true;

    try {
      const imageUrl = await uploadFileToCloudinary(file, (pct) => {
        statusEl.textContent = `Uploading ${pct}%`;
      });
      await addDoc(collection(db, "terms"), {
        name,
        description: descInput.value.trim(),
        imageUrl,
        uploaderEmail: currentAdminEmail || "admin",
        status: "approved",
        possibleDuplicate: false,
        submittedAt: serverTimestamp(),
        reviewedAt: new Date()
      });
      statusEl.textContent = "✅ Published";
      statusEl.style.color = "var(--leaf-500)";
      successCount++;
    } catch (err) {
      console.error("[AgriAdmin] bulk term upload failed:", err);
      statusEl.textContent = "❌ Failed";
      statusEl.style.color = "var(--terracotta-500)";
      failCount++;
      nameInput.disabled = false;
      descInput.disabled = false;
    }
  }

  bulkTermStatus.textContent = `Done — ${successCount} published, ${failCount} failed.`;
  bulkTermStatus.style.color = failCount ? "var(--terracotta-500)" : "var(--leaf-500)";
  bulkTermUploadBtn.disabled = false;
  bulkTermUploadBtn.textContent = "⬆️ Upload All";

  if (successCount > 0) loadTerms();
});
