import { db, auth } from "./firebase-config.js";
import {
  collection, getDocs, doc, updateDoc, deleteDoc, addDoc, orderBy, query, Timestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

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
    loginError.textContent = "Login failed: " + err.message;
    loginError.classList.remove("hidden");
  }
});

logoutBtn.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  if (user) {
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
  const q = query(collection(db, "resources"), orderBy("submittedAt", "desc"));
  const snap = await getDocs(q);

  if (snap.empty) { list.innerHTML = `<p style="color:var(--moss-600);">No resources submitted yet.</p>`; return; }

  list.innerHTML = "";
  snap.forEach(d => {
    const item = d.data();
    const row = document.createElement("div");
    row.className = "resource-row";
    row.innerHTML = `
      <div>
        <strong>${item.courseCode} — ${item.courseName || ""}</strong>
        <div style="font-size:.8rem;color:var(--moss-600);">
          ${item.resourceType === "previous_questions" ? "💡 Suggestion" : "📚 All Slides"}
          ${item.examType ? " · " + item.examType : ""} · ${item.facultyName || ""}
        </div>
        <div style="font-size:.78rem;color:var(--moss-600);margin-top:.2rem;">By: ${item.uploaderName || "—"} (${item.uploaderEmail || "no email"})</div>
        <div style="margin-top:.4rem;">${(item.fileUrls || []).map(f => `<a href="${f.url}" target="_blank" rel="noopener" style="font-size:.78rem;color:var(--leaf-500);">${f.name}</a>`).join(" · ")}</div>
      </div>
      <div>
        <select data-id="${d.id}" class="status-select">
          <option value="pending" ${item.status === "pending" ? "selected" : ""}>🕓 Pending</option>
          <option value="approved" ${item.status === "approved" ? "selected" : ""}>✅ Approved</option>
          <option value="rejected" ${item.status === "rejected" ? "selected" : ""}>❌ Rejected</option>
        </select>
      </div>`;
    list.appendChild(row);
  });

  list.querySelectorAll(".status-select").forEach(sel => {
    sel.addEventListener("change", async (e) => {
      e.target.disabled = true;
      try {
        await updateDoc(doc(db, "resources", e.target.dataset.id), { status: e.target.value, reviewedAt: new Date() });
        e.target.style.borderColor = "var(--leaf-500)";
      } catch (err) { alert("Failed: " + err.message); }
      finally { e.target.disabled = false; }
    });
  });
}

// ============================================
// TERMS
// ============================================
async function loadTerms() {
  termList.innerHTML = `<p style="color:var(--moss-600);">Loading…</p>`;
  const q = query(collection(db, "terms"), orderBy("submittedAt", "desc"));
  const snap = await getDocs(q);

  if (snap.empty) { termList.innerHTML = `<p style="color:var(--moss-600);">No terms submitted yet.</p>`; return; }

  termList.innerHTML = "";
  snap.forEach(d => {
    const item = d.data();
    const row = document.createElement("div");
    row.className = "resource-row";
    row.innerHTML = `
      <div style="display:flex;gap:.8rem;align-items:flex-start;">
        <img src="${item.imageUrl}" alt="${item.name}" style="width:60px;height:60px;object-fit:cover;border-radius:6px;flex-shrink:0;">
        <div>
          <strong>${item.name}</strong>
          ${item.possibleDuplicate ? '<span style="color:var(--terracotta-500);font-size:.75rem;margin-left:.4rem;">⚠️ possible duplicate</span>' : ''}
          <div style="font-size:.8rem;color:var(--moss-600);max-width:380px;margin-top:.2rem;">${(item.description || "").slice(0, 140)}${(item.description || "").length > 140 ? "…" : ""}</div>
          <div style="font-size:.78rem;color:var(--moss-600);margin-top:.3rem;">By: ${item.uploaderEmail || "—"}</div>
        </div>
      </div>
      <div>
        <select data-id="${d.id}" class="status-select-term">
          <option value="pending" ${item.status === "pending" ? "selected" : ""}>🕓 Pending</option>
          <option value="approved" ${item.status === "approved" ? "selected" : ""}>✅ Approved</option>
          <option value="rejected" ${item.status === "rejected" ? "selected" : ""}>❌ Rejected</option>
        </select>
      </div>`;
    termList.appendChild(row);
  });

  termList.querySelectorAll(".status-select-term").forEach(sel => {
    sel.addEventListener("change", async (e) => {
      e.target.disabled = true;
      try {
        await updateDoc(doc(db, "terms", e.target.dataset.id), { status: e.target.value, reviewedAt: new Date() });
        e.target.style.borderColor = "var(--leaf-500)";
      } catch (err) { alert("Failed: " + err.message); }
      finally { e.target.disabled = false; }
    });
  });
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
  } catch (err) { alert("Failed to add event: " + err.message); }
});

async function loadTimeline() {
  timelineList.innerHTML = `<p style="color:var(--moss-600);">Loading…</p>`;
  const q = query(collection(db, "timeline"), orderBy("date", "asc"));
  const snap = await getDocs(q);

  if (snap.empty) { timelineList.innerHTML = `<p style="color:var(--moss-600);">No events added yet — use the form above.</p>`; return; }

  timelineList.innerHTML = "";
  snap.forEach(d => {
    const item = d.data();
    const dateObj = item.date?.toDate ? item.date.toDate() : new Date(item.date);
    const endObj = item.endDate ? (item.endDate.toDate ? item.endDate.toDate() : new Date(item.endDate)) : null;
    const dateLabel = endObj
      ? `${dateObj.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })} - ${endObj.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}`
      : dateObj.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
    const row = document.createElement("div");
    row.className = "resource-row";
    row.innerHTML = `
      <div>
        <strong>${item.title}</strong>
        <div style="font-size:.8rem;color:var(--moss-600);">${dateLabel} · ${TYPE_LABELS[item.type] || item.type}</div>
      </div>
      <button data-id="${d.id}" class="delete-event-btn" style="background:none;border:1px solid var(--terracotta-500);color:var(--terracotta-500);padding:.4rem .8rem;border-radius:6px;cursor:pointer;font-size:.8rem;">🗑 Delete</button>`;
    timelineList.appendChild(row);
  });

  timelineList.querySelectorAll(".delete-event-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this event?")) return;
      try { await deleteDoc(doc(db, "timeline", btn.dataset.id)); loadTimeline(); }
      catch (err) { alert("Failed to delete: " + err.message); }
    });
  });
}

// ============================================
// REGISTRATIONS (student ID verification)
// ============================================
async function loadRegistrations() {
  regList.innerHTML = `<p style="color:var(--moss-600);">Loading…</p>`;
  const q = query(collection(db, "registrations"), orderBy("submittedAt", "desc"));
  const snap = await getDocs(q);

  if (snap.empty) { regList.innerHTML = `<p style="color:var(--moss-600);">No registrations yet.</p>`; return; }

  regList.innerHTML = "";
  snap.forEach(d => {
    const item = d.data();
    const row = document.createElement("div");
    row.className = "resource-row";
    row.innerHTML = `
      <div style="display:flex;gap:.8rem;align-items:flex-start;">
        ${item.studentIdUrl ? `<a href="${item.studentIdUrl}" target="_blank" rel="noopener"><img src="${item.studentIdUrl}" alt="ID" style="width:60px;height:60px;object-fit:cover;border-radius:6px;flex-shrink:0;"></a>` : `<div style="width:60px;height:60px;background:var(--paper-100);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:.7rem;color:var(--moss-600);flex-shrink:0;">No photo</div>`}
        <div>
          <strong>${item.fullName}</strong>
          <div style="font-size:.8rem;color:var(--moss-600);">${item.institution || ""}</div>
          <div style="font-size:.78rem;color:var(--moss-600);margin-top:.2rem;">📞 ${item.phone || "—"} · 💬 ${item.whatsapp || "—"} · ✉️ ${item.email || "—"}</div>
          ${item.studentIdNumber ? `<div style="font-size:.78rem;color:var(--moss-600);">ID #: ${item.studentIdNumber}</div>` : ""}
        </div>
      </div>
      <div>
        <select data-id="${d.id}" class="status-select-reg">
          <option value="unverified" ${(!item.status || item.status === "unverified") ? "selected" : ""}>🕓 Unverified</option>
          <option value="verified" ${item.status === "verified" ? "selected" : ""}>✅ Verified</option>
          <option value="rejected" ${item.status === "rejected" ? "selected" : ""}>❌ Rejected</option>
        </select>
      </div>`;
    regList.appendChild(row);
  });

  regList.querySelectorAll(".status-select-reg").forEach(sel => {
    sel.addEventListener("change", async (e) => {
      e.target.disabled = true;
      try {
        await updateDoc(doc(db, "registrations", e.target.dataset.id), { status: e.target.value, reviewedAt: new Date() });
        e.target.style.borderColor = "var(--leaf-500)";
      } catch (err) { alert("Failed: " + err.message); }
      finally { e.target.disabled = false; }
    });
  });
}

// ============================================
// MESSAGES (Ask For Help submissions)
// ============================================
async function loadMessages() {
  msgList.innerHTML = `<p style="color:var(--moss-600);">Loading…</p>`;
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
        <strong>${item.name}</strong> <span style="font-size:.8rem;color:var(--moss-600);">(${item.email})</span>
        <div style="font-size:.85rem;color:var(--moss-700);margin-top:.3rem;max-width:480px;">${item.message}</div>
      </div>`;
    msgList.appendChild(row);
  });
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
      dangerResult.textContent = "❌ Failed: " + err.message;
      dangerResult.style.color = "var(--terracotta-500)";
      dangerResult.classList.remove("hidden");
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });
});
