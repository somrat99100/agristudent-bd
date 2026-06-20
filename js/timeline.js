document.addEventListener("DOMContentLoaded", () => {
  // Target Event Deadlines (Based on your system date: June 20, 2026)
  const currentSystemDate = new Date("2026-06-20");
  
  const dates = {
    midterm: { start: new Date("2026-07-01"), end: new Date("2026-07-08"), totalDays: 30, circleId: "midterm-circle", txtId: "midterm-days" },
    ct: { start: new Date("2026-08-02"), end: new Date("2026-08-08"), totalDays: 60, circleId: "ct-circle", txtId: "ct-days" },
    final: { start: new Date("2026-08-02"), end: new Date("2026-08-08"), totalDays: 60, circleId: "final-circle", txtId: "final-days" }
  };

  // 1. Calculate and animate countdown rings
  Object.keys(dates).forEach(key => {
    const event = dates[key];
    const diffTime = event.start - currentSystemDate;
    const daysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    
    // Update text
    document.getElementById(event.txtId).innerText = daysRemaining;

    // Animate filled circle calculations
    const circle = document.getElementById(event.circleId);
    const radius = circle.r.baseVal.value;
    const circumference = radius * 2 * Math.PI;
    
    circle.style.strokeDasharray = `${circumference} ${circumference}`;
    
    // Percent filled decreases as time runs out
    const percentLeft = Math.min(100, Math.max(0, (daysRemaining / event.totalDays) * 100));
    const offset = circumference - (percentLeft / 100) * circumference;
    
    setTimeout(() => {
      circle.style.strokeDashoffset = offset;
    }, 150);
  });

  // 2. Render July 2026 Calendar dynamically with precise highlighting logic
  renderJuly2026(currentSystemDate, dates.midterm.start);
});

function renderJuly2026(today, targetEventStart) {
  const container = document.getElementById("calendar-days-container");
  container.innerHTML = "";

  // July 2026 starts on a Wednesday (3 blank offset padding slots)
  for (let i = 0; i < 3; i++) {
    const blank = document.createElement("div");
    blank.classList.add("day");
    container.appendChild(blank);
  }

  // Generate 31 days of July
  for (let dayNum = 1; dayNum <= 31; dayNum++) {
    const dayDiv = document.createElement("div");
    dayDiv.classList.add("day");
    dayDiv.innerText = dayNum;

    const checkingDate = new Date(`2026-07-${dayNum.toString().padStart(2, '0')}`);

    // Highlighting Logic Rules
    if (today.getMonth() === 6 && today.getDate() === dayNum) {
      dayDiv.classList.add("today"); // Today's date highlighted
    } else if (checkingDate > today && checkingDate <= targetEventStart) {
      dayDiv.classList.add("upcoming-range"); // From today until most recent event in unified style
    }

    container.appendChild(dayDiv);
  }
}
