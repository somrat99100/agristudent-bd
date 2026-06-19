import { db } from "./firebase-config.js";
import {
  collection, getDocs, doc, updateDoc, orderBy, query
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ADMIN_PASSWORD = "agri2026"; // ⚠️ change this, and replace with real auth in Phase 8

const gate = document.getElementById("admin-gate");
const panel = document.getElementById("admin-panel");
const pwInput = document.getElementById("admin-password");
const pwBtn = document.getElementById("admin-unlock");
const pwError = document.getElementById("admin-pw-error");
const list = document.getElementById("admin-resource-list");

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
