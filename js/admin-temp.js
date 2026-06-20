import { db } from "./firebase-config.js";
import {
  collection, getDocs, doc, updateDoc, deleteDoc, addDoc, orderBy, query, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ADMIN_PASSWORD = "agri2026"; // ⚠️ change this, and replace with real auth in Phase 8

const gate = document.getElementById("admin-gate");
const panel = document.getElementById("admin-panel");
const pwInput = document.getElementById("admin-password");
const pwBtn = document.getElementById("admin-unlock");
const pwError = document.getElementById("admin-pw-error");
const list = document.getElementById("admin-resource-list");
const termList = document.getElementById("admin-term-list");
const timelineList = document.getElementById("admin-timeline-list");

const tabResources = document.getElementById("tab-resources");
const tabTerms = document.getElementById("tab-terms");
const tabTimeline = document.getElementById("tab-timeline");
const resourcesPanel = document.getElementById("resources-panel");
const termsPanel = document.getElementById("terms-panel");
const timelinePanel = document.getElementById("timeline-panel");

function setActiveTab(activeBtn) {
  [tabResources, tabTerms, tabTimeline].forEach(btn => {
    const isActive = btn === activeBtn;
    btn.style.background = isActive ? "var(--moss-700)" : "";
    btn.style.color = isActive ? "#fff" : "";
  });
  resourcesPanel.classList.toggle("hidden", activeBtn !== tabResources);
  termsPanel.classList.toggle("hidden", activeBtn !== tabTerms);
  timelinePanel.classList.toggle("hidden", activeBtn !== tabTimeline);
}

tabResources.addEventListener("click", () => setActiveTab(tabResources));
tabTerms.addEventListener("click", () => { setActiveTab(tabTerms); loadTerms(); });
tabTimeline.addEventListener("click", () => { setActiveTab(tabTimeline); loadTimeline(); });

pwBtn.addEventListener("click", () => {
  if (pwInput.value === ADMIN_PASSWORD) {
    gate.classList.add("hidden");
    panel.classList.remove("hidden");
    loadResources();
  } else {
    pwError.classList.remove("hidden");
  }
});

async function loadResources() {
  list.innerHTML = `<p style="color:var(--moss-600);">Loading…</p>`;
  const q = query(collection(db, "resources"), orderBy("submittedAt", "desc"));
  const snap = await getDocs(q);

  if (snap.empty) {
    list.innerHTML = `<p style="color:var(--moss-600);">No resources submitted yet.</p>`;
    return;
  }

  list.innerHTML = "";
  snap.forEach(d => {
    const item = d.data();
    const row = document.createElement("div");
    row.className = "resource-row";
    row.innerHTML = `
      <div>
        <strong>${item.courseCode} — ${item.courseName || ""}</strong>
        <div style="font-size:.8rem;color:var(--moss-600);">
          ${item.resourceType === "previous_questions" ? "📝 Previous Question" : "📚 Slides & Notes"}
          ${item.examType ? " · " + item.examType : ""} · ${item.facultyName || ""}
        </div>
        <div style="font-size:.78rem;color:var(--moss-600);margin-top:.2rem;">
          Uploaded by: ${item.uploaderName || "—"} (${item.uploaderEmail || "no email"})
        </div>
        <div style="margin-top:.4rem;">
          ${(item.fileUrls || []).map(f => `<a href="${f.url}" target="_blank" rel="noopener" style="font-size:.78rem;color:var(--leaf-500);">${f.name}</a>`).join(" · ")}
        </div>
      </div>
      <div>
        <select data-id="${d.id}" class="status-select">
          <option value="pending" ${item.status === "pending" ? "selected" : ""}>🕓 Pending</option>
          <option value="approved" ${item.status === "approved" ? "selected" : ""}>✅ Approved</option>
          <option value="rejected" ${item.status === "rejected" ? "selected" : ""}>❌ Rejected</option>
        </select>
      </div>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll(".status-select").forEach(sel => {
    sel.addEventListener("change", async (e) => {
      const id = e.target.dataset.id;
      const newStatus = e.target.value;
      e.target.disabled = true;
      try {
        await updateDoc(doc(db, "resources", id), { status: newStatus, reviewedAt: new Date() });
        e.target.style.borderColor = "var(--leaf-500)";
      } catch (err) {
        alert("Failed to update: " + err.message);
      } finally {
        e.target.disabled = false;
      }
    });
  });
}

// ============================================
// TERMS REVIEW
// ============================================
async function loadTerms() {
  termList.innerHTML = `<p style="color:var(--moss-600);">Loading…</p>`;
  const q = query(collection(db, "terms"), orderBy("submittedAt", "desc"));
  const snap = await getDocs(q);

  if (snap.empty) {
    termList.innerHTML = `<p style="color:var(--moss-600);">No terms submitted yet.</p>`;
    return;
  }

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
      </div>
    `;
    termList.appendChild(row);
  });

  termList.querySelectorAll(".status-select-term").forEach(sel => {
    sel.addEventListener("change", async (e) => {
      const id = e.target.dataset.id;
      const newStatus = e.target.value;
      e.target.disabled = true;
      try {
        await updateDoc(doc(db, "terms", id), { status: newStatus, reviewedAt: new Date() });
        e.target.style.borderColor = "var(--leaf-500)";
      } catch (err) {
        alert("Failed to update: " + err.message);
      } finally {
        e.target.disabled = false;
      }
    });
  });
}

// ============================================
// TIMELINE MANAGEMENT
// ============================================
const TYPE_LABELS = {
  registration: "Registration",
  advising: "Advising",
  add_drop: "Add/Drop Deadline",
  class_test: "Class Test",
  midterm: "Midterm Examination",
  final: "Final Examination",
  break: "Semester Break",
  semester_end: "Semester Ends"
};

document.getElementById("add-event-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("event-title").value.trim();
  const dateVal = document.getElementById("event-date").value;
  const endDateVal = document.getElementById("event-end-date").value;
  const type = document.getElementById("event-type").value;
  if (!title || !dateVal) return;

  try {
    const docData = {
      title,
      date: Timestamp.fromDate(new Date(dateVal + "T00:00:00")),
      type,
      createdAt: new Date()
    };
    if (endDateVal) {
      docData.endDate = Timestamp.fromDate(new Date(endDateVal + "T23:59:59"));
    }
    await addDoc(collection(db, "timeline"), docData);
    document.getElementById("event-title").value = "";
    document.getElementById("event-date").value = "";
    document.getElementById("event-end-date").value = "";
    loadTimeline();
  } catch (err) {
    alert("Failed to add event: " + err.message);
  }
});

async function loadTimeline() {
  timelineList.innerHTML = `<p style="color:var(--moss-600);">Loading…</p>`;
  const q = query(collection(db, "timeline"), orderBy("date", "asc"));
  const snap = await getDocs(q);

  if (snap.empty) {
    timelineList.innerHTML = `<p style="color:var(--moss-600);">No events added yet — use the form above.</p>`;
    return;
  }

  timelineList.innerHTML = "";
  snap.forEach(d => {
    const item = d.data();
    const dateObj = item.date?.toDate ? item.date.toDate() : new Date(item.date);
    const endObj = item.endDate ? (item.endDate.toDate ? item.endDate.toDate() : new Date(item.endDate)) : null;
    const dateLabel = endObj
      ? `${dateObj.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })} → ${endObj.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}`
      : dateObj.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
    const row = document.createElement("div");
    row.className = "resource-row";
    row.innerHTML = `
      <div>
        <strong>${item.title}</strong>
        <div style="font-size:.8rem;color:var(--moss-600);">
          ${dateLabel} · ${TYPE_LABELS[item.type] || item.type}
        </div>
      </div>
      <button data-id="${d.id}" class="delete-event-btn" style="background:none;border:1px solid var(--terracotta-500);color:var(--terracotta-500);padding:.4rem .8rem;border-radius:6px;cursor:pointer;font-size:.8rem;">🗑 Delete</button>
    `;
    timelineList.appendChild(row);
  });

  timelineList.querySelectorAll(".delete-event-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this event?")) return;
      try {
        await deleteDoc(doc(db, "timeline", btn.dataset.id));
        loadTimeline();
      } catch (err) {
        alert("Failed to delete: " + err.message);
      }
    });
  });
}
