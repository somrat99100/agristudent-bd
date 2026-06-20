document.addEventListener("DOMContentLoaded", () => {
    const liveNow = new Date();
    
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

    Object.keys(examSchedules).forEach(key => {
        const exam = examSchedules[key];
        const cardNode = document.getElementById(exam.cardId);
        const textNode = document.getElementById(exam.txtId);
        const labelNode = document.getElementById(exam.lblId);
        const ringNode = document.getElementById(exam.ringId);
        
        const circ = 2 * Math.PI * 58; 

        if (liveNow >= exam.start && liveNow <= exam.end) {
            if(cardNode) cardNode.classList.add("ongoing-mode");
            if(textNode) textNode.innerText = "ACTIVE";
            if(labelNode) labelNode.innerText = "ONGOING NOW";
            if(ringNode) ringNode.style.strokeDashoffset = 0; 
        } 
        else if (liveNow > exam.end) {
            if(textNode) textNode.innerText = "DONE";
            if(labelNode) labelNode.innerText = "COMPLETED";
            if(ringNode) ringNode.style.strokeDashoffset = circ; 
        } 
        else {
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

    renderRealtimeCalendarGrid(liveNow, nearestUpcomingExamDate);
});

function renderRealtimeCalendarGrid(currentDate, pathTargetDate) {
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    
    const mountHeader = document.getElementById("calendar-month-year");
    const gridContainer = document.getElementById("calendar-days-container");
    if (!gridContainer || !mountHeader) return;

    const currentYear = currentDate.getFullYear();
    const currentMonthIdx = currentDate.getMonth();
    const todayDateNum = currentDate.getDate(); 

    mountHeader.innerText = `${months[currentMonthIdx]} ${currentYear}`;
    gridContainer.innerHTML = "";

    const originalFirstDayIndex = new Date(currentYear, currentMonthIdx, 1).getDay();
    const totalDaysInMonth = new Date(currentYear, currentMonthIdx + 1, 0).getDate();

    for (let pad = 0; pad < originalFirstDayIndex; pad++) {
        const nullCell = document.createElement("div");
        nullCell.classList.add("day-node", "empty-node");
        gridContainer.appendChild(nullCell);
    }

    const normalizeToday = new Date(currentYear, currentMonthIdx, todayDateNum, 0, 0, 0);

    for (let dayNum = 1; dayNum <= totalDaysInMonth; dayNum++) {
        const dayCell = document.createElement("div");
        dayCell.classList.add("day-node");
        dayCell.innerText = dayNum;

        const dateInstance = new Date(currentYear, currentMonthIdx, dayNum, 0, 0, 0);

        if (dayNum === todayDateNum) {
            dayCell.classList.add("node-today");
        } else if (pathTargetDate && dateInstance > normalizeToday && dateInstance <= pathTargetDate) {
            dayCell.classList.add("node-track-path");
        }

        gridContainer.appendChild(dayCell);
    }
}
