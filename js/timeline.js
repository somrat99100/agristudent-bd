document.addEventListener("DOMContentLoaded", () => {
    // 1. Capture current system execution parameters
    const liveNow = new Date();
    
    // 2. Define Exam Bounds Configurations
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

    // 3. Process States Machine Calculation
    Object.keys(examSchedules).forEach(key => {
        const exam = examSchedules[key];
        const cardNode = document.getElementById(exam.cardId);
        const textNode = document.getElementById(exam.txtId);
        const labelNode = document.getElementById(exam.lblId);
        const ringNode = document.getElementById(exam.ringId);
        
        const circ = 2 * Math.PI * 58; // Radius 58 = 364.42 circumference

        if (liveNow >= exam.start && liveNow <= exam.end) {
            // STATE B: Exam is actively happening right now
            if(cardNode) cardNode.classList.add("ongoing-mode");
            if(textNode) textNode.innerText = "RUN";
            if(labelNode) labelNode.style.color = "#FFB800";
            if(labelNode) labelNode.innerText = "EXAM ONGOING";
            if(ringNode) ringNode.style.strokeDashoffset = 0; // Full Ring Glowing Glow
        } 
        else if (liveNow > exam.end) {
            // STATE C: Exam has finished
            if(textNode) textNode.innerText = "DONE";
            if(labelNode) labelNode.innerText = "COMPLETED";
            if(ringNode) ringNode.style.strokeDashoffset = circ; // Empties out cleanly
        } 
        else {
            // STATE A: Countdown Mode (Exam is in the future)
            const timeDiff = exam.start - liveNow;
            const daysRemaining = Math.max(0, Math.ceil(timeDiff / (1000 * 60 * 60 * 24)));
            
            if(textNode) textNode.innerText = daysRemaining;
            if(labelNode) labelNode.innerText = "Days Left";

            if (ringNode) {
                const percentLeft = Math.min(100, Math.max(0, (daysRemaining / exam.scale) * 100));
                const offset = circ - (percentLeft / 100) * circ;
                setTimeout(() => { ringNode.style.strokeDashoffset = offset; }, 300);
            }

            // Track the nearest future event target path trajectory boundary
            if (timeDiff < baselineDiff) {
                baselineDiff = timeDiff;
                nearestUpcomingExamDate = exam.start;
            }
        }
    });

    // 4. Run Realtime Dynamic Calendar Generator
    renderRealtimeCalendarGrid(liveNow, nearestUpcomingExamDate);
});

function renderRealtimeCalendarGrid(currentDate, pathTargetDate) {
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    
    const mountHeader = document.getElementById("calendar-month-year");
    const gridContainer = document.getElementById("calendar-days-container");
    if (!gridContainer || !mountHeader) return;

    const currentYear = currentDate.getFullYear();
    const currentMonthIdx = currentDate.getMonth();

    // Display localized title header dynamically based on execution timing context
    mountHeader.innerText = `${months[currentMonthIdx]} ${currentYear}`;
    gridContainer.innerHTML = "";

    // Determine calendar alignment coordinates
    const originalFirstDayIndex = new Date(currentYear, currentMonthIdx, 1).getDay();
    const totalDaysInMonth = new Date(currentYear, currentMonthIdx + 1, 0).getDate();

    // Structural generation loop: pad alignment structural space cells
    for (let pad = 0; pad < originalFirstDayIndex; pad++) {
        const nullCell = document.createElement("div");
        nullCell.classList.add("day-node");
        gridContainer.appendChild(nullCell);
    }

    // Populate active monthly data matrix
    for (let dayNum = 1; dayNum <= totalDaysInMonth; dayNum++) {
        const dayCell = document.createElement("div");
        dayCell.classList.add("day-node");
        dayCell.innerText = dayNum;

        const dateInstance = new Date(currentYear, currentMonthIdx, dayNum, 0, 0, 0);
        const normalizeTodayComparison = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate());

        // Apply realtime visibility highlight traits
        if (currentDate.getDate() === dayNum && currentDate.getMonth() === currentMonthIdx) {
            dayCell.classList.add("node-today");
        } else if (pathTargetDate && dateInstance > normalizeTodayComparison && dateInstance <= pathTargetDate) {
            dayCell.classList.add("node-track-path");
        }

        gridContainer.appendChild(dayCell);
    }
}
