import { db, auth } from "./firebase-config.js";
import {
  collection, getDocs, doc, updateDoc, deleteDoc, addDoc, orderBy, query, Timestamp, writeBatch, getDoc
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
  alumni: { btn: document.getElementById("tab-alumni"), panel: document.getElementById("alumni-panel"), load: loadAlumni },
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
// RESOURCES (with per-file delete)
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

    const filesHtml = (item.fileUrls || []).map((f, idx) => `
      <div style="display:flex;align-items:center;gap:.5rem;margin-top:.3rem;">
        <a href="${f.url}" target="_blank" rel="noopener" style="font-size:.78rem;color:var(--leaf-500);flex:1;">${f.name}</a>
        <button class="delete-file-btn" data-docid="${d.id}" data-idx="${idx}"
          style="background:none;border:1px solid var(--terracotta-500);color:var(--terracotta-500);padding:.2rem .5rem;border-radius:5px;font-size:.7rem;cursor:pointer;white-space:nowrap;">
          🗑 Remove
        </button>
      </div>
    `).join("");

    row.innerHTML = `
      <div style="flex:1;">
        <strong>${esc(item.courseCode)} — ${esc(item.courseName || "")}</strong>
        <div style="font-size:.8rem;color:var(--moss-600);">
          ${item.resourceType === "previous_questions" ? "💡 Suggestion" : "📚 All Slides"}
          ${item.examType ? " · " + esc(item.examType) : ""} · ${esc(item.facultyName || "")}
        </div>
        <div style="font-size:.78rem;color:var(--moss-600);margin-top:.2rem;">By: ${esc(item.uploaderName || "—")} (${esc(item.uploaderEmail || "no email")})</div>
        <div style="margin-top:.3rem;">${filesHtml}</div>
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
      } catch (err) { console.error("[Admin] update failed:", err); alert("Something went wrong. Please try again."); }
      finally { e.target.disabled = false; }
    });
  });

  // Per-file delete
  list.querySelectorAll(".delete-file-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const { docid, idx } = btn.dataset;
      if (!confirm("Remove this file from the resource? This cannot be undone.")) return;
      btn.disabled = true;
      btn.textContent = "Removing…";
      try {
        const ref = doc(db, "resources", docid);
        const snap = await getDoc(ref);
        if (!snap.exists()) throw new Error("Resource not found.");
        const fileUrls = [...(snap.data().fileUrls || [])];
        fileUrls.splice(Number(idx), 1);
        await updateDoc(ref, { fileUrls });
        loadResources();
      } catch (err) {
        console.error("[Admin] file delete failed:", err); alert("Could not remove file. Please try again.");
        btn.disabled = false;
        btn.textContent = "🗑 Remove";
      }
    });
  });
}

// ============================================
// TERMS (with inline edit for name & description)
// ============================================

// Shared edit modal — injected once into DOM
function ensureTermEditModal() {
  if (document.getElementById("admin-term-edit-modal")) return;
  const modal = document.createElement("div");
  modal.id = "admin-term-edit-modal";
  modal.style.cssText = "display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;align-items:center;justify-content:center;";
  modal.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:2rem;width:90%;max-width:500px;position:relative;">
      <button id="term-edit-close" style="position:absolute;top:.8rem;right:.8rem;background:none;border:none;font-size:1.2rem;cursor:pointer;">✕</button>
      <h3 style="margin-bottom:1.2rem;font-size:1.1rem;">✏️ Edit Term</h3>
      <input type="hidden" id="term-edit-id">
      <div style="margin-bottom:.9rem;">
        <label style="display:block;font-weight:600;font-size:.88rem;margin-bottom:.3rem;">Term Name</label>
        <input type="text" id="term-edit-name" style="width:100%;padding:.6rem .8rem;border:1px solid var(--line);border-radius:8px;font-size:.95rem;">
      </div>
      <div style="margin-bottom:.9rem;">
        <label style="display:block;font-weight:600;font-size:.88rem;margin-bottom:.3rem;">Description</label>
        <p style="font-size:.75rem;color:var(--moss-600);margin:0 0 .3rem;font-family:var(--font-mono);">Use **double asterisks** for <strong>bold</strong> text.</p>
        <textarea id="term-edit-desc" rows="6" style="width:100%;padding:.6rem .8rem;border:1px solid var(--line);border-radius:8px;font-size:.9rem;font-family:var(--font-body);resize:vertical;"></textarea>
      </div>
      <button id="term-edit-save" class="btn-primary" style="width:100%;">Save Changes</button>
      <p id="term-edit-status" style="text-align:center;font-size:.85rem;margin-top:.6rem;display:none;"></p>
    </div>`;
  document.body.appendChild(modal);

  document.getElementById("term-edit-close").addEventListener("click", () => {
    modal.style.display = "none";
  });
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.style.display = "none"; });

  document.getElementById("term-edit-save").addEventListener("click", async () => {
    const id = document.getElementById("term-edit-id").value;
    const name = document.getElementById("term-edit-name").value.trim();
    const description = document.getElementById("term-edit-desc").value.trim();
    const statusEl = document.getElementById("term-edit-status");
    const saveBtn = document.getElementById("term-edit-save");

    if (!name || !description) {
      statusEl.textContent = "Name and description are required.";
      statusEl.style.color = "var(--terracotta-500)";
      statusEl.style.display = "block";
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    statusEl.style.display = "none";
    try {
      await updateDoc(doc(db, "terms", id), { name, description, editedAt: new Date() });
      statusEl.textContent = "✅ Saved!";
      statusEl.style.color = "var(--leaf-500)";
      statusEl.style.display = "block";
      setTimeout(() => {
        modal.style.display = "none";
        loadTerms();
      }, 800);
    } catch (err) {
      console.error("[Admin] term edit failed:", err); statusEl.textContent = "Something went wrong. Please try again.";
      statusEl.style.color = "var(--terracotta-500)";
      statusEl.style.display = "block";
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Changes";
    }
  });
}

async function loadTerms() {
  termList.innerHTML = `<p style="color:var(--moss-600);">Loading…</p>`;
  ensureTermEditModal();
  const q = query(collection(db, "terms"), orderBy("submittedAt", "desc"));
  const snap = await getDocs(q);

  if (snap.empty) { termList.innerHTML = `<p style="color:var(--moss-600);">No terms submitted yet.</p>`; return; }

  termList.innerHTML = "";
  snap.forEach(d => {
    const item = d.data();
    const row = document.createElement("div");
    row.className = "resource-row";
    row.innerHTML = `
      <div style="display:flex;gap:.8rem;align-items:flex-start;flex:1;">
        <img src="${esc(item.imageUrl)}" alt="${esc(item.name)}" style="width:60px;height:60px;object-fit:cover;border-radius:6px;flex-shrink:0;">
        <div style="flex:1;">
          <strong>${esc(item.name)}</strong>
          ${item.possibleDuplicate ? '<span style="color:var(--terracotta-500);font-size:.75rem;margin-left:.4rem;">⚠️ possible duplicate</span>' : ''}
          <div style="font-size:.8rem;color:var(--moss-600);max-width:380px;margin-top:.2rem;">${esc((item.description || "").slice(0, 140))}${(item.description || "").length > 140 ? "…" : ""}</div>
          <div style="font-size:.78rem;color:var(--moss-600);margin-top:.3rem;">By: ${esc(item.uploaderEmail || "—")}</div>
          <button class="edit-term-btn" data-id="${d.id}" data-name="${encodeURIComponent(item.name)}" data-desc="${encodeURIComponent(item.description || "")}"
            style="margin-top:.5rem;background:none;border:1px solid var(--moss-600);color:var(--moss-700);padding:.25rem .65rem;border-radius:6px;font-size:.75rem;cursor:pointer;">
            ✏️ Edit Name & Description
          </button>
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
      } catch (err) { console.error("[Admin] update failed:", err); alert("Something went wrong. Please try again."); }
      finally { e.target.disabled = false; }
    });
  });

  termList.querySelectorAll(".edit-term-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.getElementById("term-edit-id").value = btn.dataset.id;
      document.getElementById("term-edit-name").value = decodeURIComponent(btn.dataset.name);
      document.getElementById("term-edit-desc").value = decodeURIComponent(btn.dataset.desc);
      document.getElementById("term-edit-status").style.display = "none";
      document.getElementById("admin-term-edit-modal").style.display = "flex";
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
  } catch (err) { console.error("[Admin] add event failed:", err); alert("Could not add event. Please try again."); }
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
        <strong>${esc(item.title)}</strong>
        <div style="font-size:.8rem;color:var(--moss-600);">${esc(dateLabel)} · ${esc(TYPE_LABELS[item.type] || item.type)}</div>
      </div>
      <button data-id="${d.id}" class="delete-event-btn" style="background:none;border:1px solid var(--terracotta-500);color:var(--terracotta-500);padding:.4rem .8rem;border-radius:6px;cursor:pointer;font-size:.8rem;">🗑 Delete</button>`;
    timelineList.appendChild(row);
  });

  timelineList.querySelectorAll(".delete-event-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this event?")) return;
      try { await deleteDoc(doc(db, "timeline", btn.dataset.id)); loadTimeline(); }
      catch (err) { console.error("[Admin] delete event failed:", err); alert("Could not delete. Please try again."); }
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
        ${item.studentIdUrl ? `<a href="${esc(item.studentIdUrl)}" target="_blank" rel="noopener"><img src="${esc(item.studentIdUrl)}" alt="ID" style="width:60px;height:60px;object-fit:cover;border-radius:6px;flex-shrink:0;"></a>` : `<div style="width:60px;height:60px;background:var(--paper-100);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:.7rem;color:var(--moss-600);flex-shrink:0;">No photo</div>`}
        <div>
          <strong>${esc(item.fullName)}</strong>
          <div style="font-size:.8rem;color:var(--moss-600);">${esc(item.institution || "")}</div>
          <div style="font-size:.78rem;color:var(--moss-600);margin-top:.2rem;">📞 ${esc(item.phone || "—")} · 💬 ${esc(item.whatsapp || "—")} · ✉️ ${esc(item.email || "—")}</div>
          ${item.studentIdNumber ? `<div style="font-size:.78rem;color:var(--moss-600);">ID #: ${esc(item.studentIdNumber)}</div>` : ""}
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
      } catch (err) { console.error("[Admin] update failed:", err); alert("Something went wrong. Please try again."); }
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
        <strong>${esc(item.name)}</strong> <span style="font-size:.8rem;color:var(--moss-600);">(${esc(item.email)})</span>
        <div style="font-size:.85rem;color:var(--moss-700);margin-top:.3rem;max-width:480px;">${esc(item.message)}</div>
      </div>`;
    msgList.appendChild(row);
  });
}

// ============================================
// ALUMNI
// ============================================
const alumniList = document.getElementById("admin-alumni-list");

async function loadAlumni() {
  alumniList.innerHTML = `<p style="color:var(--moss-600);">Loading…</p>`;
  try {
    // Admin reads ALL alumni regardless of status — no orderBy to avoid index requirement
    const snap = await getDocs(collection(db, "alumni"));

    if (snap.empty) { alumniList.innerHTML = `<p style="color:var(--moss-600);">No alumni profiles submitted yet.</p>`; return; }

    // Sort client-side: pending first, then by submittedAt desc
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    docs.sort((a, b) => {
      const statusOrder = { pending: 0, approved: 1, rejected: 2 };
      if (statusOrder[a.status] !== statusOrder[b.status])
        return (statusOrder[a.status] ?? 1) - (statusOrder[b.status] ?? 1);
      const aTime = a.submittedAt?.toMillis?.() ?? 0;
      const bTime = b.submittedAt?.toMillis?.() ?? 0;
      return bTime - aTime;
    });

    alumniList.innerHTML = "";
    docs.forEach(item => {
      const row = document.createElement("div");
      row.className = "resource-row";
      row.innerHTML = `
        <div style="display:flex;gap:.8rem;align-items:flex-start;flex:1;">
          ${item.photoUrl ? `<img src="${esc(item.photoUrl)}" alt="${esc(item.fullName)}" style="width:56px;height:56px;object-fit:cover;border-radius:50%;flex-shrink:0;">` : `<div style="width:56px;height:56px;background:var(--paper-100);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.4rem;flex-shrink:0;">🎓</div>`}
          <div style="flex:1;">
            <strong>${esc(item.fullName)}</strong>
            <span style="font-size:.75rem;color:var(--moss-600);margin-left:.5rem;">Batch ${esc(item.batch || "—")}</span><br>
            <span style="font-size:.8rem;color:var(--moss-600);">ID: ${esc(item.studentId)} · ${esc(item.email)}</span><br>
            ${item.phone ? `<span style="font-size:.78rem;color:var(--moss-600);">📞 ${esc(item.phone)}</span><br>` : ""}
            <span style="font-size:.8rem;color:var(--moss-700);margin-top:.2rem;display:block;">💼 ${esc(item.currentJob || "No job info")}</span>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:.5rem;align-items:flex-end;">
          <select data-id="${item.id}" class="status-select-alumni" style="font-size:.82rem;padding:.4rem .6rem;border:1px solid var(--line);border-radius:6px;">
            <option value="pending" ${(!item.status || item.status === "pending") ? "selected" : ""}>🕓 Pending</option>
            <option value="approved" ${item.status === "approved" ? "selected" : ""}>✅ Approved</option>
            <option value="rejected" ${item.status === "rejected" ? "selected" : ""}>❌ Rejected</option>
          </select>
          <button class="delete-alumni-btn" data-id="${item.id}"
            style="background:none;border:1px solid var(--terracotta-500);color:var(--terracotta-500);padding:.25rem .65rem;border-radius:6px;font-size:.75rem;cursor:pointer;">
            🗑 Delete
          </button>
        </div>`;
      alumniList.appendChild(row);
    });

    alumniList.querySelectorAll(".status-select-alumni").forEach(sel => {
      sel.addEventListener("change", async (e) => {
        e.target.disabled = true;
        try {
          await updateDoc(doc(db, "alumni", e.target.dataset.id), { status: e.target.value, reviewedAt: new Date() });
          e.target.style.borderColor = "var(--leaf-500)";
        } catch (err) { console.error("[Admin] update failed:", err); alert("Something went wrong. Please try again."); }
        finally { e.target.disabled = false; }
      });
    });

    alumniList.querySelectorAll(".delete-alumni-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("Permanently delete this alumni profile?")) return;
        btn.disabled = true;
        try {
          await deleteDoc(doc(db, "alumni", btn.dataset.id));
          loadAlumni();
        } catch (err) { alert("Failed: " + err.message); btn.disabled = false; }
      });
    });

  } catch (err) {
    console.error("[Admin] loadAlumni failed:", err);
    alumniList.innerHTML = `<p style="color:var(--terracotta-500);">Failed to load alumni: ${err.message}</p>`;
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
      if (collectionName === "alumni") loadAlumni();
    } catch (err) {
      console.error("[Admin] danger zone failed:", err); dangerResult.textContent = "❌ Something went wrong. Please try again.";
      dangerResult.style.color = "var(--terracotta-500)";
      dangerResult.classList.remove("hidden");
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });
});
