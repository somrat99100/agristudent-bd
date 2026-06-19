// js/timeline.js
// Reads from Firestore collection "timeline". No write access needed from
// the client — events are added directly via Firebase Console for now.

const db = firebase.firestore();

let allEvents = [];      // raw events from Firestore, normalized
let currentView = "list";
let calendarMonth = new Date().getMonth();
let calendarYear = new Date().getFullYear();

const CATEGORY_LABELS = {
  registration: "Registration",
  class: "Class",
  midterm: "Midterm",
  final: "Final",
  result: "Result",
  holiday: "Holiday",
  other: "Other"
};

// ---------- Helpers ----------

function parseDate(str) {
  // Expects "YYYY-MM-DD"
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDateRange(startStr, endStr) {
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
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = parseDate(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

function eventIsUpcoming(ev) {
  const endStr = ev.endDate || ev.startDate;
  return daysUntil(endStr) >= 0;
}

// ---------- Fetch ----------

async function loadEvents() {
  try {
    const snap = await db.collection("timeline").get();
    allEvents = snap.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        title: data.title || "Untitled Event",
        description: data.description || "",
        category: data.category || "other",
        term: data.term || "General",
        startDate: data.startDate,
        endDate: data.endDate || data.startDate
      };
    });

    populateTermFilter();
    renderCurrentView();
  } catch (err) {
    console.error("Failed to load timeline events:", err);
    document.getElementById("timelineList").innerHTML =
      `<p class="timeline-error">Couldn't load the timeline right now. Please try again later.</p>`;
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
}

function getFilteredEvents() {
  const term = document.getElementById("termFilter").value;
  const category = document.getElementById("categoryFilter").value;

  return allEvents
    .filter(ev => term === "all" || ev.term === term)
    .filter(ev => category === "all" || ev.category === category)
    .sort((a, b) => parseDate(a.startDate) - parseDate(b.startDate));
}

// ---------- List View ----------

function renderListView() {
  const events = getFilteredEvents();
  const listEl = document.getElementById("timelineList");
  const emptyEl = document.getElementById("timelineEmpty");
  const nextCard = document.getElementById("nextEventCard");

  listEl.innerHTML = "";

  if (events.length === 0) {
    emptyEl.hidden = false;
    nextCard.hidden = true;
    return;
  }
  emptyEl.hidden = true;

  // Next upcoming event (closest future event, any category/term within filter)
  const upcoming = events.filter(eventIsUpcoming);
  if (upcoming.length > 0) {
    const next = upcoming[0];
    const days = daysUntil(next.startDate);
    nextCard.hidden = false;
    document.getElementById("nextEventTitle").textContent = next.title;
    document.getElementById("nextEventDate").textContent = formatDateRange(next.startDate, next.endDate);
    document.getElementById("nextEventCountdown").textContent =
      days === 0 ? "Today!" : days === 1 ? "Tomorrow" : `In ${days} days`;
  } else {
    nextCard.hidden = true;
  }

  events.forEach(ev => {
    const isPast = !eventIsUpcoming(ev);
    const item = document.createElement("div");
    item.className = `timeline-item cat-${ev.category}${isPast ? " is-past" : ""}`;

    let badge = "";
    if (isPast) {
      badge = `<span class="day-badge badge-done">Completed</span>`;
    } else {
      const startDays = daysUntil(ev.startDate);
      const endDays = daysUntil(ev.endDate || ev.startDate);
      if (startDays <= 0 && endDays >= 0) {
        badge = `<span class="day-badge badge-live">Ongoing</span>`;
      } else if (startDays === 0) {
        badge = `<span class="day-badge badge-soon">Today</span>`;
      } else if (startDays === 1) {
        badge = `<span class="day-badge badge-soon">Tomorrow</span>`;
      } else {
        badge = `<span class="day-badge">${startDays} days left</span>`;
      }
    }

    item.innerHTML = `
      <div class="timeline-dot"></div>
      <div class="timeline-content">
        <div class="timeline-content-top">
          <span class="timeline-tag">${CATEGORY_LABELS[ev.category] || "Other"} · ${ev.term}</span>
          ${badge}
        </div>
        <h4>${ev.title}</h4>
        <p class="timeline-date">${formatDateRange(ev.startDate, ev.endDate)}</p>
        ${ev.description ? `<p class="timeline-desc">${ev.description}</p>` : ""}
      </div>
    `;
    listEl.appendChild(item);
  });
}

// ---------- Calendar View ----------

function renderCalendarView() {
  const grid = document.getElementById("calendarGrid");
  const label = document.getElementById("calendarMonthLabel");
  const details = document.getElementById("calendarDayDetails");
  details.hidden = true;
  grid.innerHTML = "";

  const monthDate = new Date(calendarYear, calendarMonth, 1);
  label.textContent = monthDate.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  const firstDayIndex = monthDate.getDay(); // 0 = Sunday
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  dayNames.forEach(d => {
    const head = document.createElement("div");
    head.className = "calendar-day-header";
    head.textContent = d;
    grid.appendChild(head);
  });

  for (let i = 0; i < firstDayIndex; i++) {
    grid.appendChild(document.createElement("div"));
  }

  const events = getFilteredEvents();

  // Find the closest upcoming event (today or later) to draw the
  // "today → next event" countdown path on the calendar.
  const todayDate = new Date();
  todayDate.setHours(0, 0, 0, 0);
  const upcomingSorted = events
    .filter(eventIsUpcoming)
    .sort((a, b) => parseDate(a.startDate) - parseDate(b.startDate));
  const nextEvent = upcomingSorted[0] || null;
  const pathEnd = nextEvent ? parseDate(nextEvent.startDate) : null;

  for (let day = 1; day <= daysInMonth; day++) {
    const cellDate = new Date(calendarYear, calendarMonth, day);
    const cellEvents = events.filter(ev => {
      const start = parseDate(ev.startDate);
      const end = parseDate(ev.endDate || ev.startDate);
      return cellDate >= start && cellDate <= end;
    });

    const cell = document.createElement("div");
    cell.className = "calendar-cell" + (cellEvents.length ? " has-events" : "");

    const isToday = todayDate.toDateString() === cellDate.toDateString();
    if (isToday) cell.classList.add("is-today");

    if (pathEnd && cellDate >= todayDate && cellDate <= pathEnd) {
      cell.classList.add("countdown-path");
      if (cellDate.toDateString() === pathEnd.toDateString()) {
        cell.classList.add("countdown-target");
      }
    }

    let dotsHtml = "";
    cellEvents.slice(0, 3).forEach(ev => {
      dotsHtml += `<span class="cal-dot cat-${ev.category}" title="${ev.title}"></span>`;
    });
    if (cellEvents.length > 3) {
      dotsHtml += `<span class="cal-more">+${cellEvents.length - 3}</span>`;
    }

    cell.innerHTML = `<span class="cal-day-num">${day}</span><div class="cal-dots">${dotsHtml}</div>`;

    if (cellEvents.length) {
      cell.addEventListener("click", () => showDayDetails(cellDate, cellEvents));
    }

    grid.appendChild(cell);
  }
}

function showDayDetails(date, events) {
  const details = document.getElementById("calendarDayDetails");
  details.hidden = false;
  const dateLabel = date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  details.innerHTML = `
    <h4>${dateLabel}</h4>
    ${events.map(ev => `
      <div class="calendar-day-event cat-${ev.category}">
        <span class="timeline-tag">${CATEGORY_LABELS[ev.category] || "Other"} · ${ev.term}</span>
        <strong>${ev.title}</strong>
        ${ev.description ? `<p>${ev.description}</p>` : ""}
      </div>
    `).join("")}
  `;
}

// ---------- View switching ----------

function renderCurrentView() {
  if (currentView === "list") {
    document.getElementById("listView").hidden = false;
    document.getElementById("calendarView").hidden = true;
    renderListView();
  } else {
    document.getElementById("listView").hidden = true;
    document.getElementById("calendarView").hidden = false;
    renderCalendarView();
  }
}

// ---------- Event listeners ----------

document.getElementById("listViewBtn").addEventListener("click", () => {
  currentView = "list";
  document.getElementById("listViewBtn").classList.add("active");
  document.getElementById("calendarViewBtn").classList.remove("active");
  renderCurrentView();
});

document.getElementById("calendarViewBtn").addEventListener("click", () => {
  currentView = "calendar";
  document.getElementById("calendarViewBtn").classList.add("active");
  document.getElementById("listViewBtn").classList.remove("active");
  renderCurrentView();
});

document.getElementById("termFilter").addEventListener("change", renderCurrentView);
document.getElementById("categoryFilter").addEventListener("change", renderCurrentView);

document.getElementById("prevMonth").addEventListener("click", () => {
  calendarMonth--;
  if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
  renderCalendarView();
});

document.getElementById("nextMonth").addEventListener("click", () => {
  calendarMonth++;
  if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
  renderCalendarView();
});

// ---------- Daily auto-refresh ----------
// Re-renders at the next local midnight so "today" and the countdown path
// move forward automatically if the page is left open overnight.

function msUntilNextMidnight() {
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  return nextMidnight - now;
}

function scheduleDailyRefresh() {
  setTimeout(() => {
    renderCurrentView();
    scheduleDailyRefresh();
  }, msUntilNextMidnight());
}

// ---------- Init ----------

loadEvents();
scheduleDailyRefresh();
