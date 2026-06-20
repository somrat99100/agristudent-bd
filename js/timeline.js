import { db } from "./firebase-config.js";
import { collection, getDocs, query, orderBy, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Exam-ring card config per type. "scale" = the day-count that represents a
// "full" ring (i.e. how many days out counts as 0% progress).
const EXAM_RING_CONFIG = {
  midterm: { label: "Mid Term Exam", scale: 30, fillClass: "fill-midterm", tagClass: "tag-midterm" },
  class_test: { label: "Class Tests", scale: 30, fillClass: "fill-ct", tagClass: "tag-ct" },
  final: { label: "Final Exam", scale: 45, fillClass: "fill-final", tagClass: "tag-final" }
};

const OTHER_TYPE_COLORS = {
  registration: "#6B9B5E",
  advising: "#D4A24C",
  add_drop: "#8E6BAE",
  break: "#8A8A8A",
  semester_end: "#8A8A8A"
};
const OTHER_TYPE_LABELS = {
  registration: "Registration",
  advising: "Advising",
  add_drop: "Add/Drop Deadline",
  break: "Semester Break",
  semester_end: "Semester Ends"
};

function toDate(val) {
  if (!val) return null;
  return val.toDate ? val.toDate() : new Date(val);
}
function formatRange(start, end) {
  const opts = { day: "2-digit", month: "long", year: "numeric" };
  if (!end || end.toDateString() === start.toDateString()) {
    return start.toLocaleDateString("en-GB", opts);
  }
  return `${start.toLocaleDateString("en-GB", opts)} to ${end.toLocaleDateString("en-GB", opts)}`;
}

async function loadSemesterLabel() {
  try {
    const snap = await getDoc(doc(db, "settings", "semester"));
    document.getElementById("semester-label").textContent =
      snap.exists() && snap.data().label ? snap.data().label : "Current Semester";
  } catch {
    document.getElementById("semester-label").textContent = "Current Semester";
  }
}

async function loadAll() {
  loadSemesterLabel();

  const q = query(collection(db, "timeline"), orderBy("date", "asc"));
  const snap = await getDocs(q);
  const events = snap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      title: data.title,
      type: data.type,
      start: toDate(data.date),
      end: data.endDate ? toDate(data.endDate) : toDate(data.date)
    };
  });

  renderExamRings(events);
  renderCalendar(events);
  renderOtherDates(events);
}

// ============================================
// EXAM RING CARDS (midterm / class_test / final)
// ============================================
function renderExamRings(events) {
  const stack = document.getElementById("exam-trackers-stack");
  const now = new Date();
  const circ = 2 * Math.PI * 58;

  const examTypes = Object.keys(EXAM_RING_CONFIG);
  const cardsHtml = [];
  let nearestUpcoming = null;

  examTypes.forEach(type => {
    const matches = events.filter(e => e.type === type);
    if (matches.length === 0) return; // skip card entirely if admin hasn't added this type yet

    // pick the soonest one that hasn't ended yet, or the most recent past one
    const upcoming = matches.filter(e => e.end >= now).sort((a, b) => a.start - b.start)[0];
    const exam = upcoming || matches[matches.length - 1];
    const cfg = EXAM_RING_CONFIG[type];

    let valueText, subText, ringOffset, ongoing = false;

    if (now >= exam.start && now <= exam.end) {
      ongoing = true;
      valueText = "ACTIVE";
      subText = "ONGOING NOW";
      ringOffset = 0;
    } else if (now > exam.end) {
      valueText = "DONE";
      subText = "COMPLETED";
      ringOffset = circ;
    } else {
      const daysRemaining = Math.max(0, Math.ceil((exam.start - now) / (1000 * 60 * 60 * 24)));
      valueText = daysRemaining;
      subText = "Days Left";
      const percentLeft = Math.min(100, Math.max(0, (daysRemaining / cfg.scale) * 100));
      ringOffset = circ - (percentLeft / 100) * circ;
      if (!nearestUpcoming || exam.start < nearestUpcoming) nearestUpcoming = exam.start;
    }

    cardsHtml.push(`
      <div class="exam-countdown-card card-panel animate-fade-up ${ongoing ? "ongoing-mode" : ""}">
        <h3 class="exam-card-title">${exam.title || cfg.label}</h3>
        <div class="exam-date-tag ${cfg.tagClass}">${formatRange(exam.start, exam.end)}</div>
        <div class="progress-ring-box">
          <svg class="ring-svg" width="140" height="140">
            <circle class="ring-track-bg" cx="70" cy="70" r="58" />
            <circle class="ring-track-fill ${cfg.fillClass}" cx="70" cy="70" r="58" style="stroke-dashoffset:${circ};" data-final-offset="${ringOffset}"></circle>
          </svg>
          <div class="ring-inner-label">
            <span class="days-value">${valueText}</span>
            <span class="days-sub">${subText}</span>
          </div>
        </div>
      </div>
    `);
  });

  if (cardsHtml.length === 0) {
    stack.innerHTML = `<p style="color:var(--text-muted);font-family:'JetBrains Mono',monospace;font-size:.85rem;text-align:center;">No exam dates added yet — check back soon.</p>`;
    return;
  }

  stack.innerHTML = cardsHtml.join("");

  // animate rings in after paint, same as the original design
  setTimeout(() => {
    stack.querySelectorAll(".ring-track-fill").forEach(ring => {
      ring.style.strokeDashoffset = ring.dataset.finalOffset;
    });
  }, 300);

  window._nearestExamDate = nearestUpcoming;
}

// ============================================
// CALENDAR (current month, today + distance-track highlighting)
// ============================================
function renderCalendar(events) {
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const mountHeader = document.getElementById("calendar-month-year");
  const gridContainer = document.getElementById("calendar-days-container");
  if (!gridContainer || !mountHeader) return;

  const now = new Date();
  const year = now.getFullYear();
  const monthIdx = now.getMonth();
  const todayNum = now.getDate();

  mountHeader.innerText = `${months[monthIdx]} ${year}`;
  gridContainer.innerHTML = "";

  const firstDayIndex = new Date(year, monthIdx, 1).getDay();
  const totalDays = new Date(year, monthIdx + 1, 0).getDate();

  for (let pad = 0; pad < firstDayIndex; pad++) {
    const cell = document.createElement("div");
    cell.classList.add("day-node", "empty-node");
    gridContainer.appendChild(cell);
  }

  const normalizedToday = new Date(year, monthIdx, todayNum, 0, 0, 0);
  const pathTarget = window._nearestExamDate || null;

  for (let day = 1; day <= totalDays; day++) {
    const cell = document.createElement("div");
    cell.classList.add("day-node");
    cell.innerText = day;
    const dateInstance = new Date(year, monthIdx, day, 0, 0, 0);

    if (day === todayNum) {
      cell.classList.add("node-today");
    } else if (pathTarget && dateInstance > normalizedToday && dateInstance <= pathTarget) {
      cell.classList.add("node-track-path");
    }
    gridContainer.appendChild(cell);
  }
}

// ============================================
// OTHER DATES LIST (registration, advising, add/drop, break, semester end)
// ============================================
function renderOtherDates(events) {
  const list = document.getElementById("other-dates-list");
  const others = events.filter(e => OTHER_TYPE_LABELS[e.type]);

  if (others.length === 0) {
    list.innerHTML = `<li style="color:var(--moss-600);font-family:var(--font-mono);font-size:.85rem;">No other dates added yet.</li>`;
    return;
  }

  list.innerHTML = others.map(e => `
    <li>
      <span class="legend-dot" style="background:${OTHER_TYPE_COLORS[e.type] || '#999'};"></span>
      <div>
        <strong>${e.title}</strong>
        <span class="t-date">${formatRange(e.start, e.end)} · ${OTHER_TYPE_LABELS[e.type] || e.type}</span>
      </div>
    </li>
  `).join("");
}

loadAll();
