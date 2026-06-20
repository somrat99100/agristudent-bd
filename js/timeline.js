document.addEventListener("DOMContentLoaded", () => {
    // 1. Establish precise live system execution parameters (June 2026 Context)
    const liveNow = new Date();
    
    // 2. Map absolute structural schedules parameters
    const examSchedules = {
        midterm: { 
            start: new Date("2026-07-01T00:00:00"), 
            end: new Date("2026-07-08T23:59:59"), 
            scale: 30, ringId: "ring-midterm", txtId: "count-midterm", lblId: "label-midterm", cardId: "card-midterm" 
        },
        ct: { 
            start: new Date("2026-08-02T00:00:00"), 
            end: new Date("2026-08-08T23:59:59"), 
            scale: 30, ringId: "ring-ct", txtId: "count-ct", lblId: "label-ct", cardId: "card-ct" 
        },
        final: { 
            start: new Date("2026-09-10T00:00:00"), 
            end: new Date("2026-09-17T23:59:59"), 
            scale: 45, ringId: "ring-final", txtId: "count-final", lblId: "label-final", cardId: "card-final" 
        }
    };

    let nearestUpcomingExamDate = null;
    let baselineDiff = Infinity;

    // 3. Process Live Metrics Status Logic Engine
    Object.keys(examSchedules).forEach(key => {
        const exam = examSchedules[key];
        const cardNode = document.getElementById(exam.cardId);
        const textNode = document.getElementById(exam.txtId);
        const labelNode = document.getElementById(exam.lblId);
        const ringNode = document.getElementById(exam.ringId);
        
        const circ = 2 * Math.PI * 58; // Radius 58 calculation = 364.42 circumference

        if (liveNow >= exam.start && liveNow <= exam.end) {
            // STATE B: Exam is happening today/running right now
            if(cardNode) cardNode.classList.add("ongoing-mode");
            if(textNode) textNode.innerText = "ACTIVE";
            if(labelNode) labelNode.innerText = "ONGOING NOW";
            if(ringNode) ringNode.style.strokeDashoffset = 0; 
        } 
        else if (liveNow > exam.end) {
            // STATE C: Target completed
            if(textNode) textNode.innerText = "DONE";
            if(labelNode) labelNode.innerText = "COMPLETED";
            if(ringNode) ringNode.style.strokeDashoffset = circ; 
        } 
        else {
            // STATE A: Countdown tracking configuration modes
            const timeDiff = exam.start - liveNow;
            const daysRemaining = Math.max(0, Math.ceil(timeDiff / (1000 * 60 * 60 * 24)));
            
            if(textNode) textNode.innerText = daysRemaining;
            if(labelNode) labelNode.innerText = "Days Left";

            if (ringNode) {
                const percentLeft = Math.min(100, Math.max(0, (daysRemaining / exam.scale) * 100));
                const offset = circ - (percentLeft / 100) * circ;
                setTimeout(() => { ringNode.style.strokeDashoffset = offset; }, 300);
            }

            if (timeDiff < baselineDiff) {
                baselineDiff = timeDiff;
                nearestUpcomingExamDate = exam.start;
            }
        }
    });

    // 4. Generate the real-life system dynamic monthly calendar grid view
    renderRealtimeCalendarGrid(liveNow, nearestUpcomingExamDate);
});

function renderRealtimeCalendarGrid(currentDate, pathTargetDate) {
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    
    const mountHeader = document.getElementById("calendar-month-year");
    const gridContainer = document.getElementById("calendar-days-container");
    if (!gridContainer || !mountHeader) return;

    const currentYear = currentDate.getFullYear();
    const currentMonthIdx = currentDate.getMonth();

    // Display localized current real month heading dynamically
    mountHeader.innerText = `${months[currentMonthIdx]} ${currentYear}`;
    gridContainer.innerHTML = "";

    // Generate accurate weekday baseline indexes mapping parameters
    const originalFirstDayIndex = new Date(currentYear, currentMonthIdx, 1).getDay();
    const totalDaysInMonth = new Date(currentYear, currentMonthIdx + 1, 0).getDate();

    // structural alignment spacers mapping blocks loops execution
    for (let pad = 0; pad < originalFirstDayIndex; pad++) {
        const nullCell = document.createElement("div");
        nullCell.classList.add("day-node");
        gridContainer.appendChild(nullCell);
    }

    // Paint true calendar day numerical nodes
    for (let dayNum = 1; dayNum <= totalDaysInMonth; dayNum++) {
        const dayCell = document.createElement("div");
        dayCell.classList.add("day-node");
        dayCell.innerText = dayNum;

        const dateInstance = new Date(currentYear, currentMonthIdx, dayNum, 0, 0, 0);
        const normalizeTodayComparison = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());

        // Highlight actual live day vs distance tracking route path intervals configurations
        if (currentDate.getDate() === dayNum && currentDate.getMonth() === currentMonthIdx) {
            dayCell.classList.add("node-today");
        } else if (pathTargetDate && dateInstance > normalizeTodayComparison && dateInstance <= pathTargetDate) {
            dayCell.classList.add("node-track-path");
        }

        gridContainer.appendChild(dayCell);
    }
}
