// js/timeline.js
// Renders the academic calendar as a table (Activities | Dates | Marks | Remarks),
// reading from Firestore collection "timeline". Events are added via Firebase
// Console directly. Rows for the active term are sorted by date; rows with no
// date (e.g. ongoing assessments) are pinned to the bottom.

const db = firebase.firestore();

let allEvents = [];

// ---------- Helpers ----------

function parseDate(str) {
  if (!str) return null;
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDateRange(startStr, endStr) {
  if (!startStr) return "Throughout semester";
  const start = parseDate(startStr);
  const opts = { day: "numeric", month: "short", year: "numeric" };
  if (!endStr || endStr === startStr) {
    return start.toLocaleDateString("en-GB", opts);
  }
  const end = parseDate(endStr);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  if (sameMonth) {
    return `${start.getDate()}–${end.getDate()} ${start.toLocaleDateString("en-GB", { month: "short", year: "numeric" })}`;
  }
  return `${start.toLocaleDateString("en-GB", opts)} – ${end.toLocaleDateString("en-GB", opts)}`;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = parseDate(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

function getRowStatus(ev) {
  if (!ev.startDate) return null;
  const startDays = daysUntil(ev.startDate);
  const endDays = daysUntil(ev.endDate || ev.startDate);
  if (startDays <= 0 && endDays >= 0) return "today";   // ongoing right now, includes today
  if (startDays > 0) return "upcoming";
  return "past";
}

// ---------- Fetch ----------

async function loadEvents() {
  try {
    const snap = await db.collection("timeline").get();
    allEvents = snap.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        title: data.title || "Untitled",
        category: data.category || "other",
        term: data.term || "General",
        startDate: data.startDate || null,
        endDate: data.endDate || data.startDate || null,
        marks: data.marks || "",
        remarks: data.remarks || ""
      };
    });
    populateTermFilter();
    renderTable();
  } catch (err) {
    console.error("Failed to load calendar:", err);
    document.getElementById("calendarTableBody").innerHTML =
      `<tr><td colspan="4" class="timeline-error">Couldn't load the calendar right now. Please try again later.</td></tr>`;
  }
}

function populateTermFilter() {
  const termSelect = document.getElementById("termFilter");
  const terms = [...new Set(allEvents.map(ev => ev.term))].sort();
  terms.forEach(term => {
    const opt = document.createElement("option");
    opt.value = term;
    opt.textContent = term;
    termSelect.appendChild(opt);
  });
  if (terms.length === 1) {
    document.getElementById("calendarSubtitle").textContent = terms[0];
  }
}

function getFilteredEvents() {
  const term = document.getElementById("termFilter").value;
  return allEvents
    .filter(ev => term === "all" || ev.term === term)
    .sort((a, b) => {
      if (!a.startDate && !b.startDate) return 0;
      if (!a.startDate) return 1;   // no-date rows sink to bottom
      if (!b.startDate) return -1;
      return parseDate(a.startDate) - parseDate(b.startDate);
    });
}

// ---------- Render ----------

function renderTable() {
  const events = getFilteredEvents();
  const tbody = document.getElementById("calendarTableBody");
  const emptyMsg = document.getElementById("timelineEmpty");
  tbody.innerHTML = "";

  if (events.length === 0) {
    emptyMsg.hidden = false;
    return;
  }
  emptyMsg.hidden = true;

  // Find the next upcoming row to flag as "Up Next"
  const upcoming = events.filter(ev => getRowStatus(ev) === "upcoming");
  const nextId = upcoming.length ? upcoming[0].id : null;

  events.forEach((ev, index) => {
    const status = getRowStatus(ev);
    const isHighlightCategory = ev.category === "midterm" || ev.category === "final";

    const tr = document.createElement("tr");
    tr.className = `cal-row cat-${ev.category}` +
      (status === "today" ? " row-today" : "") +
      (status === "past" ? " row-past" : "");
    tr.style.setProperty("--stagger", `${Math.min(index, 12) * 40}ms`);

    let badge = "";
    if (status === "today") {
      badge = `<span class="row-badge badge-today">Today</span>`;
    } else if (ev.id === nextId) {
      const d = daysUntil(ev.startDate);
      badge = `<span class="row-badge badge-next">${d === 1 ? "Tomorrow" : d + " days left"}</span>`;
    }

    tr.innerHTML = `
      <td class="col-activity${isHighlightCategory ? " highlight-activity" : ""}">
        ${ev.title}${badge}
      </td>
      <td class="col-dates">${formatDateRange(ev.startDate, ev.endDate)}</td>
      <td class="col-marks${isHighlightCategory ? " highlight-marks" : ""}">${ev.marks || ""}</td>
      <td class="col-remarks">${ev.remarks || ""}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ---------- Events ----------

document.getElementById("termFilter").addEventListener("change", renderTable);

// ---------- Daily auto-refresh ----------

function msUntilNextMidnight() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  return next - now;
}

function scheduleDailyRefresh() {
  setTimeout(() => {
    renderTable();
    scheduleDailyRefresh();
  }, msUntilNextMidnight());
}

// ---------- Init ----------

loadEvents();
scheduleDailyRefresh();
