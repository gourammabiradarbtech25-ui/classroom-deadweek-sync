/* =========================================================
   CLASSROOM DEADWEEK SYNC
   Main JavaScript File
   ========================================================= */

/* =========================
   STORAGE
   ========================= */
const STORAGE_NAME = "classroomDeadweekSync";

let appData = JSON.parse(
    localStorage.getItem(STORAGE_NAME)
) || {
    courses: [],
    assignments: [],
    stuck: [],
    workload: []
};

function saveData() {
    localStorage.setItem(
        STORAGE_NAME,
        JSON.stringify(appData)
    );
}

// Reflects whether Google Classroom is actually connected
function updateHeaderConnectionStatus() {
    const hasToken = !!localStorage.getItem('classroom_access_token');
    const navDashboardLink = document.getElementById('navDashboardLink');
    
    if (navDashboardLink && hasToken) {
        navDashboardLink.classList.remove('nav-hidden');
    }

    if (!hasToken) return;

    const headerBtn = document.querySelector('header button');
    const classroomBtn = document.getElementById('connectClassroomBtn');

    if (headerBtn) {
        headerBtn.textContent = "Classroom Connected";
        headerBtn.disabled = true;
    }
    if (classroomBtn) {
        classroomBtn.textContent = "Reconnect Google Classroom";
    }
}

let tokenClient;

function initGoogleAuth() {
    if (typeof google === "undefined" || !google.accounts || !google.accounts.oauth2) {
        alert("Google Classroom connection is still loading. Please try again in a few seconds.");
        return null;
    }

    if (!tokenClient) {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: "161386973340-pkqkhdrf2ccqk4q5mc8brtcj7r7l6rer.apps.googleusercontent.com",
            scope: "https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.coursework.me.readonly https://www.googleapis.com/auth/classroom.student-submissions.me.readonly",
            callback: (tokenResponse) => {
                const accessToken = tokenResponse.access_token;
                localStorage.setItem('classroom_access_token', accessToken);
                
                const btn = document.getElementById('connectClassroomBtn');
                if(btn) btn.textContent = "Syncing Data...";
                
                syncClassroomData(accessToken).then(() => {
                    if(btn) btn.textContent = "Reconnect Google Classroom";
                });
                
                updateHeaderConnectionStatus();
            }
        });
    }
    return tokenClient;
}

window.addEventListener('load', function () {
    const connectBtn = document.getElementById('connectClassroomBtn');
    const headerBtn = document.querySelector('header button');

    const authHandler = function () {
        const client = initGoogleAuth();
        if (client) {
            client.requestAccessToken();
        }
    };

    if (connectBtn) {
        connectBtn.addEventListener('click', authHandler);
    }
    
    // Also attach to Header "Sign In" button
    if (headerBtn && headerBtn.textContent.trim() === "Sign In") {
        headerBtn.addEventListener('click', authHandler);
    }

    updateHeaderConnectionStatus();
});

/* =========================================================
   SYNC EVERYTHING FROM CLASSROOM
   ========================================================= */
function syncClassroomData(accessToken) {
    return fetch("https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE&studentId=me", {
        headers: { "Authorization": "Bearer " + accessToken }
    })
    .then(response => response.json())
    .then(data => {
        const courses = data.courses || [];
        appData.courses = courses.map(c => ({
            id: c.id,
            name: c.name
        }));

        const currentCourseNames = new Set(appData.courses.map(c => c.name));
        
        // Retain assignments that match current courses OR are custom/manual (identified by numeric Date.now() ID)
        appData.assignments = appData.assignments.filter(a => currentCourseNames.has(a.courseName) || typeof a.id === "number");

        const fetchedAssignmentIds = new Set();

        const fetchPromises = courses.map(course =>
            fetch(`https://classroom.googleapis.com/v1/courses/${course.id}/courseWork`, {
                headers: { "Authorization": "Bearer " + accessToken }
            })
            .then(res => res.json())
            .then(courseWorkData => {
                const work = courseWorkData.courseWork || [];

                const submissionChecks = work.map(item => {
                    fetchedAssignmentIds.add(String(item.id));
                    
                    let dueDate = null;
                    if (item.dueDate) {
                        dueDate = item.dueDate.year + "-" +
                            String(item.dueDate.month).padStart(2, "0") + "-" +
                            String(item.dueDate.day).padStart(2, "0");
                    }

                    return fetch(
                        `https://classroom.googleapis.com/v1/courses/${course.id}/courseWork/${item.id}/studentSubmissions?userId=me`,
                        { headers: { "Authorization": "Bearer " + accessToken } }
                    )
                    .then(res => res.json())
                    .then(subData => {
                        const submission = (subData.studentSubmissions || [])[0];
                        const state = submission ? submission.state : "CREATED";
                        const isCompleted = (state === "TURNED_IN" || state === "RETURNED");

                        const existing = appData.assignments.find(a => String(a.id) === String(item.id));

                        if (!existing) {
                            appData.assignments.push({
                                id: String(item.id),
                                title: item.title,
                                dueDate: dueDate,
                                type: item.workType || "Assignment",
                                courseName: course.name,
                                completed: isCompleted,
                                stuck: false
                            });
                        } else {
                            existing.completed = isCompleted;
                            existing.title = item.title;
                            existing.dueDate = dueDate;
                        }
                    })
                    .catch(err => console.error("Error checking submission for", item.title, err));
                });

                return Promise.all(submissionChecks);
            })
            .catch(err => console.error("Error fetching coursework for", course.name, err))
        );

        return Promise.all(fetchPromises).then(() => {
            // Keep fetched assignments AND local custom tasks
            appData.assignments = appData.assignments.filter(a => fetchedAssignmentIds.has(String(a.id)) || typeof a.id === "number");
            saveData();
            console.log("Sync complete. Assignments:", appData.assignments);

            if (typeof displayCourses === "function") displayCourses(appData.courses);
            if (typeof displayCalendar === "function") displayCalendar();
            if (typeof updateDashboardStats === "function") updateDashboardStats();
            if (typeof renderAssignmentAndDeadlineLists === "function") renderAssignmentAndDeadlineLists();
            if (typeof renderStuckPage === "function") renderStuckPage();
        });
    })
    .catch(error => console.error("Error fetching courses:", error));
}

function setupButtons() {
    console.log("Buttons initialized");
}

function displayCourses(courses) {
    const courseList = document.getElementById("courseList");
    if (!courseList) return;

    const hiddenCourses = JSON.parse(localStorage.getItem('hiddenCourses')) || [];
    const visibleCourses = courses.filter(c => !hiddenCourses.includes(c.id));

    if (!visibleCourses || visibleCourses.length === 0) {
        courseList.innerHTML = "<p>No courses found.</p>";
        return;
    }

    courseList.innerHTML = "";
    visibleCourses.forEach(course => {
        const item = document.createElement("div");
        item.innerHTML =
            "<h3>" + escapeHTML(course.name) + "</h3>" +
            "<button class='hide-course-btn' data-course-id='" + course.id + "'>Hide</button>";
        courseList.appendChild(item);
    });

    document.querySelectorAll('.hide-course-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            hideCourse(this.getAttribute('data-course-id'));
        });
    });
}

function hideCourse(courseId) {
    let hiddenCourses = JSON.parse(localStorage.getItem('hiddenCourses')) || [];
    if (!hiddenCourses.includes(courseId)) {
        hiddenCourses.push(courseId);
        localStorage.setItem('hiddenCourses', JSON.stringify(hiddenCourses));
    }
    
    // Invalidate stale workload plan cache when hiding a course
    localStorage.removeItem("workloadPlan");

    displayCourses(appData.courses);
    updateDashboardStats();
    renderAssignmentAndDeadlineLists();

    // Trigger immediate UI updates if the user triggers this while on a specific sub-page layout
    if (typeof renderDeadweekPage === "function" && document.getElementById("deadweekCourseList")) renderDeadweekPage();
    if (typeof renderWorkloadPage === "function" && document.getElementById("planStatus")) {
        const refreshed = buildWorkloadPlan();
        localStorage.setItem("workloadPlan", JSON.stringify(refreshed));
        renderWorkloadPage(refreshed);
    }
    if (typeof renderStuckPage === "function" && document.getElementById("stuckAssignmentList")) renderStuckPage();
    if (typeof displayCalendar === "function" && document.getElementById("calendarGrid")) displayCalendar();
}

/* =========================================================
   ASSIGNMENT / DEADLINE LISTS
   ========================================================= */

function formatLocalDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return "No due date";
    if (!dateStr.includes('-')) return dateStr;
    const [year, month, day] = dateStr.split('-');
    const d = new Date(year, parseInt(month) - 1, day);
    if (isNaN(d.getTime())) return "Invalid Date";
    return d.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
}

function renderAssignmentAndDeadlineLists() {
    const visibleAssignments = getVisibleAssignments();
    const pending = visibleAssignments.filter(a => !a.completed);
    const dated = pending
        .filter(a => !!a.dueDate)
        .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const upcoming = dated.filter(a => new Date(a.dueDate) >= today);

    const upcomingOrUndated = pending.filter(a => !a.dueDate || new Date(a.dueDate) >= today);
    const assignmentListEl = document.getElementById("assignmentList");
    if (assignmentListEl) {
        if (upcomingOrUndated.length === 0) {
            assignmentListEl.innerHTML = "<p>No pending assignments.</p>";
        } else {
            assignmentListEl.innerHTML = "";
            upcomingOrUndated.slice(0, 20).forEach(function (a) {
                const item = document.createElement("div");
                const dueLabel = a.dueDate ? "Due " + formatLocalDate(a.dueDate) : "No due date";
                item.innerHTML =
                    "<h3>" + escapeHTML(a.title) + "</h3>" +
                    "<p>" + escapeHTML(a.courseName) + " · " + dueLabel + "</p>";
                assignmentListEl.appendChild(item);
            });
        }
    }

    const deadlineListEl = document.getElementById("deadlineList");
    if (deadlineListEl) {
        if (upcoming.length === 0) {
            deadlineListEl.innerHTML = "<p>No upcoming deadlines available.</p>";
        } else {
            deadlineListEl.innerHTML = "";
            upcoming.slice(0, 20).forEach(function (a) {
                const item = document.createElement("div");
                item.innerHTML =
                    "<h3>" + escapeHTML(a.title) + "</h3>" +
                    "<p>" + escapeHTML(a.courseName) + " · Due " + formatLocalDate(a.dueDate) + "</p>";
                deadlineListEl.appendChild(item);
            });
        }
    }

    const upcomingListEl = document.getElementById("upcomingDeadlineList");
    const deadlineCountBadge = document.getElementById("deadlineCount");
    if (upcomingListEl) {
        if (upcoming.length === 0) {
            upcomingListEl.innerHTML = "<p>No upcoming deadlines.</p>";
        } else {
            upcomingListEl.innerHTML = "";
            upcoming.forEach(function (a) {
                const item = document.createElement("div");
                item.className = "deadline-item";
                item.innerHTML =
                    "<div><h3>" + escapeHTML(a.title) + "</h3><p>" + escapeHTML(a.courseName) + "</p></div>" +
                    "<span>" + formatLocalDate(a.dueDate) + "</span>";
                upcomingListEl.appendChild(item);
            });
        }
    }
    if (deadlineCountBadge && upcomingListEl) {
        deadlineCountBadge.textContent = upcoming.length + " deadline" + (upcoming.length === 1 ? "" : "s");
    }
}

function updateDashboardStats() {
    const visibleCourses = getVisibleCourses();
    const visibleAssignments = getVisibleAssignments();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const courseCount = document.getElementById('courseCount');
    const assignmentCount = document.getElementById('assignmentCount');
    const deadlineCount = document.getElementById('deadlineCount');
    const deadweekCount = document.getElementById('deadweekCount');

    const pendingAssignments = visibleAssignments.filter(a => !a.completed);
    const datedPending = pendingAssignments.filter(a => !!a.dueDate && !isNaN(new Date(a.dueDate).getTime()));
    
    const upcomingDeadlines = datedPending.filter(a => {
        const due = new Date(a.dueDate);
        return due >= today;
    });

    const deadweeks = computeDeadweeksFrom(datedPending);

    if (courseCount) courseCount.textContent = visibleCourses.length;
    if (assignmentCount) assignmentCount.textContent = datedPending.length;
    if (deadlineCount) deadlineCount.textContent = upcomingDeadlines.length;
    if (deadweekCount) deadweekCount.textContent = deadweeks.length;

    // Fill Dashboard's Deadweek Status Area dynamically
    const deadweekMessage = document.getElementById('deadweekMessage') || document.getElementById('deadweekStatus');
    if (deadweekMessage) {
        if (deadweeks.length > 0) {
            deadweekMessage.innerHTML = "<p><strong>Warning:</strong> You have " + deadweeks.length + " heavy week(s) coming up.</p>";
        } else if (pendingAssignments.length > 0) {
            deadweekMessage.innerHTML = "<p>You're good for now.</p>";
        } else {
            deadweekMessage.innerHTML = "<p>Your workload analysis will appear here once tasks sync.</p>";
        }
    }

    // Fill Dashboard's Smart Workload Plan preview
    const workloadPlanDiv = document.getElementById('workloadPlan');
    if (workloadPlanDiv && !document.getElementById('workloadTimeline')) { 
        if (pendingAssignments.length > 0) {
            workloadPlanDiv.innerHTML = "<p>You have " + pendingAssignments.length + " pending task(s). Click below to generate your smart plan.</p>";
        } else {
            workloadPlanDiv.innerHTML = "<p>Your personalized workload plan will appear here.</p>";
        }
    }
}

/* =========================
   PAGE NAVIGATION
   ========================= */
document.addEventListener("DOMContentLoaded", function () {
    const isLandingPage = !!document.getElementById("connectClassroomBtn");
    if (!isLandingPage && appData.courses.length === 0) {
        window.location.href = "index.html";
        return;
    }

    document.querySelectorAll("a").forEach(function (link) {
        link.addEventListener("click", function () {
            const page = this.getAttribute("href");
            if (page && page.endsWith(".html")) {
                window.location.href = page;
            }
        });
    });

    setupCalendar();
    setupButtons();
    showToday();
    
    if (typeof displayCourses === "function") displayCourses(appData.courses);
    if (typeof updateDashboardStats === "function") updateDashboardStats();
    
    renderAssignmentAndDeadlineLists();
    setupDeadweekPage();
    setupWorkloadPage();
    setupStuckPage();
});

/* =========================================================
   CALENDAR
   ========================================================= */
let calendarDate = new Date();

function setupCalendar() {
    const calendarGrid = document.getElementById("calendarGrid");
    const monthTitle = document.getElementById("currentMonth");
    const previousButton = document.getElementById("previousMonth");
    const nextButton = document.getElementById("nextMonth");
    const todayBtn = document.getElementById("todayButton");

    if (!calendarGrid || !monthTitle) return;

    displayCalendar();

    if (previousButton) {
        previousButton.addEventListener("click", function () {
            calendarDate.setMonth(calendarDate.getMonth() - 1);
            displayCalendar();
        });
    }

    if (nextButton) {
        nextButton.addEventListener("click", function () {
            calendarDate.setMonth(calendarDate.getMonth() + 1);
            displayCalendar();
        });
    }
    
    if (todayBtn) {
        todayBtn.addEventListener("click", function () {
            calendarDate = new Date();
            displayCalendar();
        });
    }
}

function displayCalendar() {
    const calendarGrid = document.getElementById("calendarGrid");
    const monthTitle = document.getElementById("currentMonth");
    if (!calendarGrid || !monthTitle) return;

    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const monthName = calendarDate.toLocaleString("default", { month: "long" });

    monthTitle.innerHTML = monthName + "<br><small>" + year + "</small>";
    calendarGrid.innerHTML = "";

    const firstDay = new Date(year, month, 1);
    const numberOfDays = new Date(year, month + 1, 0).getDate();

    let startingDay = firstDay.getDay();
    startingDay = startingDay === 0 ? 6 : startingDay - 1;

    for (let i = 0; i < startingDay; i++) {
        const empty = document.createElement("div");
        empty.className = "calendar-date empty";
        calendarGrid.appendChild(empty);
    }

    for (let day = 1; day <= numberOfDays; day++) {
        const dateBox = document.createElement("div");
        dateBox.className = "calendar-date";
        dateBox.innerHTML = "<span class=\"calendar-date-number\">" + day + "</span>";

        const today = new Date();
        if (day === today.getDate() && month === today.getMonth() && year === today.getFullYear()) {
            dateBox.classList.add("today");
        }

        const dateString = formatDate(year, month, day);
        const assignments = getVisibleAssignments().filter(function (assignment) {
            return !assignment.completed && assignment.dueDate === dateString;
        });

        if (assignments.length > 0) {
            dateBox.classList.add("has-deadline");
            const indicator = document.createElement("small");
            indicator.className = "calendar-date-count";
            indicator.textContent = assignments.length + " deadline" + (assignments.length > 1 ? "s" : "");
            dateBox.appendChild(indicator);
        }

        dateBox.addEventListener("click", function () {
            showSelectedDate(year, month, day);
        });

        calendarGrid.appendChild(dateBox);
    }
}

function formatDate(year, month, day) {
    const m = String(month + 1).padStart(2, "0");
    const d = String(day).padStart(2, "0");
    return (year + "-" + m + "-" + d);
}

function showSelectedDate(year, month, day) {
    const selectedDate = document.getElementById("selectedDate");
    const assignmentArea = document.getElementById("selectedDayAssignments");

    if (!selectedDate || !assignmentArea) return;

    const selected = new Date(year, month, day);
    selectedDate.textContent = selected.toLocaleDateString("en-IN", {
        weekday: "long", day: "numeric", month: "long", year: "numeric"
    });

    const dateString = formatDate(year, month, day);
    const assignments = getVisibleAssignments().filter(function (assignment) {
        return !assignment.completed && assignment.dueDate === dateString;
    });

    if (assignments.length === 0) {
        assignmentArea.innerHTML = "<p>No deadlines on this date.</p>";
        return;
    }

    assignmentArea.innerHTML = "";
    assignments.forEach(function (assignment) {
        const item = document.createElement("div");
        item.className = "selected-assignment";
        item.innerHTML =
            "<h3>" + escapeHTML(assignment.title) + "</h3>" +
            "<p>" + escapeHTML(assignment.type || "Assignment") + "</p>";
        assignmentArea.appendChild(item);
    });
}

function showToday() {
    const today = new Date();
    console.log("Today:", today.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
}

function addAssignment(title, dueDate, type) {
    const assignment = {
        id: Date.now(),
        title: title,
        dueDate: dueDate,
        type: type || "Assignment",
        completed: false,
        stuck: false
    };
    appData.assignments.push(assignment);
    saveData();
    return assignment;
}

function completeAssignment(id) {
    const assignment = appData.assignments.find(item => String(item.id) === String(id));
    if (!assignment) return;
    assignment.completed = true;
    saveData();
}

function markStuck(id) {
    const assignment = appData.assignments.find(item => String(item.id) === String(id));
    if (!assignment) return;
    assignment.stuck = true;
    if (!appData.stuck.some(stuckId => String(stuckId) === String(id))) {
        appData.stuck.push(String(id));
    }
    saveData();
}

function removeStuck(id) {
    const assignment = appData.assignments.find(item => String(item.id) === String(id));
    if (!assignment) return;
    assignment.stuck = false;
    appData.stuck = appData.stuck.filter(item => String(item) !== String(id));
    saveData();
}

function deleteAssignment(id) {
    appData.assignments = appData.assignments.filter(item => String(item.id) !== String(id));
    appData.stuck = appData.stuck.filter(item => String(item) !== String(id));
    saveData();
}

function escapeHTML(text) {
    const div = document.createElement("div");
    div.textContent = text || "";
    return div.innerHTML;
}

/* =========================================================
   DEADWEEK DETECTOR
   ========================================================= */
function getVisibleAssignments() {
    const hiddenCourses = JSON.parse(localStorage.getItem('hiddenCourses')) || [];
    return appData.assignments.filter(a => {
        const course = appData.courses.find(c => c.name === a.courseName);
        return !course || !hiddenCourses.includes(course.id);
    });
}

function getVisibleCourses() {
    const hiddenCourses = JSON.parse(localStorage.getItem('hiddenCourses')) || [];
    return appData.courses.filter(c => !hiddenCourses.includes(c.id));
}

function classifyAssignmentType(assignment) {
    const title = (assignment.title || "").toLowerCase();
    if (/exam|midterm|final|test|quiz/.test(title)) return "Exam";
    if (/project/.test(title)) return "Project";
    return "Assignment";
}

function getWeekNumber(date) {
    const temp = new Date(date);
    temp.setHours(0, 0, 0, 0);
    temp.setDate(temp.getDate() + 4 - (temp.getDay() || 7));
    const yearStart = new Date(temp.getFullYear(), 0, 1);
    return Math.ceil((((temp - yearStart) / 86400000) + 1) / 7);
}

function computeDeadweeksFrom(list) {
    const weeks = {};
    list.forEach(function (assignment) {
        if (!assignment.dueDate) return;
        const date = new Date(assignment.dueDate);
        if (isNaN(date.getTime())) return; // Guard for invalid dates
        
        const year = date.getFullYear();
        const week = getWeekNumber(date);
        const key = year + "-W" + week;

        if (!weeks[key]) weeks[key] = [];
        weeks[key].push(assignment);
    });

    const result = [];
    Object.keys(weeks).sort().forEach(function (key) {
        if (weeks[key].length >= 3) {
            result.push({ week: key, deadlines: weeks[key] });
        }
    });
    return result;
}

function getWeekDateRange(weekKey) {
    const [yearStr, weekStr] = weekKey.split("-W");
    const year = parseInt(yearStr, 10);
    const week = parseInt(weekStr, 10);

    const simple = new Date(year, 0, 1 + (week - 1) * 7);
    const dow = simple.getDay() || 7;
    const start = new Date(simple);
    start.setDate(simple.getDate() - dow + 1);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);

    const fmt = { month: "short", day: "numeric" };
    return start.toLocaleDateString("en-IN", fmt) + " - " + end.toLocaleDateString("en-IN", fmt);
}

function setupDeadweekPage() {
    const weekList = document.getElementById("weekList");
    if (!weekList) return; 

    renderDeadweekPage();

    const scanBtn = document.getElementById("scanWorkload");
    if (scanBtn) {
        scanBtn.addEventListener("click", function () {
            const accessToken = localStorage.getItem("classroom_access_token");
            if (accessToken) {
                scanBtn.textContent = "Scanning...";
                scanBtn.disabled = true;
                syncClassroomData(accessToken).then(() => {
                    renderDeadweekPage();
                    scanBtn.textContent = "Scan My Calendar";
                    scanBtn.disabled = false;
                });
            } else {
                renderDeadweekPage();
            }
        });
    }
}

function renderDeadweekPage() {
    const visibleCourses = getVisibleCourses();
    const visibleAssignments = getVisibleAssignments();
    const pendingAssignments = visibleAssignments.filter(a => !a.completed);
    const deadweeks = computeDeadweeksFrom(pendingAssignments);

    const connStatus = document.getElementById("classroomConnectionStatus");
    const courseCountBadge = document.getElementById("deadweekCourseCount");

    if (connStatus) {
        connStatus.textContent = visibleCourses.length > 0
            ? "Connected — " + visibleCourses.length + " course" + (visibleCourses.length === 1 ? "" : "s") + " synced"
            : "Waiting for Google Classroom data...";
    }
    if (courseCountBadge) {
        courseCountBadge.textContent = visibleCourses.length + " Course" + (visibleCourses.length === 1 ? "" : "s");
    }

    const statusBadge = document.getElementById("statusBadge");
    const pressureScore = document.getElementById("pressureScore");
    const pressureTitle = document.getElementById("pressureTitle");
    const pressureDescription = document.getElementById("pressureDescription");

    if (pressureScore) pressureScore.textContent = pendingAssignments.length;

    if (statusBadge && pressureTitle && pressureDescription) {
        if (deadweeks.length > 0) {
            statusBadge.textContent = "HIGH PRESSURE";
            pressureTitle.textContent = "You have a heavy week coming up";
            pressureDescription.textContent =
                deadweeks.length + " week" + (deadweeks.length > 1 ? "s" : "") +
                " with 3 or more deadlines clustered together. Check the radar below.";
        } else if (pendingAssignments.length > 0) {
            statusBadge.textContent = "MANAGEABLE";
            pressureTitle.textContent = "Your workload looks manageable";
            pressureDescription.textContent =
                "You have " + pendingAssignments.length + " pending deadline" +
                (pendingAssignments.length === 1 ? "" : "s") + ", but nothing clustered into a deadweek.";
        } else {
            statusBadge.textContent = "ALL CLEAR";
            pressureTitle.textContent = "Nothing pending right now";
            pressureDescription.textContent = visibleCourses.length > 0
                ? "No pending assignments found in your connected courses."
                : "Connect Google Classroom from the Home page to see your workload here.";
        }
    }

    const courseListEl = document.getElementById("deadweekCourseList");
    if (courseListEl) {
        if (visibleCourses.length === 0) {
            courseListEl.innerHTML =
                '<div class="empty-course-state"><span>📚</span><h3>No Classroom Data Yet</h3>' +
                '<p>Connect Google Classroom from the Home page to see your courses and deadlines here.</p>' +
                '<a href="index.html">Connect Google Classroom →</a></div>';
        } else {
            courseListEl.innerHTML = "";
            visibleCourses.forEach(function (course) {
                const courseAssignments = pendingAssignments.filter(a => a.courseName === course.name);
                const examCount = courseAssignments.filter(a => classifyAssignmentType(a) === "Exam").length;
                const projectCount = courseAssignments.filter(a => classifyAssignmentType(a) === "Project").length;
                const assignmentCount = courseAssignments.length - examCount - projectCount;

                const card = document.createElement("div");
                card.className = "course-card";
                card.innerHTML =
                    "<h3>" + escapeHTML(course.name) + "</h3>" +
                    "<p>" + assignmentCount + " assignment" + (assignmentCount === 1 ? "" : "s") +
                    " · " + examCount + " exam" + (examCount === 1 ? "" : "s") +
                    " · " + projectCount + " project" + (projectCount === 1 ? "" : "s") + "</p>";
                courseListEl.appendChild(card);
            });
        }
    }

    const weekList = document.getElementById("weekList");
    if (weekList) {
        if (deadweeks.length === 0) {
            weekList.innerHTML = '<div class="empty-week-state"><p>No deadweeks detected right now — your deadlines are spread out.</p></div>';
        } else {
            weekList.innerHTML = "";
            deadweeks.forEach(function (dw) {
                const isHeavy = dw.deadlines.length >= 5;
                const status = isHeavy ? "Heavy" : "Moderate";
                const item = document.createElement("div");
                item.className = "week-card" + (isHeavy ? " warning" : "");
                item.innerHTML =
                    '<div class="week-info"><span>WEEK</span><h3>' + getWeekDateRange(dw.week) + '</h3></div>' +
                    '<div class="week-deadlines"><strong>' + dw.deadlines.length + '</strong><span>deadlines</span></div>' +
                    '<div class="week-status"><span>' + status + '</span></div>';
                weekList.appendChild(item);
            });
        }
    }

    const warningTitle = document.getElementById("warningTitle");
    const warningMessage = document.getElementById("warningMessage");
    if (warningTitle && warningMessage) {
        if (deadweeks.length > 0) {
            const busiest = deadweeks[0];
            warningTitle.textContent = deadweeks.length + " Deadweek" + (deadweeks.length > 1 ? "s" : "") + " Detected";
            warningMessage.textContent =
                "Week of " + getWeekDateRange(busiest.week) + " has " + busiest.deadlines.length +
                " deadlines clustered together. Build a plan before it hits.";
        } else {
            warningTitle.textContent = "No Deadweek Detected";
            warningMessage.textContent = visibleCourses.length > 0
                ? "Your deadlines are spread out — no clustering detected right now."
                : "Connect your Google Classroom to automatically detect weeks where multiple deadlines are clustered.";
        }
    }

    const examCountEl = document.getElementById("examCount");
    const projectCountEl = document.getElementById("projectCount");
    const assignmentCountEl = document.getElementById("deadweekAssignmentCount");
    const courseTotalEl = document.getElementById("courseTotal");

    if (examCountEl || projectCountEl || assignmentCountEl || courseTotalEl) {
        const examTotal = pendingAssignments.filter(a => classifyAssignmentType(a) === "Exam").length;
        const projectTotal = pendingAssignments.filter(a => classifyAssignmentType(a) === "Project").length;
        const assignmentTotal = pendingAssignments.length - examTotal - projectTotal;

        if (assignmentCountEl) assignmentCountEl.textContent = assignmentTotal;
        if (examCountEl) examCountEl.textContent = examTotal;
        if (projectCountEl) projectCountEl.textContent = projectTotal;
        if (courseTotalEl) courseTotalEl.textContent = visibleCourses.length;
    }

    const recommendationTitle = document.getElementById("recommendationTitle");
    const smartAdvice = document.getElementById("smartAdvice");
    if (recommendationTitle && smartAdvice) {
        if (deadweeks.length > 0) {
            const busiest = deadweeks[0];
            recommendationTitle.textContent = "Get ahead of your next deadweek";
            smartAdvice.textContent =
                "You have " + busiest.deadlines.length + " deadlines in the week of " + getWeekDateRange(busiest.week) +
                ". Start projects at least 5 days early and set aside 2 days before exams to revise.";
        } else if (pendingAssignments.length > 0) {
            recommendationTitle.textContent = "You're on track";
            smartAdvice.textContent = "No overloaded weeks detected. Keep working through your pending assignments at a steady pace.";
        } else {
            recommendationTitle.textContent = "Waiting for your workload...";
            smartAdvice.textContent = "After your Google Classroom courses and deadlines are loaded, the system will suggest when you should start preparing for important work.";
        }
    }
}

/* =========================================================
   WORKLOAD PLAN PAGE
   ========================================================= */
function buildWorkloadPlan() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const pending = getVisibleAssignments().filter(a => !a.completed && a.dueDate && !isNaN(new Date(a.dueDate).getTime()));

    const enriched = pending.map(function (a) {
        const due = new Date(a.dueDate);
        due.setHours(0, 0, 0, 0);
        const daysUntil = Math.round((due - today) / 86400000);
        const type = classifyAssignmentType(a);
        const leadDays = type === "Project" ? 5 : (type === "Exam" ? 3 : 1);
        const startDaysUntil = Math.max(0, daysUntil - leadDays);

        return Object.assign({}, a, { daysUntil: daysUntil, type: type, startDaysUntil: startDaysUntil });
    }).filter(a => a.daysUntil >= 0).sort((a, b) => a.daysUntil - b.daysUntil);

    const urgent = enriched.filter(a => a.daysUntil <= 2);
    const important = enriched.filter(a => a.daysUntil > 2 && a.daysUntil <= 7);
    const later = enriched.filter(a => a.daysUntil > 7);

    const totalHours = enriched.reduce(function (sum, a) {
        return sum + (a.type === "Project" ? 4 : (a.type === "Exam" ? 3 : 1.5));
    }, 0);

    const score = Math.max(0, Math.min(100, 100 - (urgent.length * 15 + important.length * 5)));

    return {
        enriched: enriched, urgent: urgent, important: important, later: later,
        focusTask: enriched.length > 0 ? enriched[0] : null, totalHours: totalHours, score: score,
        generatedAt: new Date().toISOString()
    };
}

function setPriorityColumn(countId, listId, items, emptyLabel) {
    const countEl = document.getElementById(countId);
    const listEl = document.getElementById(listId);
    if (countEl) countEl.textContent = items.length;
    if (listEl) {
        listEl.textContent = items.length > 0
            ? items.slice(0, 4).map(a => a.title).join(", ") + (items.length > 4 ? ", +" + (items.length - 4) + " more" : "")
            : emptyLabel;
    }
}

function renderCourseWorkloadList(plan) {
    const listEl = document.getElementById("courseWorkloadList");
    const statusEl = document.getElementById("courseWorkloadStatus");
    if (!listEl) return;

    const courses = getVisibleCourses();
    if (courses.length === 0 || plan.enriched.length === 0) {
        listEl.innerHTML = '<div class="empty-course-workload"><span>◌</span><h3>No course workload yet</h3><p>Your connected Classroom courses will appear here with their workload distribution.</p></div>';
        if (statusEl) statusEl.textContent = "Waiting for data";
        return;
    }

    listEl.innerHTML = "";
    courses.forEach(function (course) {
        const courseTasks = plan.enriched.filter(a => a.courseName === course.name);
        if (courseTasks.length === 0) return;
        const pct = Math.round((courseTasks.length / plan.enriched.length) * 100);
        const card = document.createElement("div");
        card.className = "workload-course-card";
        card.innerHTML = "<h3>" + escapeHTML(course.name) + "</h3><p>" + courseTasks.length + " pending task" + (courseTasks.length === 1 ? "" : "s") + " · " + pct + "% of your workload</p>";
        listEl.appendChild(card);
    });

    if (statusEl) statusEl.textContent = courses.length + " course" + (courses.length === 1 ? "" : "s") + " tracked";
}

function renderDailyPlan(plan, offset) {
    const dailyEl = document.getElementById("dailyPlan");
    if (!dailyEl) return;

    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() + offset);
    const label = day.toLocaleDateString("en-IN", { weekday: "long", month: "short", day: "numeric" });

    const dayTasks = plan.enriched.filter(a => a.startDaysUntil <= offset && a.daysUntil >= offset);

    if (dayTasks.length === 0) {
        dailyEl.innerHTML = '<p class="daily-plan-label">' + label + '</p><div class="empty-daily-plan"><div>📅</div><h3>Nothing scheduled</h3><p>No tasks recommended for this day.</p></div>';
        return;
    }

    dailyEl.innerHTML = '<p class="daily-plan-label">' + label + '</p>';
    dayTasks.forEach(function (a) {
        const item = document.createElement("div");
        item.className = "daily-task";
        item.innerHTML = '<input type="checkbox" data-id="' + a.id + '"><div><h3>' + escapeHTML(a.title) + '</h3><p>' + escapeHTML(a.courseName) + ' — due in ' + a.daysUntil + ' day' + (a.daysUntil === 1 ? "" : "s") + '</p></div>';
        dailyEl.appendChild(item);
    });

    dailyEl.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
        cb.addEventListener("change", function () {
            if (!this.checked) return;
            completeAssignment(this.dataset.id);
            const refreshed = buildWorkloadPlan();
            localStorage.setItem("workloadPlan", JSON.stringify(refreshed));
            renderWorkloadPage(refreshed);
        });
    });
}

function renderWorkloadPage(plan) {
    const planStatus = document.getElementById("planStatus");
    const lastUpdated = document.getElementById("lastUpdated");
    const planScoreEl = document.getElementById("planScore");

    if (planStatus) planStatus.textContent = plan.enriched.length > 0 ? "Plan generated" : "No plan generated yet";
    if (lastUpdated) {
        lastUpdated.textContent = "Last generated " + new Date(plan.generatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
    }
    if (planScoreEl) planScoreEl.textContent = plan.enriched.length > 0 ? plan.score : "Not generated";

    const todayTask = document.getElementById("todayTask");
    const todayDescription = document.getElementById("todayDescription");
    if (todayTask && todayDescription) {
        if (plan.focusTask) {
            const due = plan.focusTask.daysUntil;
            const start = plan.focusTask.startDaysUntil;
            todayTask.textContent = plan.focusTask.title;
            todayDescription.textContent = plan.focusTask.courseName + " — due " + (due === 0 ? "today" : due === 1 ? "tomorrow" : "in " + due + " days") + ". Recommended start: " + (start === 0 ? "today" : "in " + start + " day(s)") + ".";
        } else {
            todayTask.textContent = "Nothing pending right now";
            todayDescription.textContent = "You're all caught up. Generate a new plan once new assignments come in.";
        }
    }

    const timelineEl = document.getElementById("workloadTimeline");
    const timelineRange = document.getElementById("timelineRange");
    if (timelineEl) {
        if (plan.enriched.length === 0) {
            timelineEl.innerHTML = '<div class="empty-timeline"><div class="timeline-icon">✦</div><h3>Nothing to plan right now</h3><p>Generate a plan once you have pending assignments.</p></div>';
            if (timelineRange) timelineRange.textContent = "No plan generated";
        } else {
            timelineEl.innerHTML = "";
            plan.enriched.forEach(function (a) {
                const item = document.createElement("div");
                item.className = "timeline-item";
                item.innerHTML = "<h3>" + escapeHTML(a.title) + "</h3><p>" + escapeHTML(a.courseName) + " — start " + (a.startDaysUntil === 0 ? "today" : "in " + a.startDaysUntil + " day(s)") + ", due " + (a.daysUntil === 0 ? "today" : "in " + a.daysUntil + " day(s)") + "</p>";
                timelineEl.appendChild(item);
            });
            if (timelineRange) timelineRange.textContent = plan.enriched.length + " task" + (plan.enriched.length === 1 ? "" : "s") + " planned";
        }
    }

    setPriorityColumn("urgentCount", "urgentTasks", plan.urgent, "No urgent tasks.");
    setPriorityColumn("importantCount", "importantTasks", plan.important, "No important tasks.");
    setPriorityColumn("laterCount", "laterTasks", plan.later, "No later tasks.");

    renderCourseWorkloadList(plan);

    const recommendedHours = document.getElementById("recommendedHours");
    const timeAdvice = document.getElementById("timeAdvice");
    if (recommendedHours && timeAdvice) {
        if (plan.enriched.length > 0) {
            recommendedHours.textContent = "~" + Math.round(plan.totalHours) + " hours this week";
            timeAdvice.textContent = "Based on " + plan.enriched.length + " pending item(s): roughly 1.5h per assignment, 3h per exam, 4h per project.";
        } else {
            recommendedHours.textContent = "No study schedule needed right now";
            timeAdvice.textContent = "Nothing pending — enjoy the breathing room.";
        }
    }

    renderDailyPlan(plan, 0);
}

function setupWorkloadPage() {
    const generateBtn = document.getElementById("generatePlan");
    if (!generateBtn) return; 

    let planData = JSON.parse(localStorage.getItem("workloadPlan")) || null;
    let dailyOffset = 0;

    generateBtn.addEventListener("click", function () {
        planData = buildWorkloadPlan();
        localStorage.setItem("workloadPlan", JSON.stringify(planData));
        dailyOffset = 0;
        renderWorkloadPage(planData);
    });

    const markCompleteBtn = document.getElementById("markComplete");
    if (markCompleteBtn) {
        markCompleteBtn.addEventListener("click", function () {
            if (!planData || !planData.focusTask) return;
            completeAssignment(planData.focusTask.id);
            planData = buildWorkloadPlan();
            localStorage.setItem("workloadPlan", JSON.stringify(planData));
            dailyOffset = 0;
            renderWorkloadPage(planData);
        });
    }

    const prevDayBtn = document.getElementById("previousDay");
    const nextDayBtn = document.getElementById("nextDay");
    if (prevDayBtn) {
        prevDayBtn.addEventListener("click", function () {
            if (!planData) return;
            dailyOffset = Math.max(0, dailyOffset - 1);
            renderDailyPlan(planData, dailyOffset);
        });
    }
    if (nextDayBtn) {
        nextDayBtn.addEventListener("click", function () {
            if (!planData) return;
            dailyOffset = Math.min(6, dailyOffset + 1);
            renderDailyPlan(planData, dailyOffset);
        });
    }

    if (planData) renderWorkloadPage(planData);
}

/* =========================================================
   STUCK / PEER SUPPORT PAGE
   ========================================================= */
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }
    return hash;
}

function getFakePeerCount(id) {
    return 2 + (hashString(String(id)) % 6);
}

const FAKE_PEER_NAMES = ["Aditi", "Rohan", "Meera", "Kabir", "Ishaan", "Tara", "Vikram", "Ananya"];
const FAKE_PEER_MESSAGES = [
    "Anyone figured out part 2 yet? Stuck on the same bit.",
    "Same here — this one's tricky. Let's figure it out together.",
    "Did the deadline get extended? Someone mentioned it in class.",
    "Can someone explain the requirements again? A bit confused.",
    "I got past the first part, happy to share notes if it helps."
];

function getDiscussions() {
    return JSON.parse(localStorage.getItem("stuckDiscussions")) || {};
}

function saveDiscussions(discussions) {
    localStorage.setItem("stuckDiscussions", JSON.stringify(discussions));
}

function seedDiscussionIfNeeded(discussions, assignment) {
    if (discussions[assignment.id]) return;
    const hash = hashString(String(assignment.id));
    const name = FAKE_PEER_NAMES[hash % FAKE_PEER_NAMES.length];
    const message = FAKE_PEER_MESSAGES[hash % FAKE_PEER_MESSAGES.length];
    discussions[assignment.id] = [{ author: name, text: message }];
}

let selectedStuckAssignmentId = null;

function setupStuckPage() {
    const assignmentListEl = document.getElementById("stuckAssignmentList");
    const discussionContainer = document.getElementById("discussionContainer");
    if (!assignmentListEl || !discussionContainer) return; 

    renderStuckPage();

    const sendBtn = document.getElementById("sendComment");
    const commentText = document.getElementById("commentText");
    if (sendBtn && commentText) {
        sendBtn.addEventListener("click", function () {
            const text = commentText.value.trim();
            if (!text) return;

            if (!selectedStuckAssignmentId) {
                const stuckPending = getVisibleAssignments().filter(a => appData.stuck.some(stuckId => String(stuckId) === String(a.id)));
                if (stuckPending.length === 0) return;
                selectedStuckAssignmentId = stuckPending[0].id;
            }

            const discussions = getDiscussions();
            const assignment = getVisibleAssignments().find(a => String(a.id) === String(selectedStuckAssignmentId));
            if (assignment) seedDiscussionIfNeeded(discussions, assignment);
            if (!discussions[selectedStuckAssignmentId]) discussions[selectedStuckAssignmentId] = [];
            discussions[selectedStuckAssignmentId].push({ author: "You", text: text });
            saveDiscussions(discussions);

            commentText.value = "";
            renderStuckPage();
        });
    }
}

function renderStuckPage() {
    const discussionContainer = document.getElementById("discussionContainer");
    if (!discussionContainer) return; 

    const pending = getVisibleAssignments().filter(a => !a.completed);
    const stuckPending = pending.filter(a => appData.stuck.some(stuckId => String(stuckId) === String(a.id)));
    const discussions = getDiscussions();

    const totalEl = document.getElementById("totalAssignments");
    const studentsStuckEl = document.getElementById("studentsStuck");
    const activeDiscussionsEl = document.getElementById("activeDiscussions");
    const helpedEl = document.getElementById("helpedStudents");

    if (totalEl) totalEl.textContent = pending.length;
    if (studentsStuckEl) studentsStuckEl.textContent = pending.reduce((sum, a) => sum + getFakePeerCount(a.id), 0);
    if (activeDiscussionsEl) activeDiscussionsEl.textContent = Object.keys(discussions).length;
    if (helpedEl) helpedEl.textContent = stuckPending.reduce((sum, a) => sum + getFakePeerCount(a.id), 0);

    const assignmentListEl = document.getElementById("stuckAssignmentList");
    if (assignmentListEl) {
        if (pending.length === 0) {
            assignmentListEl.innerHTML =
                '<div class="empty-assignment"><div>◌</div><h3>Your assignments will appear here</h3>' +
                '<p>Connect Google Classroom to see your assignments and tell your classmates where you need help.</p>' +
                '<a href="index.html">Connect Google Classroom →</a></div>';
        } else {
            assignmentListEl.innerHTML = "";
            pending.forEach(function (a) {
                const isStuck = appData.stuck.some(stuckId => String(stuckId) === String(a.id));
                const dueLabel = a.dueDate ? "Due " + formatLocalDate(a.dueDate) : "No due date";

                const card = document.createElement("div");
                card.className = "assignment-card" + (String(selectedStuckAssignmentId) === String(a.id) ? " selected" : "");
                card.innerHTML =
                    '<div><h3>' + escapeHTML(a.title) + '</h3><p>' + escapeHTML(a.courseName) + ' · ' + dueLabel + '</p></div>' +
                    '<button type="button">' + (isStuck ? "Marked ✓" : "I'm Stuck") + '</button>';
                assignmentListEl.appendChild(card);

                card.addEventListener("click", function (e) {
                    if (e.target.tagName === "BUTTON") return;
                    selectedStuckAssignmentId = a.id;
                    renderStuckPage();
                });

                card.querySelector("button").addEventListener("click", function (e) {
                    e.stopPropagation();
                    if (appData.stuck.some(stuckId => String(stuckId) === String(a.id))) {
                        removeStuck(a.id);
                    } else {
                        markStuck(a.id);
                        selectedStuckAssignmentId = a.id;
                    }
                    renderStuckPage();
                });
            });
        }
    }

    const peerListEl = document.getElementById("peerList");
    if (peerListEl) {
        if (stuckPending.length === 0) {
            peerListEl.innerHTML =
                '<div class="empty-peer"><span>👥</span><h3>No peer activity yet</h3>' +
                '<p>When students mark an assignment as "I\'m Stuck", their activity will appear here.</p></div>';
        } else {
            peerListEl.innerHTML = "";
            stuckPending.forEach(function (a) {
                const count = getFakePeerCount(a.id);
                const titleText = a.title || "Untitled";
                const initials = titleText.trim().slice(0, 2).toUpperCase();
                
                const item = document.createElement("div");
                item.className = "peer-card";
                item.innerHTML =
                    '<div class="peer-avatar">' + escapeHTML(initials) + '</div>' +
                    '<div><h3>' + count + ' classmate' + (count === 1 ? "" : "s") + ' also stuck</h3>' +
                    '<p>' + escapeHTML(titleText) + ' — ' + escapeHTML(a.courseName) + '</p></div>';
                peerListEl.appendChild(item);
            });
        }
    }

    if (!selectedStuckAssignmentId && stuckPending.length > 0) {
        selectedStuckAssignmentId = stuckPending[0].id;
    }

    // Bug Fix: Find the target assignment out of 'getVisibleAssignments()' to ensure hidden tasks don't leak logic.
    const assignment = getVisibleAssignments().find(a => String(a.id) === String(selectedStuckAssignmentId));

    if (!assignment || !appData.stuck.some(stuckId => String(stuckId) === String(assignment.id))) {
        discussionContainer.innerHTML =
            '<div class="discussion-empty"><div class="chat-symbol">💬</div>' +
            '<h3>No discussions yet</h3><p>Start by marking an assignment as "I\'m Stuck".</p></div>';
    } else {
        if (!discussions[assignment.id]) {
            seedDiscussionIfNeeded(discussions, assignment);
            saveDiscussions(discussions);
        }
        discussionContainer.innerHTML = '<p class="discussion-label">Discussing: ' + escapeHTML(assignment.title) + '</p>';
        discussions[assignment.id].forEach(function (c) {
            const item = document.createElement("div");
            item.className = "comment-item";
            item.innerHTML = "<strong>" + escapeHTML(c.author) + "</strong><p>" + escapeHTML(c.text) + "</p>";
            discussionContainer.appendChild(item);
        });
    }
}

saveData();
console.log("Classroom Deadweek Sync JavaScript loaded successfully.");