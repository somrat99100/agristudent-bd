document.addEventListener("DOMContentLoaded", () => {
    
    // 1. Establish the current system date coordinates
    const liveToday = new Date();

    // 2. Exact Event Parameters Config Mapping
    const trackingEvents = {
        midterm: { start: new Date("2026-07-01"), scale: 30, ringId: "ring-midterm", txtId: "count-midterm" },
        ct: { start: new Date("2026-08-02"), scale: 30, ringId: "ring-ct", txtId: "count-ct" },
        final: { start: new Date("2026-09-10"), scale: 45, ringId: "ring-final", txtId: "count-final" }
    };

    // Find the closest upcoming event target to create the calendar trajectory highlight path
    let closestUpcomingTarget = null;
    let shortestDiff = Infinity;

    Object.keys(trackingEvents).forEach(key => {
        const targetConfig = trackingEvents[key];
        const diffMs = targetConfig.start - liveToday;
        const remainingDays = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

        // Output days remaining text value to UI node
        document.getElementById(targetConfig.txtId).innerText = remainingDays;

        // Animate circular metrics draining math calculations
        const trackingCircle = document.getElementById(targetConfig.ringId);
        if (trackingCircle) {
            const circ = 2 * Math.PI * trackingCircle.r.baseVal.value; // ~339.29
            const percentageLeft = Math.min(100, Math.max(0, (remainingDays / targetConfig.scale) * 100));
            const calculatedOffset = circ - (percentageLeft / 100) * circ;

            // Trigger smooth transition fill delay drop matching card animation sequences
            setTimeout(() => {
                trackingCircle.style.strokeDashoffset = calculatedOffset;
            }, 400);
        }

        // Evaluate closest event selection
        if (diffMs > 0 && diffMs < shortestDiff) {
            shortestDiff = diffMs;
            closestUpcomingTarget = targetConfig.start;
        }
    });

    // 3. Render July 2026 Calendar Widget Programmatically
    generateJuly2026GridMatrix(liveToday, closestUpcomingTarget);
});

function generateJuly2026GridMatrix(todayDate, trackingTarget) {
    const gridContainer = document.getElementById("calendar-days-container");
    if (!gridContainer) return;

    gridContainer.innerHTML = "";

    // July 2026 shifts open directly on a Wednesday (Offsets index positions by 3 slots)
    for (let padOffset = 0; padOffset < 3; padOffset++) {
        const emptyCell = document.createElement("div");
        emptyCell.classList.add("day-node");
        gridContainer.appendChild(emptyCell);
    }

    // Build the 31 numeric dates of July
    for (let scalarDay = 1; scalarDay <= 31; scalarDay++) {
        const dayElement = document.createElement("div");
        dayElement.classList.add("day-node");
        dayElement.innerText = scalarDay;

        // Establish matching date object instances to check highlighted configurations
        const currentEvaluatingDate = new Date(`2026-07-${scalarDay.toString().padStart(2, '0')}T00:00:00`);
        const pureTodayComparison = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate());

        // Highlight matching logic check sequences
        if (todayDate.getMonth() === 6 && todayDate.getDate() === scalarDay) {
            // Highlights "Today"
            dayElement.classList.add("node-today");
        } else if (trackingTarget && currentEvaluatingDate > pureTodayComparison && currentEvaluatingDate <= trackingTarget) {
            // Highlights path from tomorrow up until the closest upcoming exam block parameter
            dayElement.classList.add("node-track-path");
        }

        gridContainer.appendChild(dayElement);
    }
}
