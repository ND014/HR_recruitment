// ==========================================================================
// Admin Dashboard — Candidate Review & Pipeline
// Clean, user-friendly interface without technical jargon
// ==========================================================================

function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return String(unsafe)
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// DOM Elements
const elements = {
    statsTotal: document.getElementById('statsTotal'),
    statsPending: document.getElementById('statsPending'),
    statsShortlisted: document.getElementById('statsShortlisted'),
    statsRejected: document.getElementById('statsRejected'),
    headerTotalCount: document.getElementById('headerTotalCount'),

    tabActive: document.getElementById('tabActive'),
    tabApproved: document.getElementById('tabApproved'),
    tabRejected: document.getElementById('tabRejected'),

    tabCountActive: document.getElementById('tabCountActive'),
    tabCountApproved: document.getElementById('tabCountApproved'),
    tabCountRejected: document.getElementById('tabCountRejected'),

    navApprovedBadge: document.getElementById('navApprovedBadge'),
    approvedSearchInput: document.getElementById('approvedSearchInput'),
    approvedPipelineFilter: document.getElementById('approvedPipelineFilter'),
    approvedTableBody: document.getElementById('approvedTableBody'),

    statusFilter: document.getElementById('statusFilter'),
    searchInput: document.getElementById('searchInput'),
    tableBody: document.getElementById('candidatesTableBody'),

    modal: document.getElementById('candidateModal'),
    modalOverlay: document.getElementById('candidateModal'),
    modalContent: document.getElementById('modalContent'),
    modalAppId: document.getElementById('modalAppId'),
    closeModalBtn: document.getElementById('closeModalBtn')
};

// State
let currentTab = 'active'; // 'active', 'rejected'
let currentCandidate = null;
let cachedCandidates = [];
let currentCandSort = { col: null, dir: 'asc' };
let currentEmpSort = { col: null, dir: 'asc' };

// Enterprise Toast Notification Dispatcher
function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast-item ${type}`;
    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : type === 'warning' ? '⚠' : 'ℹ';
    toast.innerHTML = `
        <span class="toast-icon">${icon}</span>
        <div class="toast-msg">${escapeHtml(message)}</div>
    `;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'toastSlideOut 0.25s forwards ease-in';
        setTimeout(() => toast.remove(), 260);
    }, duration);
}

// API Calls
async function fetchStats() {
    try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        if (data.success) {
            const s = data.data;
            if (elements.statsTotal) elements.statsTotal.textContent = s.total;
            if (elements.headerTotalCount) elements.headerTotalCount.textContent = s.total;
            if (elements.statsPending) elements.statsPending.textContent = s.pending;
            if (elements.statsShortlisted) elements.statsShortlisted.textContent = s.approved_total_pool !== undefined ? s.approved_total_pool : (s.shortlisted ?? 0);
            if (elements.statsRejected) elements.statsRejected.textContent = s.rejected_total;

            if (elements.tabCountActive) elements.tabCountActive.textContent = s.pending;
            if (elements.tabCountApproved) elements.tabCountApproved.textContent = (s.approved_awaiting !== undefined) ? s.approved_awaiting : (s.approved_total ?? 0);
            if (elements.tabCountRejected) elements.tabCountRejected.textContent = s.rejected_total;

            const navPendingBadge = document.getElementById('navPendingBadge');
            if (navPendingBadge) {
                navPendingBadge.textContent = s.pending;
                navPendingBadge.style.display = s.pending > 0 ? 'inline-flex' : 'none';
            }
            const navApprovedBadge = document.getElementById('navApprovedBadge');
            if (navApprovedBadge) {
                const appCount = (s.approved_awaiting !== undefined) ? s.approved_awaiting : (s.approved_total !== undefined ? s.approved_total : 0);
                navApprovedBadge.textContent = appCount;
                navApprovedBadge.style.display = appCount > 0 ? 'inline-flex' : 'none';
            }
        }
    } catch (e) {
        console.error('Error fetching stats:', e);
    }
}

async function fetchCandidates() {
    const search = elements.searchInput ? elements.searchInput.value.trim() : '';

    let endpoint = '/api/candidates?status=pending&';
    if (currentTab === 'approved') {
        endpoint = '/api/approved?';
    } else if (currentTab === 'rejected') {
        endpoint = '/api/rejected-archive?';
    }

    const params = new URLSearchParams();
    if (search) params.append('search', search);
    endpoint += params.toString();

    try {
        elements.tableBody.innerHTML = '<tr><td colspan="8" class="text-center">Loading candidates...</td></tr>';
        const res = await fetch(endpoint);
        const data = await res.json();

        if (data.success) {
            cachedCandidates = data.data || [];
            applyCandidateSorting();
            const countPill = document.getElementById('candShowingCountPill');
            if (countPill) countPill.textContent = `${cachedCandidates.length} records`;
        } else {
            elements.tableBody.innerHTML = '<tr><td colspan="8" class="text-center">Error loading candidate records</td></tr>';
        }
    } catch (e) {
        console.error('Error fetching candidates:', e);
        elements.tableBody.innerHTML = '<tr><td colspan="8" class="text-center">Failed to connect to backend server</td></tr>';
    }
}

async function viewCandidate(appId) {
    try {
        const [res, offerRes] = await Promise.all([
            fetch(`/api/candidates/${appId}`),
            fetch(`/api/candidates/${appId}/offer-status`).catch(() => null)
        ]);
        const data = await res.json();
        const offerData = offerRes ? await offerRes.json().catch(() => null) : null;

        if (data.success) {
            currentCandidate = data.data;
            if (offerData && offerData.has_offer) {
                currentCandidate.offer = offerData.offer;
            }
            renderModal(currentCandidate);
            elements.modal.classList.remove('hidden');
        }
    } catch (e) {
        console.error('Error fetching candidate details:', e);
        alert('Failed to load candidate details.');
    }
}

async function updateStatus(appId, newStatus) {
    const notesEl = document.getElementById('adminNotes');
    const notes = notesEl ? notesEl.value : (currentCandidate?.admin_notes || "");

    try {
        const res = await fetch(`/api/candidates/${appId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus, notes })
        });
        const data = await res.json();

        if (data.success) {
            currentCandidate = data.data;
            renderModal(currentCandidate);
            fetchCandidates();
            fetchStats();
        } else {
            alert('Error updating status: ' + (data.message || 'Unknown error'));
        }
    } catch (e) {
        console.error('Error updating status:', e);
        alert('Failed to update status.');
    }
}

async function quickUpdateCandidateStatus(appId, newStatus) {
    try {
        const res = await fetch(`/api/candidates/${appId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus, notes: '' })
        });
        const data = await res.json();
        if (data.success) {
            const verb = newStatus === 'shortlisted' ? 'Approved' : newStatus === 'rejected' ? 'Rejected' : newStatus;
            showToast(`Application ${appId} marked as ${verb}`, 'success');
            fetchCandidates();
            fetchStats();
        } else {
            showToast(data.message || 'Failed to update candidate', 'error');
        }
    } catch (e) {
        console.error('Error updating status:', e);
        showToast('Network error updating status', 'error');
    }
}

// Helpers
function getBadgeClass(status) {
    const s = (status || '').toLowerCase();
    if (s === 'pending') return 'pending';
    if (s === 'shortlisted') return 'shortlisted';
    if (s === 'rejected') return 'rejected';
    return '';
}

function formatStatus(status) {
    const s = (status || '').replace('_', ' ');
    if (s === 'shortlisted') return 'Approved';
    return s;
}

// Table Rendering
function renderTable(candidates) {
    if (!candidates || candidates.length === 0) {
        let msg = 'No pending candidates for review.';
        if (currentTab === 'approved') msg = 'No approved candidates yet.';
        if (currentTab === 'rejected') msg = 'No rejected candidates.';
        elements.tableBody.innerHTML = `<tr><td colspan="8" class="text-center">${msg}</td></tr>`;
        return;
    }

    elements.tableBody.innerHTML = candidates.map(c => {
        const badgeClass = getBadgeClass(c.status);
        const statusLabel = formatStatus(c.status);
        
        let timerHtml = '';
        if (c.time_tag && c.time_tag.toLowerCase() !== statusLabel.toLowerCase()) {
            timerHtml = `<span class="time-tag ${c.time_badge_class || ''}">${escapeHtml(c.time_tag)}</span>`;
        }

        let quickBtnsHtml = '';
        const normStatus = (c.status || '').toLowerCase();
        if (normStatus === 'pending') {
            quickBtnsHtml = `
                <button class="btn btn-green btn-sm" title="Approve application" onclick="event.stopPropagation(); quickUpdateCandidateStatus('${escapeHtml(c.app_id)}', 'shortlisted')">Approve</button>
                <button class="btn btn-red btn-sm" title="Reject application" onclick="event.stopPropagation(); quickUpdateCandidateStatus('${escapeHtml(c.app_id)}', 'rejected')">Reject</button>
            `;
        } else if (normStatus === 'shortlisted') {
            quickBtnsHtml = `
                <button class="btn btn-blue btn-sm" title="Onboard as Milky Mist Staff" onclick="event.stopPropagation(); onboardCandidate('${escapeHtml(c.app_id)}')">Onboard</button>
            `;
        }

        return `
            <tr>
                <td><code>${escapeHtml(c.app_id)}</code></td>
                <td><strong>${escapeHtml(c.name)}</strong></td>
                <td>${escapeHtml(c.email)}</td>
                <td>${escapeHtml(c.age || '—')}</td>
                <td>${escapeHtml(c.location)}</td>
                <td>${escapeHtml(c.phone)}</td>
                <td>
                    <div class="status-cell-wrap">
                        <span class="badge ${badgeClass}">${escapeHtml(statusLabel)}</span>
                        ${timerHtml}
                    </div>
                </td>
                <td style="white-space:nowrap;">
                    <div style="display:inline-flex; align-items:center; gap:0.35rem;">
                        <button class="btn btn-blue btn-sm" onclick="viewCandidate('${escapeHtml(c.app_id)}')">Review</button>
                        ${quickBtnsHtml}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// Modal Rendering
function renderModal(c) {
    elements.modalAppId.textContent = `— ${escapeHtml(c.app_id)}`;

    let resumeLink = '<span style="color:var(--text-secondary)">No resume attached</span>';
    if (c.resume_filename) {
        resumeLink = `<a href="/api/resume/${encodeURIComponent(c.resume_filename)}" class="btn btn-blue btn-sm" target="_blank" download>Download PDF Resume</a>`;
    }

    let offerBanner = '';
    if (c.offer) {
        offerBanner = `
            <div style="background:#F0FDF4; border:1px solid #86EFAC; border-radius:8px; padding:0.85rem 1.1rem; margin-bottom:1.25rem; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div style="font-weight:700; color:#15803D; font-size:0.9rem;">Official Appointment Offer Issued</div>
                    <div style="font-size:0.775rem; color:#475569; margin-top:0.2rem;">
                        Ref: <strong>${escapeHtml(c.offer.offer_ref)}</strong> • Annual CTC: <strong>${formatINR(c.offer.ctc_annual)}</strong> • Status: <span class="badge" style="background:#DCFCE7; color:#15803D; font-weight:600;">${escapeHtml(c.offer.offer_status || 'Issued')}</span>
                    </div>
                </div>
                <button type="button" class="btn btn-sm btn-blue" style="font-weight:600;" onclick="closeModal(); openOfferLetterModal('${escapeHtml(c.offer.offer_ref)}')">
                    View Offer Letter
                </button>
            </div>
        `;
    }

    elements.modalContent.innerHTML = `
        ${offerBanner}
        <div class="detail-grid">
            <div class="detail-item">
                <div class="label">Full Name</div>
                <div class="value">${escapeHtml(c.name)}</div>
            </div>
            <div class="detail-item">
                <div class="label">Email Address</div>
                <div class="value"><a href="mailto:${escapeHtml(c.email)}" style="color:var(--blue)">${escapeHtml(c.email)}</a></div>
            </div>
            <div class="detail-item">
                <div class="label">Phone Number</div>
                <div class="value">${escapeHtml(c.phone)}</div>
            </div>
            <div class="detail-item">
                <div class="label">Age / Date of Birth</div>
                <div class="value">${escapeHtml(c.age || 'N/A')} (${escapeHtml(c.dob)})</div>
            </div>
            <div class="detail-item">
                <div class="label">Location</div>
                <div class="value">${escapeHtml(c.location)}</div>
            </div>
            <div class="detail-item">
                <div class="label">Current Status</div>
                <div class="value">
                    <span class="badge ${getBadgeClass(c.status)}">${escapeHtml(formatStatus(c.status))}</span>
                    ${c.time_tag && c.time_tag.toLowerCase() !== formatStatus(c.status).toLowerCase() ? `<span class="time-tag ${c.time_badge_class || ''}" style="margin-left:0.4rem;">${escapeHtml(c.time_tag)}</span>` : ''}
                </div>
            </div>
            <div class="detail-item col-span-2">
                <div class="label">Resume Attachment</div>
                <div class="value">${resumeLink}</div>
            </div>
        </div>

        <div class="detail-section">
            <h3>Education & Qualifications</h3>
            <div class="pre-wrap">${escapeHtml(c.education || 'Not specified')}</div>
        </div>

        <div class="detail-section">
            <h3>Work Experience & Durations</h3>
            <div class="pre-wrap">${escapeHtml(c.work_experience || 'Fresher / No prior experience')}</div>
        </div>

        <div class="detail-section">
            <h3>Review & Interview Notes</h3>
            <textarea id="adminNotes" class="notes-input" placeholder="Add interview feedback, notes, or assessment rationale...">${escapeHtml(c.admin_notes || '')}</textarea>
        </div>

        <div class="modal-actions">
            <button type="button" class="btn btn-secondary" style="font-weight:500;" onclick="closeModal(); selectModule('interviews', 'Interviews & Scorecards'); openScheduleInterviewModal('${escapeHtml(c.app_id)}')">
                <span>Schedule Interview</span>
            </button>
            ${c.status === 'shortlisted' ? (c.offer ? `
                <button type="button" class="btn btn-blue" style="font-weight:600;" onclick="closeModal(); openOfferLetterModal('${escapeHtml(c.offer.offer_ref)}')">
                    <span>View Issued Offer</span>
                </button>
            ` : `
                <button type="button" class="btn btn-blue" style="font-weight:600;" onclick="closeModal(); openCreateOfferModalFromCandidate('${escapeHtml(c.app_id)}')">
                    <span>Generate Offer Letter</span>
                </button>
            `) : ''}
            ${c.status === 'shortlisted' && !c.in_pipeline ? `
                <button type="button" class="btn btn-blue" style="font-weight:600;" onclick="closeModal(); openStartRecruitmentModal('${escapeHtml(c.app_id)}')">
                    <span>Start Recruitment</span>
                </button>
            ` : ''}
            ${c.status === 'shortlisted' ? `
                <button type="button" class="btn" style="background:#0284C7; color:#FFFFFF; font-weight:600; box-shadow:0 2px 4px rgba(2,132,199,0.3); display:inline-flex; align-items:center; gap:0.4rem;" onclick="onboardCandidateAsEmployee('${escapeHtml(c.app_id)}')">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                        <circle cx="9" cy="7" r="4"></circle>
                        <line x1="19" y1="8" x2="19" y2="14"></line>
                        <line x1="22" y1="11" x2="16" y2="11"></line>
                    </svg>
                    <span>Onboard as Employee</span>
                </button>
            ` : ''}
            ${c.status !== 'shortlisted' ? `
                <button class="btn btn-green" onclick="updateStatus('${escapeHtml(c.app_id)}', 'shortlisted')">Approve</button>
            ` : ''}
            ${c.status !== 'rejected' ? `
                <button class="btn btn-red" onclick="updateStatus('${escapeHtml(c.app_id)}', 'rejected')">Reject</button>
            ` : ''}
            ${c.status !== 'pending' ? `
                <button class="btn btn-amber" onclick="updateStatus('${escapeHtml(c.app_id)}', 'pending')">Reset to Pending</button>
            ` : ''}
            <button class="btn btn-blue" style="margin-left:auto" onclick="updateStatus('${escapeHtml(c.app_id)}', '${escapeHtml(c.status)}')">Save Notes Only</button>
        </div>
    `;
}

// Tab Switching
function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    fetchCandidates();
}

if (elements.tabActive) elements.tabActive.addEventListener('click', () => switchTab('active'));
if (elements.tabApproved) elements.tabApproved.addEventListener('click', () => switchTab('approved'));
if (elements.tabRejected) elements.tabRejected.addEventListener('click', () => switchTab('rejected'));

// Filtering & Search
if (elements.searchInput) {
    elements.searchInput.addEventListener('input', debounce(() => fetchCandidates(), 300));
}

// Modal Close Handling
function closeModal() {
    elements.modal.classList.add('hidden');
    currentCandidate = null;
}

elements.closeModalBtn.addEventListener('click', closeModal);
elements.modalOverlay.addEventListener('click', (e) => {
    if (e.target === elements.modalOverlay) closeModal();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !elements.modal.classList.contains('hidden')) {
        closeModal();
    }
});

// Sidebar Module Navigation
const navItems = document.querySelectorAll('.nav-item');
const recruitmentView = document.getElementById('recruitmentView');
const placeholderView = document.getElementById('placeholderView');
const placeholderTitle = document.getElementById('placeholderTitle');
const moduleHeading = document.getElementById('moduleHeading');
const moduleSubheading = document.getElementById('moduleSubheading');
const backToRecruitmentBtn = document.getElementById('backToRecruitmentBtn');
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');

function selectModule(moduleName, labelText) {
    navItems.forEach(n => {
        n.classList.toggle('active', n.dataset.module === moduleName);
    });

    const approvedResumesView = document.getElementById('approvedResumesView');
    const usersView = document.getElementById('usersView');
    const tasksView = document.getElementById('tasksView');
    const employeesView = document.getElementById('employeesView');
    const recruitmentPipelineView = document.getElementById('recruitmentPipelineView');
    const analyticsView = document.getElementById('analyticsView');
    const interviewsView = document.getElementById('interviewsView');
    const attendanceView = document.getElementById('attendanceView');
    const auditView = document.getElementById('auditView');
    const settingsView = document.getElementById('settingsView');
    const payrollView = document.getElementById('payrollView');
    const leaveView = document.getElementById('leaveView');

    // Hide all views first
    recruitmentView.classList.add('hidden');
    if (approvedResumesView) approvedResumesView.classList.add('hidden');
    if (recruitmentPipelineView) recruitmentPipelineView.classList.add('hidden');
    placeholderView.classList.add('hidden');
    if (usersView) usersView.classList.add('hidden');
    if (tasksView) tasksView.classList.add('hidden');
    if (employeesView) employeesView.classList.add('hidden');
    if (analyticsView) analyticsView.classList.add('hidden');
    if (interviewsView) interviewsView.classList.add('hidden');
    if (attendanceView) attendanceView.classList.add('hidden');
    if (auditView) auditView.classList.add('hidden');
    if (settingsView) settingsView.classList.add('hidden');
    if (payrollView) payrollView.classList.add('hidden');
    if (leaveView) leaveView.classList.add('hidden');

    if (moduleName === 'recruitment') {
        recruitmentView.classList.remove('hidden');
        moduleHeading.textContent = 'Applications Received';
        moduleSubheading.innerHTML = `Applicant Intake & Review Pipeline • Total Applications: <span id="headerTotalCount">${elements.statsTotal ? elements.statsTotal.textContent : '0'}</span>`;
        fetchCandidates();
    } else if (moduleName === 'approved') {
        if (approvedResumesView) approvedResumesView.classList.remove('hidden');
        moduleHeading.textContent = 'Approved Resumes';
        moduleSubheading.textContent = 'Verified Applicants Ready for Recruitment & Workflow Evaluation • Milky Mist HR';
        fetchApprovedResumes();
    } else if (moduleName === 'recruitment_pipeline') {
        if (recruitmentPipelineView) recruitmentPipelineView.classList.remove('hidden');
        moduleHeading.textContent = 'Recruitment Pipeline';
        moduleSubheading.textContent = 'Active Candidate Evaluation, Workflow Stages, and Onboarding • Milky Mist HR';
        fetchRecruitmentPipeline();
    } else if (moduleName === 'employees') {
        if (employeesView) employeesView.classList.remove('hidden');
        moduleHeading.textContent = 'Onboarded Employees';
        moduleSubheading.textContent = 'Official Workforce & Active Staff Records • Milky Mist Dairy Food Private Limited';
        fetchEmployeeStats();
        fetchEmployees();
    } else if (moduleName === 'tasks') {
        if (tasksView) tasksView.classList.remove('hidden');
        moduleHeading.textContent = 'Tasks & Reminders';
        moduleSubheading.textContent = 'Action items, reminders, and team assignments for Milky Mist HR';
        fetchMyTasks();
        if (currentUser && currentUser.can_create_users) {
            fetchAllTasks();
        }
    } else if (moduleName === 'users') {
        if (usersView) usersView.classList.remove('hidden');
        moduleHeading.textContent = 'User & Access Control';
        moduleSubheading.textContent = 'Manage internal staff accounts • Only dev123 and admin123 can create users';
        fetchUsers();
    } else if (moduleName === 'employees') {
        if (employeesView) employeesView.classList.remove('hidden');
        moduleHeading.textContent = 'Employee Directory';
        moduleSubheading.textContent = 'Workforce & Staff Records • Milky Mist Dairy Food Private Limited';
        fetchEmployeeStats();
        fetchEmployees();
    } else if (moduleName === 'analytics') {
        if (analyticsView) analyticsView.classList.remove('hidden');
        moduleHeading.textContent = 'HR & Operations Analytics';
        moduleSubheading.textContent = 'Enterprise Intelligence & Telemetry • Perundurai Mega Plant (HQ) & Bengaluru';
        fetchAnalyticsOverview();
    } else if (moduleName === 'interviews') {
        if (interviewsView) interviewsView.classList.remove('hidden');
        moduleHeading.textContent = 'Interview Scheduling & Scorecards';
        moduleSubheading.textContent = 'Technical & Food Safety Evaluations • Milky Mist Recruitment Pipeline';
        fetchInterviews();
    } else if (moduleName === 'attendance') {
        if (attendanceView) attendanceView.classList.remove('hidden');
        moduleHeading.textContent = 'Shift Roster & Daily Attendance';
        moduleSubheading.textContent = 'Plant Shifts (A/B/C) Roll Call • Perundurai Mega Plant & Bengaluru';
        initAttendanceView();
    } else if (moduleName === 'leave') {
        if (leaveView) leaveView.classList.remove('hidden');
        moduleHeading.textContent = 'Leave & Time-Off Management';
        moduleSubheading.textContent = 'Staff annual quotas, leave applications, manager approvals, and payroll sync • Milky Mist';
        fetchLeaveStats();
        fetchLeaveRequests();
        fetchLeaveBalances();
    } else if (moduleName === 'payroll') {
        if (payrollView) payrollView.classList.remove('hidden');
        moduleHeading.textContent = 'Payroll & Salary Management';
        moduleSubheading.textContent = 'Monthly compensation calculation, attendance deductions, and payslips • Milky Mist';
        fetchPayroll();
        fetchPayrollStats();
    } else if (moduleName === 'audit') {
        if (auditView) auditView.classList.remove('hidden');
        moduleHeading.textContent = 'System Audit Trail';
        moduleSubheading.textContent = 'Immutable Enterprise Activity Log • Milky Mist Security & Governance';
        fetchAuditLogs();
    } else if (moduleName === 'settings') {
        if (settingsView) settingsView.classList.remove('hidden');
        moduleHeading.textContent = 'Master Control Center & Site Settings';
        moduleSubheading.textContent = 'Global configuration & User Access Control • Milky Mist Dairy Food Private Limited';
        fetchSettings();
        fetchMasterPermissionsMatrix();
    } else {
        placeholderView.classList.remove('hidden');
        moduleHeading.textContent = labelText || 'Module';
        moduleSubheading.textContent = `Milky Mist HR System • ${labelText || 'Module'}`;
        if (placeholderTitle) placeholderTitle.textContent = labelText || 'Module';
    }

    if (window.innerWidth <= 1024 && sidebar) {
        sidebar.classList.remove('mobile-open');
    }
}

navItems.forEach(item => {
    item.addEventListener('click', () => {
        const moduleName = item.dataset.module;
        const label = item.querySelector('.nav-label')?.textContent || '';
        selectModule(moduleName, label);
    });
});

if (backToRecruitmentBtn) {
    backToRecruitmentBtn.addEventListener('click', () => {
        selectModule('recruitment', 'Recruitment');
    });
}

// Sidebar Hover-to-Expand & Pin-in-Place Controller
const pinSidebarBtn = document.getElementById('pinSidebarBtn');
const appContainer = document.querySelector('.app-container');

function setSidebarPinned(pinned, save = true) {
    if (!sidebar) return;

    if (pinned) {
        sidebar.classList.add('pinned');
        sidebar.classList.remove('hover-expanded');
        if (appContainer) appContainer.classList.add('sidebar-is-pinned');
        if (pinSidebarBtn) {
            pinSidebarBtn.classList.add('is-pinned');
            pinSidebarBtn.setAttribute('title', 'Unpin sidebar (auto-collapses on leave)');
            pinSidebarBtn.setAttribute('aria-label', 'Unpin sidebar');
            pinSidebarBtn.style.display = 'inline-flex';
        }
    } else {
        sidebar.classList.remove('pinned');
        if (appContainer) appContainer.classList.remove('sidebar-is-pinned');
        if (pinSidebarBtn) {
            pinSidebarBtn.classList.remove('is-pinned');
            pinSidebarBtn.setAttribute('title', 'Pin sidebar open in place');
            pinSidebarBtn.setAttribute('aria-label', 'Pin sidebar open');
            pinSidebarBtn.style.display = 'none';
        }
    }

    if (save) {
        try {
            localStorage.setItem('mm_sidebar_pinned', pinned ? '1' : '0');
        } catch (e) {}
    }
}

// Initial pin state (default unpinned, or restore user preference)
let isPinned = false;
try {
    isPinned = localStorage.getItem('mm_sidebar_pinned') === '1';
} catch (e) {}
setSidebarPinned(isPinned, false);
if (pinSidebarBtn) {
    pinSidebarBtn.style.display = isPinned ? 'inline-flex' : 'none';
}

// Hover to expand / collapse when unpinned
if (sidebar) {
    sidebar.addEventListener('mouseenter', () => {
        if (!sidebar.classList.contains('pinned') && window.innerWidth > 1024) {
            sidebar.classList.add('hover-expanded');
            if (pinSidebarBtn) pinSidebarBtn.style.display = 'inline-flex';
        }
    });

    sidebar.addEventListener('mouseleave', () => {
        if (!sidebar.classList.contains('pinned') && window.innerWidth > 1024) {
            sidebar.classList.remove('hover-expanded');
            if (pinSidebarBtn) pinSidebarBtn.style.display = 'none';
        }
    });
}

// Pin Button Click: locks/unlocks menu in place
if (pinSidebarBtn) {
    pinSidebarBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const currentlyPinned = sidebar.classList.contains('pinned');
        setSidebarPinned(!currentlyPinned, true);
        showToast(currentlyPinned ? 'Sidebar unpinned (auto-collapses on leave)' : 'Sidebar pinned in place', 'info');
    });
}

// Top Workspace Header Sidebar Toggle
const headerSidebarToggle = document.getElementById('headerSidebarToggle');
if (headerSidebarToggle && sidebar) {
    headerSidebarToggle.addEventListener('click', () => {
        if (window.innerWidth <= 1024) {
            sidebar.classList.toggle('mobile-open');
        } else {
            const currentlyPinned = sidebar.classList.contains('pinned');
            setSidebarPinned(!currentlyPinned, true);
            showToast(currentlyPinned ? 'Sidebar unpinned' : 'Sidebar pinned open', 'info');
        }
    });
}

// Current authenticated user state
let currentUser = null;

async function checkAuth() {
    try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) {
            window.location.href = '/login';
            return;
        }
        const data = await res.json();
        if (!data.success || !data.data) {
            window.location.href = '/login';
            return;
        }

        currentUser = data.data;

        // Populate user footer
        const userDisplayName = document.getElementById('userDisplayName');
        const userRoleTitle = document.getElementById('userRoleTitle');
        const userAvatar = document.getElementById('userAvatar');
        const navUsers = document.getElementById('navUsers');

        if (userDisplayName) userDisplayName.textContent = currentUser.name || currentUser.username;
        if (userRoleTitle) userRoleTitle.textContent = `${(currentUser.role || 'user').toUpperCase()} • Milky Mist`;
        if (userAvatar) {
            const rawName = currentUser.name || currentUser.username || 'MM';
            const initials = rawName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase() || 'MM';
            userAvatar.textContent = initials;
        }

        // Show User Management menu ONLY for dev123 and admin123
        if (navUsers) {
            if (currentUser.can_create_users) {
                navUsers.classList.remove('hidden');
            } else {
                navUsers.classList.add('hidden');
            }
        }

        // Configure tasks UI permissions
        const openCreateTaskModalBtn = document.getElementById('openCreateTaskModalBtn');
        const taskTabAll = document.getElementById('taskTabAll');
        if (currentUser.can_create_users) {
            if (openCreateTaskModalBtn) openCreateTaskModalBtn.classList.remove('hidden');
            if (taskTabAll) taskTabAll.classList.remove('hidden');
        } else {
            if (openCreateTaskModalBtn) openCreateTaskModalBtn.classList.add('hidden');
            if (taskTabAll) taskTabAll.classList.add('hidden');
        }

        requestNotificationPermissionOnce();
        applyUserClientPermissions();
        fetchNotifications();
        fetchMyTasks();
        fetchLeaveStats();
        if (currentUser.can_create_users) {
            fetchAllTasks();
            fetchUsers();
            fetchMasterPermissionsMatrix();
        }
    } catch (e) {
        console.error('Auth verification error:', e);
        window.location.href = '/login';
    }
}

// Logout handler
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Are you sure you want to sign out of the Milky Mist HR Portal?')) return;
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
        } catch (e) {}
        window.location.href = '/login';
    });
}

// User Management Logic
async function fetchUsers() {
    const tableBody = document.getElementById('usersTableBody');
    if (!tableBody) return;

    try {
        tableBody.innerHTML = '<tr><td colspan="6" class="text-center">Loading users...</td></tr>';
        const res = await fetch('/api/auth/users');
        const data = await res.json();

        if (data.success && data.data) {
            const users = data.data;
            const countEl = document.getElementById('navUsersCount');
            if (countEl) {
                countEl.textContent = users.length;
                countEl.style.display = 'inline-block';
            }

            tableBody.innerHTML = users.map(u => {
                const canCreateBadge = u.can_create_users
                    ? '<span class="badge shortlisted">Authorized (Can Create Users)</span>'
                    : '<span class="badge" style="background:rgba(100,116,139,0.2);color:#94a3b8;">Standard (Sign In / Out Only)</span>';
                
                return `
                    <tr>
                        <td><code>USR-${String(u.id).padStart(3, '0')}</code></td>
                        <td><strong>${escapeHtml(u.username)}</strong></td>
                        <td>${escapeHtml(u.name)}</td>
                        <td><span class="badge-role ${escapeHtml(u.role)}">${escapeHtml(u.role)}</span></td>
                        <td>${canCreateBadge}</td>
                        <td>${escapeHtml(u.created_at || '—')}</td>
                    </tr>
                `;
            }).join('');
        } else {
            tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-red">Failed to load users list.</td></tr>';
        }
    } catch (e) {
        tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-red">Failed to load users list.</td></tr>';
    }
}

// Create User Modal Handlers
const createUserModal = document.getElementById('createUserModal');
const openCreateUserModalBtn = document.getElementById('openCreateUserModalBtn');
const closeCreateUserModalBtn = document.getElementById('closeCreateUserModalBtn');
const cancelCreateUserBtn = document.getElementById('cancelCreateUserBtn');
const createUserForm = document.getElementById('createUserForm');
const createUserAlert = document.getElementById('createUserAlert');
const createUserAlertText = document.getElementById('createUserAlertText');

function openCreateModal() {
    if (createUserModal) {
        createUserModal.classList.remove('hidden');
        if (createUserAlert) createUserAlert.style.display = 'none';
        if (createUserForm) createUserForm.reset();

        const roleSelect = document.getElementById('newRoleSelect');
        const policyNote = document.getElementById('userSecurityPolicyNote');
        if (roleSelect) {
            if (currentUser && currentUser.role === 'developer') {
                roleSelect.innerHTML = `
                    <option value="admin">HR Admin (Admin with User Creation Privileges)</option>
                    <option value="recruiter">HR Recruiter (Standard User)</option>
                    <option value="staff" selected>HR Staff / Officer (Standard User)</option>
                    <option value="viewer">Viewer (Read Only)</option>
                `;
                if (policyNote) {
                    policyNote.innerHTML = '<strong>Security Policy:</strong> As Developer, you can create new <strong>Admin</strong> and <strong>User</strong> accounts.';
                }
            } else {
                roleSelect.innerHTML = `
                    <option value="recruiter">HR Recruiter (Standard User)</option>
                    <option value="staff" selected>HR Staff / Officer (Standard User)</option>
                    <option value="viewer">Viewer (Read Only)</option>
                `;
                if (policyNote) {
                    policyNote.innerHTML = '<strong>Security Policy:</strong> As HR Admin, you can create standard <strong>User</strong> accounts (Recruiter, Staff, Viewer). Admin accounts can only be created by Developers.';
                }
            }
        }

        document.getElementById('newUsernameInput')?.focus();
    }
}

function closeCreateModal() {
    if (createUserModal) createUserModal.classList.add('hidden');
}

if (openCreateUserModalBtn) openCreateUserModalBtn.addEventListener('click', openCreateModal);
if (closeCreateUserModalBtn) closeCreateUserModalBtn.addEventListener('click', closeCreateModal);
if (cancelCreateUserBtn) cancelCreateUserBtn.addEventListener('click', closeCreateModal);

if (createUserModal) {
    createUserModal.addEventListener('click', (e) => {
        if (e.target === createUserModal) closeCreateModal();
    });
}

if (createUserForm) {
    createUserForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (createUserAlert) createUserAlert.style.display = 'none';

        const username = document.getElementById('newUsernameInput')?.value.trim();
        const name = document.getElementById('newFullNameInput')?.value.trim();
        const password = document.getElementById('newPasswordInput')?.value;
        const role = document.getElementById('newRoleSelect')?.value || 'staff';

        const submitBtn = document.getElementById('submitCreateUserBtn');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Creating...';
        }

        try {
            const res = await fetch('/api/auth/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, name, role })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.detail || data.message || 'Failed to create user.');
            }

            closeCreateModal();
            fetchUsers();
            alert(`User account '${data.data.username}' created successfully.`);
        } catch (err) {
            if (createUserAlert && createUserAlertText) {
                createUserAlertText.textContent = err.message;
                createUserAlert.style.display = 'block';
            }
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Create Account';
            }
        }
    });
}

// ==========================================================================
// Notifications & Reminders Bell Controller
// ==========================================================================
const notifBellBtn = document.getElementById('notifBellBtn');
const notifDropdown = document.getElementById('notifDropdown');
const notifBadgeCount = document.getElementById('notifBadgeCount');
const notifUnreadSummary = document.getElementById('notifUnreadSummary');
const notifListContainer = document.getElementById('notifListContainer');
const notifMarkAllBtn = document.getElementById('notifMarkAllBtn');
const notifViewAllTasksBtn = document.getElementById('notifViewAllTasksBtn');

async function fetchNotifications() {
    try {
        const res = await fetch('/api/notifications');
        const data = await res.json();
        if (data.success && data.data) {
            const notifs = data.data.notifications || [];
            const unreadCount = data.data.unread_count || 0;
            const pendingCount = data.data.pending_count || 0;

            // Check for tasks with reminders due
            evaluateDueReminders(notifs);

            // Update badge on top bar bell
            if (notifBadgeCount) {
                if (unreadCount > 0) {
                    notifBadgeCount.textContent = unreadCount > 99 ? '99+' : unreadCount;
                    notifBadgeCount.style.display = 'inline-flex';
                } else {
                    notifBadgeCount.style.display = 'none';
                }
            }

            // Update badge on sidebar Tasks item
            const navTasksBadge = document.getElementById('navTasksBadge');
            if (navTasksBadge) {
                if (pendingCount > 0) {
                    navTasksBadge.textContent = pendingCount;
                    navTasksBadge.style.display = 'inline-block';
                } else {
                    navTasksBadge.style.display = 'none';
                }
            }

            // Update sub-tab count in tasks view
            const taskMyCount = document.getElementById('taskMyCount');
            if (taskMyCount) {
                taskMyCount.textContent = notifs.length;
            }

            // Update summary text
            if (notifUnreadSummary) {
                notifUnreadSummary.textContent = `${unreadCount} unread update${unreadCount === 1 ? '' : 's'}`;
            }

            // Render notifications list
            if (notifListContainer) {
                if (notifs.length === 0) {
                    notifListContainer.innerHTML = '<div class="notif-empty">No assigned tasks or notifications yet.</div>';
                } else {
                    notifListContainer.innerHTML = notifs.map(n => {
                        const isUnread = !n.is_read;
                        const dueBadge = n.due_date ? `<span>Due: ${escapeHtml(n.due_date.replace('T', ' '))}</span>` : '';
                        const priorityClass = n.priority || 'medium';
                        const statusTag = n.is_completed 
                            ? `<span class="badge" style="background:#DCFCE7; color:#15803D; font-size:0.7rem; font-weight:600;">Done</span>`
                            : `<span class="badge" style="background:#FEF3C7; color:#B45309; font-size:0.7rem; font-weight:600;">Pending</span>`;
                        const quickActionBtn = !n.is_completed
                            ? `<button type="button" class="btn btn-sm btn-green" style="padding:0.2rem 0.65rem; font-size:0.72rem; margin-left:auto; border-radius:4px;" onclick="event.stopPropagation(); handleToggleTaskComplete(${n.task_id}, true)">Mark as Done</button>`
                            : `<span style="margin-left:auto; font-size:0.72rem; color:#15803D; font-weight:700;">Completed</span>`;
                        return `
                            <div class="notif-item ${isUnread ? 'unread' : ''}" data-notif-id="${n.notification_id}">
                                <div class="notif-dot ${isUnread ? '' : 'read'}"></div>
                                <div class="notif-body">
                                    <div class="notif-title" style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem;">
                                        <span>${escapeHtml(n.title)}</span>
                                        ${statusTag}
                                    </div>
                                    ${n.description ? `<div class="notif-desc">${escapeHtml(n.description)}</div>` : ''}
                                    <div class="notif-meta-row" style="display:flex; align-items:center;">
                                        <span class="badge-priority ${priorityClass}">${escapeHtml(priorityClass)}</span>
                                        ${dueBadge}
                                        <span>From: ${escapeHtml(n.created_by)}</span>
                                        ${quickActionBtn}
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('');

                    // Clicking a notification marks it read and jumps to Tasks view
                    notifListContainer.querySelectorAll('.notif-item').forEach(el => {
                        el.addEventListener('click', async () => {
                            const notifId = el.dataset.notifId;
                            try {
                                await fetch(`/api/notifications/${notifId}/read`, { method: 'POST' });
                            } catch (e) {}
                            if (notifDropdown) notifDropdown.classList.add('hidden');
                            selectModule('tasks', 'Tasks & Reminders');
                            fetchNotifications();
                        });
                    });
                }
            }
        }
    } catch (e) {
        console.error('Error fetching notifications:', e);
    }
}

if (notifBellBtn && notifDropdown) {
    notifBellBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        notifDropdown.classList.toggle('hidden');
        if (!notifDropdown.classList.contains('hidden')) {
            fetchNotifications();
        }
    });

    document.addEventListener('click', (e) => {
        if (!notifDropdown.contains(e.target) && e.target !== notifBellBtn && !notifBellBtn.contains(e.target)) {
            notifDropdown.classList.add('hidden');
        }
    });
}

if (notifMarkAllBtn) {
    notifMarkAllBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
            await fetch('/api/notifications/read-all', { method: 'POST' });
            fetchNotifications();
            fetchMyTasks();
        } catch (e) {}
    });
}

if (notifViewAllTasksBtn) {
    notifViewAllTasksBtn.addEventListener('click', () => {
        if (notifDropdown) notifDropdown.classList.add('hidden');
        selectModule('tasks', 'Tasks & Reminders');
    });
}

// ==========================================================================
// Tasks & Reminders View Logic
// ==========================================================================
let currentTaskStatusFilter = 'all';

function setTaskStatusFilter(filter) {
    currentTaskStatusFilter = filter;

    const pills = document.querySelectorAll('.task-filter-pill');
    pills.forEach(p => {
        if (p.getAttribute('data-task-filter') === filter) {
            p.classList.add('active');
        } else {
            p.classList.remove('active');
        }
    });

    const pendingSection = document.getElementById('pendingTasksSectionGroup');
    const completedSection = document.getElementById('completedTasksSectionGroup');

    if (filter === 'all') {
        if (pendingSection) pendingSection.style.display = '';
        if (completedSection) completedSection.style.display = '';
    } else if (filter === 'pending') {
        if (pendingSection) pendingSection.style.display = '';
        if (completedSection) completedSection.style.display = 'none';
    } else if (filter === 'completed') {
        if (pendingSection) pendingSection.style.display = 'none';
        if (completedSection) completedSection.style.display = '';
    }
}

function renderTaskItemCard(n) {
    const isDone = n.is_completed;
    const priorityClass = (n.priority || 'medium').toLowerCase();
    const formattedDue = n.due_date ? n.due_date.replace('T', ' ') : 'No deadline';
    const dueDateObj = n.due_date ? new Date(n.due_date) : null;
    const isOverdue = !isDone && dueDateObj && (Date.now() > dueDateObj.getTime());

    return `
        <div class="task-list-item priority-${priorityClass} ${isDone ? 'completed' : ''}" id="taskRow_${n.task_id}">
            <div class="task-list-content">
                <div class="task-list-top-meta">
                    <span class="badge-priority ${priorityClass}">${escapeHtml(priorityClass.toUpperCase())}</span>
                    <span class="task-due-chip ${isOverdue ? 'overdue' : ''}">Due: ${escapeHtml(formattedDue)}</span>
                    <span class="badge" style="background:#F1F5F9; color:#475569; font-size:0.75rem;">Assigned by: <strong>${escapeHtml(n.created_by)}</strong></span>
                    ${isDone 
                        ? '<span class="badge" style="background:#DCFCE7; color:#15803D; font-weight:600;">Completed</span>' 
                        : (isOverdue 
                            ? '<span class="badge" style="background:#FEE2E2; color:#B91C1C; font-weight:700;">OVERDUE</span>' 
                            : '<span class="badge" style="background:#FEF3C7; color:#B45309; font-weight:600;">Pending Action</span>')}
                </div>
                <h4 class="task-list-title">${escapeHtml(n.title)}</h4>
                ${n.description ? `<p class="task-list-desc">${escapeHtml(n.description)}</p>` : ''}
            </div>
            <div class="task-list-actions">
                ${isDone ? `
                    <button type="button" class="btn-task-action mark-reopen-btn" onclick="handleToggleTaskComplete(${n.task_id}, false)">
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M1 4v6h6"></path>
                            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
                        </svg>
                        <span>Completed — Click to Reopen</span>
                    </button>
                ` : `
                    <button type="button" class="btn-task-action mark-done-btn" onclick="handleToggleTaskComplete(${n.task_id}, true)">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                        <span>Mark as Done</span>
                    </button>
                `}
            </div>
        </div>
    `;
}

async function fetchMyTasks() {
    const pendingListEl = document.getElementById('pendingTasksList');
    const completedListEl = document.getElementById('completedTasksList');
    const emptyAllEl = document.getElementById('myTasksEmptyAll');
    const pendingSectionEl = document.getElementById('pendingTasksSectionGroup');
    const completedSectionEl = document.getElementById('completedTasksSectionGroup');
    const pendingEmptyEl = document.getElementById('pendingTasksEmpty');
    const completedEmptyEl = document.getElementById('completedTasksEmpty');

    const pendingBadge = document.getElementById('pendingTasksCountBadge');
    const completedBadge = document.getElementById('completedTasksCountBadge');
    const pillAllCount = document.getElementById('taskFilterAllCount');
    const pillPendingCount = document.getElementById('taskFilterPendingCount');
    const pillCompletedCount = document.getElementById('taskFilterCompletedCount');
    const taskMyCount = document.getElementById('taskMyCount');

    try {
        const res = await fetch('/api/notifications');
        const data = await res.json();
        if (data.success && data.data) {
            const notifs = data.data.notifications || [];
            latestUserTasks = notifs;

            const pendingTasks = notifs.filter(n => !n.is_completed);
            const completedTasks = notifs.filter(n => n.is_completed);

            // Update badge counts
            if (pillAllCount) pillAllCount.textContent = notifs.length;
            if (pillPendingCount) pillPendingCount.textContent = pendingTasks.length;
            if (pillCompletedCount) pillCompletedCount.textContent = completedTasks.length;
            if (pendingBadge) pendingBadge.textContent = pendingTasks.length;
            if (completedBadge) completedBadge.textContent = completedTasks.length;
            if (taskMyCount) taskMyCount.textContent = notifs.length;

            if (notifs.length === 0) {
                if (emptyAllEl) emptyAllEl.classList.remove('hidden');
                if (pendingSectionEl) pendingSectionEl.classList.add('hidden');
                if (completedSectionEl) completedSectionEl.classList.add('hidden');
                return;
            }

            if (emptyAllEl) emptyAllEl.classList.add('hidden');
            if (pendingSectionEl) pendingSectionEl.classList.remove('hidden');
            if (completedSectionEl) completedSectionEl.classList.remove('hidden');

            // Render Pending Tasks
            if (pendingListEl) {
                if (pendingTasks.length === 0) {
                    pendingListEl.innerHTML = '';
                    if (pendingEmptyEl) pendingEmptyEl.classList.remove('hidden');
                } else {
                    if (pendingEmptyEl) pendingEmptyEl.classList.add('hidden');
                    pendingListEl.innerHTML = pendingTasks.map(n => renderTaskItemCard(n)).join('');
                }
            }

            // Render Completed Tasks
            if (completedListEl) {
                if (completedTasks.length === 0) {
                    completedListEl.innerHTML = '';
                    if (completedEmptyEl) completedEmptyEl.classList.remove('hidden');
                } else {
                    if (completedEmptyEl) completedEmptyEl.classList.add('hidden');
                    completedListEl.innerHTML = completedTasks.map(n => renderTaskItemCard(n)).join('');
                }
            }

            // Re-apply filter visibility
            setTaskStatusFilter(currentTaskStatusFilter);
        }
    } catch (e) {
        console.error('Error loading my tasks:', e);
    }
}

async function handleToggleTaskComplete(taskId, markDone) {
    try {
        const res = await fetch(`/api/tasks/${taskId}/toggle-complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_completed: markDone })
        });
        const data = await res.json();
        if (data.success) {
            showToast(markDone ? 'Task marked as completed.' : 'Task reopened as pending.', markDone ? 'success' : 'info');
            await fetchMyTasks();
            await fetchNotifications();
            if (currentUser && currentUser.can_create_users) {
                await fetchAllTasks();
            }
        }
    } catch (err) {
        console.error('Error toggling task completion:', err);
        showToast('Failed to update task completion.', 'error');
    }
}

let loadedAllTasks = [];

async function fetchAllTasks() {
    const tableBody = document.getElementById('allTasksTableBody');
    if (!tableBody) return;
    try {
        tableBody.innerHTML = '<tr><td colspan="8" class="text-center">Loading organizational tasks...</td></tr>';
        const res = await fetch('/api/tasks/all');
        const data = await res.json();
        if (data.success && data.data) {
            const tasks = data.data;
            loadedAllTasks = tasks;
            const taskAllCount = document.getElementById('taskAllCount');
            if (taskAllCount) taskAllCount.textContent = tasks.length;

            if (tasks.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="8" class="text-center" style="padding:2rem;">No organizational tasks assigned yet.</td></tr>';
                return;
            }

            tableBody.innerHTML = tasks.map(t => {
                const priorityClass = t.priority || 'medium';
                const formattedDue = t.due_date ? t.due_date.replace('T', ' ') : '—';
                const scopeBadge = t.assigned_type === 'everyone'
                    ? '<span class="badge shortlisted">Everyone (All Staff)</span>'
                    : (t.assigned_type === 'multiple'
                        ? `<span class="badge" style="background:var(--blue-subtle);color:var(--blue);border:1px solid #BFDBFE;">Multiple (${t.assignees_count})</span>`
                        : '<span class="badge" style="background:var(--bg-canvas);color:var(--text-secondary);border:1px solid var(--border-color);">Single User</span>');

                const assigneeStatusPills = (t.assignees || []).map(a => {
                    const statusClass = a.is_completed ? 'done' : 'pending';
                    const icon = a.is_completed ? '✓' : '○';
                    return `<span class="task-assignee-pill ${statusClass}" title="${escapeHtml(a.username)} (${a.is_completed ? 'Completed' : 'Pending'})">${icon} ${escapeHtml(a.username)}</span>`;
                }).join(' ');

                const progressText = `<div style="font-size:0.75rem; color:var(--text-secondary); margin-bottom:0.25rem;">${t.completed_count} of ${t.assignees_count} completed</div>`;

                return `
                    <tr>
                        <td><code>TSK-${String(t.id).padStart(3, '0')}</code></td>
                        <td><strong>${escapeHtml(t.title)}</strong></td>
                        <td><span class="badge-priority ${priorityClass}">${escapeHtml(priorityClass)}</span></td>
                        <td>${escapeHtml(formattedDue)}</td>
                        <td>${scopeBadge}</td>
                        <td>${progressText}<div>${assigneeStatusPills}</div></td>
                        <td><code>${escapeHtml(t.created_by)}</code></td>
                        <td>
                            <div style="display:flex; gap:0.4rem; align-items:center;">
                                <button type="button" class="btn btn-blue" style="padding:0.3rem 0.6rem; font-size:0.75rem;" onclick="handleEditTask(${t.id})">Edit</button>
                                <button type="button" class="btn btn-red" style="padding:0.3rem 0.6rem; font-size:0.75rem;" onclick="handleDeleteTask(${t.id})">Delete</button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        }
    } catch (e) {
        tableBody.innerHTML = '<tr><td colspan="8" class="text-center text-red">Failed to load organizational tasks.</td></tr>';
    }
}

window.handleDeleteTask = async function(taskId) {
    if (!confirm(`Are you sure you want to remove task TSK-${taskId}? It will be removed for all assigned users.`)) return;
    try {
        const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
        if (res.ok) {
            fetchAllTasks();
            fetchMyTasks();
            fetchNotifications();
        }
    } catch (e) {
        alert('Failed to delete task.');
    }
};

window.handleEditTask = async function(taskId) {
    let task = loadedAllTasks.find(t => t.id === taskId);
    if (!task) {
        try {
            const res = await fetch(`/api/tasks/${taskId}`);
            const data = await res.json();
            if (data.success) task = data.data;
        } catch (e) {}
    }
    if (!task) {
        alert('Could not load task details.');
        return;
    }

    if (createTaskModal) {
        createTaskModal.classList.remove('hidden');
        if (createTaskAlert) createTaskAlert.style.display = 'none';
        if (createTaskForm) createTaskForm.reset();

        const editingIdInput = document.getElementById('editingTaskId');
        if (editingIdInput) editingIdInput.value = task.id;

        const modalTitle = document.getElementById('createTaskModalTitle');
        if (modalTitle) modalTitle.textContent = 'Edit Assigned Task';

        const submitBtn = document.getElementById('submitCreateTaskBtn');
        if (submitBtn) submitBtn.textContent = 'Save Changes';

        const titleInput = document.getElementById('taskTitleInput');
        if (titleInput) titleInput.value = task.title || '';

        const descInput = document.getElementById('taskDescInput');
        if (descInput) descInput.value = task.description || '';

        const dueDateInput = document.getElementById('taskDueDateInput');
        if (dueDateInput) dueDateInput.value = task.due_date || '';

        const prioritySelect = document.getElementById('taskPrioritySelect');
        if (prioritySelect) prioritySelect.value = task.priority || 'medium';

        const assignTypeSelect = document.getElementById('taskAssignTypeSelect');
        if (assignTypeSelect) assignTypeSelect.value = task.assigned_type || 'single';

        const assignees = (task.assignees || []).map(a => a.username);
        await populateTaskAssignees(assignees);

        if (task.assigned_type === 'single') {
            if (taskUserSelectWrap) taskUserSelectWrap.classList.remove('hidden');
            if (taskMultiUserWrap) taskMultiUserWrap.classList.add('hidden');
            if (taskSingleUserSelect && assignees.length > 0) {
                taskSingleUserSelect.value = assignees[0];
            }
        } else if (task.assigned_type === 'multiple') {
            if (taskUserSelectWrap) taskUserSelectWrap.classList.add('hidden');
            if (taskMultiUserWrap) taskMultiUserWrap.classList.remove('hidden');
        } else {
            if (taskUserSelectWrap) taskUserSelectWrap.classList.add('hidden');
            if (taskMultiUserWrap) taskMultiUserWrap.classList.add('hidden');
        }

        document.getElementById('taskTitleInput')?.focus();
    }
};

// Sub-tabs in Tasks View
const taskTabMy = document.getElementById('taskTabMy');
const taskTabAll = document.getElementById('taskTabAll');
const myTasksSection = document.getElementById('myTasksSection');
const allTasksSection = document.getElementById('allTasksSection');

if (taskTabMy && taskTabAll) {
    taskTabMy.addEventListener('click', () => {
        taskTabMy.classList.add('active');
        taskTabAll.classList.remove('active');
        if (myTasksSection) myTasksSection.classList.remove('hidden');
        if (allTasksSection) allTasksSection.classList.add('hidden');
        fetchMyTasks();
    });

    taskTabAll.addEventListener('click', () => {
        taskTabAll.classList.add('active');
        taskTabMy.classList.remove('active');
        if (myTasksSection) myTasksSection.classList.add('hidden');
        if (allTasksSection) allTasksSection.classList.remove('hidden');
        fetchAllTasks();
    });
}

// ==========================================================================
// Create Task & Assign Reminder Modal
// ==========================================================================
const createTaskModal = document.getElementById('createTaskModal');
const openCreateTaskModalBtn = document.getElementById('openCreateTaskModalBtn');
const closeCreateTaskModalBtn = document.getElementById('closeCreateTaskModalBtn');
const cancelCreateTaskBtn = document.getElementById('cancelCreateTaskBtn');
const createTaskForm = document.getElementById('createTaskForm');
const createTaskAlert = document.getElementById('createTaskAlert');
const createTaskAlertText = document.getElementById('createTaskAlertText');
const taskAssignTypeSelect = document.getElementById('taskAssignTypeSelect');
const taskUserSelectWrap = document.getElementById('taskUserSelectWrap');
const taskSingleUserSelect = document.getElementById('taskSingleUserSelect');
const taskMultiUserWrap = document.getElementById('taskMultiUserWrap');

async function populateTaskAssignees(preselectedUsernames = []) {
    try {
        const res = await fetch('/api/auth/users');
        const data = await res.json();
        if (data.success && data.data) {
            let users = data.data;

            // Admin cannot assign task to developer; developers can assign to anyone
            if (currentUser && currentUser.role === 'admin') {
                users = users.filter(u => u.role !== 'developer');
            }

            if (taskSingleUserSelect) {
                taskSingleUserSelect.innerHTML = users.map(u => {
                    const isSelected = preselectedUsernames.includes(u.username) ? 'selected' : '';
                    return `<option value="${escapeHtml(u.username)}" ${isSelected}>${escapeHtml(u.name || u.username)} (@${escapeHtml(u.username)} • ${escapeHtml(u.role)})</option>`;
                }).join('');
            }

            if (taskMultiUserWrap) {
                taskMultiUserWrap.innerHTML = users.map(u => {
                    const isChecked = preselectedUsernames.includes(u.username) ? 'checked' : '';
                    return `
                        <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.825rem; color:var(--text-primary); margin-bottom:0.4rem; cursor:pointer;">
                            <input type="checkbox" name="multiAssignUser" value="${escapeHtml(u.username)}" ${isChecked} style="accent-color:var(--blue);" />
                            <span>${escapeHtml(u.name || u.username)} <span style="color:var(--text-secondary); font-size:0.75rem;">(@${escapeHtml(u.username)} • ${escapeHtml(u.role)})</span></span>
                        </label>
                    `;
                }).join('');
            }
        }
    } catch (e) {
        console.error('Failed to populate assignees:', e);
    }
}

if (taskAssignTypeSelect) {
    taskAssignTypeSelect.addEventListener('change', () => {
        const val = taskAssignTypeSelect.value;
        if (val === 'single') {
            if (taskUserSelectWrap) taskUserSelectWrap.classList.remove('hidden');
            if (taskMultiUserWrap) taskMultiUserWrap.classList.add('hidden');
        } else if (val === 'multiple') {
            if (taskUserSelectWrap) taskUserSelectWrap.classList.add('hidden');
            if (taskMultiUserWrap) taskMultiUserWrap.classList.remove('hidden');
        } else {
            // everyone
            if (taskUserSelectWrap) taskUserSelectWrap.classList.add('hidden');
            if (taskMultiUserWrap) taskMultiUserWrap.classList.add('hidden');
        }
    });
}

function openCreateTaskModal() {
    if (createTaskModal) {
        createTaskModal.classList.remove('hidden');
        if (createTaskAlert) createTaskAlert.style.display = 'none';
        if (createTaskForm) createTaskForm.reset();

        const editingIdInput = document.getElementById('editingTaskId');
        if (editingIdInput) editingIdInput.value = '';

        const modalTitle = document.getElementById('createTaskModalTitle');
        if (modalTitle) modalTitle.textContent = 'Assign Work / Set Reminder';

        const submitBtn = document.getElementById('submitCreateTaskBtn');
        if (submitBtn) submitBtn.textContent = 'Create & Assign';

        populateTaskAssignees([]);
        if (taskAssignTypeSelect) taskAssignTypeSelect.value = 'single';
        if (taskUserSelectWrap) taskUserSelectWrap.classList.remove('hidden');
        if (taskMultiUserWrap) taskMultiUserWrap.classList.add('hidden');
        document.getElementById('taskTitleInput')?.focus();
    }
}

function closeCreateTaskModal() {
    if (createTaskModal) createTaskModal.classList.add('hidden');
}

if (openCreateTaskModalBtn) openCreateTaskModalBtn.addEventListener('click', openCreateTaskModal);
if (closeCreateTaskModalBtn) closeCreateTaskModalBtn.addEventListener('click', closeCreateTaskModal);
if (cancelCreateTaskBtn) cancelCreateTaskBtn.addEventListener('click', closeCreateTaskModal);

if (createTaskModal) {
    createTaskModal.addEventListener('click', (e) => {
        if (e.target === createTaskModal) closeCreateTaskModal();
    });
}

if (createTaskForm) {
    createTaskForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (createTaskAlert) createTaskAlert.style.display = 'none';

        const editingId = document.getElementById('editingTaskId')?.value;
        const title = document.getElementById('taskTitleInput')?.value.trim();
        const description = document.getElementById('taskDescInput')?.value.trim();
        const dueDate = document.getElementById('taskDueDateInput')?.value;
        const priority = document.getElementById('taskPrioritySelect')?.value || 'medium';
        const assignedType = taskAssignTypeSelect ? taskAssignTypeSelect.value : 'single';

        let targetUsernames = [];
        if (assignedType === 'single') {
            const singleUser = taskSingleUserSelect?.value;
            if (singleUser) targetUsernames.push(singleUser);
        } else if (assignedType === 'multiple') {
            const checkedBoxes = document.querySelectorAll('input[name="multiAssignUser"]:checked');
            checkedBoxes.forEach(cb => targetUsernames.push(cb.value));
            if (targetUsernames.length === 0) {
                if (createTaskAlert && createTaskAlertText) {
                    createTaskAlertText.textContent = 'Please select at least one assignee.';
                    createTaskAlert.style.display = 'block';
                }
                return;
            }
        }

        const submitBtn = document.getElementById('submitCreateTaskBtn');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = editingId ? 'Saving...' : 'Assigning...';
        }

        const method = editingId ? 'PUT' : 'POST';
        const endpoint = editingId ? `/api/tasks/${editingId}` : '/api/tasks';

        try {
            const res = await fetch(endpoint, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title,
                    description,
                    due_date: dueDate,
                    priority,
                    assigned_type: assignedType,
                    target_usernames: targetUsernames
                })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.detail || data.message || (editingId ? 'Failed to update task.' : 'Failed to create task.'));
            }

            closeCreateTaskModal();
            fetchMyTasks();
            fetchAllTasks();
            fetchNotifications();
            alert(editingId ? 'Task updated successfully.' : 'Task and reminder assigned successfully.');
        } catch (err) {
            if (createTaskAlert && createTaskAlertText) {
                createTaskAlertText.textContent = err.message;
                createTaskAlert.style.display = 'block';
            }
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = editingId ? 'Save Changes' : 'Create & Assign';
            }
        }
    });
}

// ==========================================================================
// Toast Notification Utility
// ==========================================================================
function showToast(message, type = 'info') {
    let toastContainer = document.getElementById('mmToastContainer');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'mmToastContainer';
        toastContainer.style.cssText = 'position:fixed; bottom:24px; right:24px; z-index:10000; display:flex; flex-direction:column; gap:10px; pointer-events:none;';
        document.body.appendChild(toastContainer);
    }
    const toast = document.createElement('div');
    const isSuccess = type === 'success';
    const isWarning = type === 'warning';
    const bg = isSuccess ? '#ECFDF5' : (isWarning ? '#FEF3C7' : '#EFF6FF');
    const border = isSuccess ? '#059669' : (isWarning ? '#D97706' : '#2563EB');
    const text = isSuccess ? '#065F46' : (isWarning ? '#92400E' : '#1E40AF');
    toast.style.cssText = `background:${bg}; border:1px solid ${border}; color:${text}; padding:10px 16px; border-radius:8px; font-size:0.875rem; font-weight:600; box-shadow:0 4px 14px rgba(0,0,0,0.08); pointer-events:auto; transition:all 0.3s ease; opacity:0; transform:translateY(12px);`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    });
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(12px)';
        setTimeout(() => toast.remove(), 300);
    }, 3200);
}

// ==========================================================================
// Task Due Reminder Popup & Snooze Manager
// ==========================================================================
let latestUserTasks = [];
let dueReminderQueue = [];
let activeReminderTask = null;
const sessionDismissedMap = {}; // { [taskId]: untilEpochMs }

// Synthesize pleasant two-tone alert chime using Web Audio API
function playReminderAlertSound() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        if (ctx.state === 'suspended') {
            ctx.resume();
        }
        const now = ctx.currentTime;

        // Tone 1: 587.33 Hz (D5)
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(587.33, now);
        gain1.gain.setValueAtTime(0.18, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.5);

        // Tone 2: 880.00 Hz (A5)
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(880, now + 0.15);
        gain2.gain.setValueAtTime(0.22, now + 0.15);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now + 0.15);
        osc2.stop(now + 0.9);
    } catch (e) {
        // Audio policy or unavailable
    }
}

// Request Desktop Notifications if supported
function requestNotificationPermissionOnce() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

function getTaskSnoozeStorageKey() {
    const user = currentUser ? (currentUser.username || 'default') : 'default';
    return `milky_mist_snooze_${user.toLowerCase()}`;
}

function getTaskSnoozeMap() {
    try {
        const raw = localStorage.getItem(getTaskSnoozeStorageKey());
        return raw ? JSON.parse(raw) : {};
    } catch (e) {
        return {};
    }
}

function setTaskSnooze(taskId, minutes) {
    try {
        const key = getTaskSnoozeStorageKey();
        const map = getTaskSnoozeMap();
        map[taskId] = Date.now() + (minutes * 60 * 1000);
        localStorage.setItem(key, JSON.stringify(map));
    } catch (e) {}
}

function clearTaskSnooze(taskId) {
    try {
        const key = getTaskSnoozeStorageKey();
        const map = getTaskSnoozeMap();
        delete map[taskId];
        localStorage.setItem(key, JSON.stringify(map));
    } catch (e) {}
}

function parseDueDate(dateStr) {
    if (!dateStr || !dateStr.trim()) return null;
    const cleanStr = dateStr.trim().replace(' ', 'T');
    const d = new Date(cleanStr);
    return isNaN(d.getTime()) ? null : d;
}

function formatDueRelative(dueDateObj) {
    const now = Date.now();
    const diffMs = now - dueDateObj.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const timeStr = dueDateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const isToday = new Date().toDateString() === dueDateObj.toDateString();
    const dayPrefix = isToday ? 'Today' : dueDateObj.toLocaleDateString([], { month: 'short', day: 'numeric' });

    if (diffMs > 0) {
        if (diffMins < 2) return `⏰ Due: Right now (${timeStr})`;
        if (diffMins < 60) return `Overdue by ${diffMins}m (Due: ${timeStr})`;
        const diffHours = Math.floor(diffMins / 60);
        return `Overdue by ${diffHours}h (${dayPrefix} at ${timeStr})`;
    } else {
        return `⏰ Due: ${dayPrefix} at ${timeStr}`;
    }
}

// Modal Elements
const taskReminderModal = document.getElementById('taskReminderModal');
const reminderTaskTitle = document.getElementById('reminderTaskTitle');
const reminderCloseXBtn = document.getElementById('reminderCloseXBtn');
const reminderTaskPriority = document.getElementById('reminderTaskPriority');
const reminderTaskDueTime = document.getElementById('reminderTaskDueTime');
const reminderTaskAssigner = document.getElementById('reminderTaskAssigner');
const reminderTaskDescription = document.getElementById('reminderTaskDescription');
const reminderSnoozeTime = document.getElementById('reminderSnoozeTime');
const reminderSnoozeBtn = document.getElementById('reminderSnoozeBtn');
const reminderDismissBtn = document.getElementById('reminderDismissBtn');
const reminderCompleteBtn = document.getElementById('reminderCompleteBtn');

function openTaskReminderPopup(task) {
    if (!taskReminderModal || !task) return;
    activeReminderTask = task;

    if (reminderTaskTitle) reminderTaskTitle.textContent = task.title || 'Assigned Task';
    
    const priority = (task.priority || 'medium').toLowerCase();
    if (reminderTaskPriority) {
        reminderTaskPriority.className = `badge-priority ${priority}`;
        reminderTaskPriority.textContent = `${priority} Priority`;
    }

    const dueDateObj = parseDueDate(task.due_date);
    const alertTag = taskReminderModal.querySelector('.reminder-alert-tag');
    const isOverdue = dueDateObj && (Date.now() > dueDateObj.getTime());
    if (alertTag) {
        if (isOverdue) {
            alertTag.innerHTML = '<span class="reminder-live-dot" style="background:#EF4444;"></span> OVERDUE TASK ALERT';
        } else {
            alertTag.innerHTML = '<span class="reminder-live-dot" style="background:#3B82F6;"></span> PENDING TASK ASSIGNMENT';
        }
    }

    if (reminderTaskDueTime) {
        if (dueDateObj) {
            reminderTaskDueTime.textContent = formatDueRelative(dueDateObj);
        } else {
            reminderTaskDueTime.textContent = '⏰ Due: Pending Completion';
        }
    }

    if (reminderTaskAssigner) {
        reminderTaskAssigner.textContent = `Assigned by: @${task.created_by || 'admin'}`;
    }

    if (reminderTaskDescription) {
        if (task.description && task.description.trim()) {
            reminderTaskDescription.textContent = task.description;
            reminderTaskDescription.classList.remove('empty');
        } else {
            reminderTaskDescription.textContent = 'No additional instructions provided for this task.';
            reminderTaskDescription.classList.add('empty');
        }
    }

    if (reminderSnoozeTime) {
        reminderSnoozeTime.value = '15'; // default 15 mins
    }

    // Play alert sound
    playReminderAlertSound();

    // Trigger desktop notification if allowed
    if ('Notification' in window && Notification.permission === 'granted') {
        try {
            new Notification(`⏰ Task Reminder: ${task.title}`, {
                body: `${task.description ? task.description + '\n' : ''}Assigned by @${task.created_by}`,
                icon: ''
            });
        } catch (e) {}
    }

    taskReminderModal.classList.remove('hidden');
}

function closeTaskReminderPopup() {
    if (taskReminderModal) {
        taskReminderModal.classList.add('hidden');
    }
    activeReminderTask = null;

    // Check if more tasks are queued
    if (dueReminderQueue.length > 0) {
        const next = dueReminderQueue.shift();
        setTimeout(() => {
            openTaskReminderPopup(next);
        }, 350);
    }
}

function evaluateDueReminders(notifs) {
    if (!notifs || !Array.isArray(notifs)) return;
    latestUserTasks = notifs;

    const now = Date.now();
    const snoozeMap = getTaskSnoozeMap();

    notifs.forEach(task => {
        // Only remind if task is NOT completed
        if (task.is_completed) {
            clearTaskSnooze(task.task_id);
            delete sessionDismissedMap[task.task_id];
            return;
        }

        // 1. If task is snoozed, it waits until the snooze timestamp
        const snoozedUntil = snoozeMap[task.task_id] || 0;
        if (now < snoozedUntil) return;

        // 2. If dismissed without snoozing, wait 60s before re-prompting
        const dismissedUntil = sessionDismissedMap[task.task_id] || 0;
        if (now < dismissedUntil) return;

        // 3. Is it already open?
        if (activeReminderTask && activeReminderTask.task_id === task.task_id) return;

        // 4. Is it already in queue?
        const alreadyInQueue = dueReminderQueue.some(q => q.task_id === task.task_id);
        if (alreadyInQueue) return;

        // If popup is currently open with another task, push to queue
        if (activeReminderTask) {
            dueReminderQueue.push(task);
        } else {
            openTaskReminderPopup(task);
        }
    });
}

// Wire modal buttons
if (reminderSnoozeBtn) {
    reminderSnoozeBtn.addEventListener('click', () => {
        if (!activeReminderTask) return;
        const minutes = parseInt(reminderSnoozeTime ? reminderSnoozeTime.value : '15', 10) || 15;
        const taskTitle = activeReminderTask.title;
        setTaskSnooze(activeReminderTask.task_id, minutes);
        delete sessionDismissedMap[activeReminderTask.task_id];
        closeTaskReminderPopup();
        showToast(`Reminder for "${taskTitle}" snoozed for ${minutes >= 60 ? (minutes / 60) + ' hour(s)' : minutes + ' mins'}.`, 'warning');
    });
}

if (reminderDismissBtn) {
    reminderDismissBtn.addEventListener('click', () => {
        if (!activeReminderTask) return;
        const taskTitle = activeReminderTask.title;
        // Without snoozing, re-pop in 60 seconds
        sessionDismissedMap[activeReminderTask.task_id] = Date.now() + (60 * 1000);
        closeTaskReminderPopup();
        showToast(`Dismissed temporarily. "${taskTitle}" will pop up again in 1 min until snoozed or completed.`, 'warning');
    });
}

if (reminderCloseXBtn) {
    reminderCloseXBtn.addEventListener('click', () => {
        if (!activeReminderTask) return;
        const taskTitle = activeReminderTask.title;
        sessionDismissedMap[activeReminderTask.task_id] = Date.now() + (60 * 1000);
        closeTaskReminderPopup();
        showToast(`"${taskTitle}" will pop up again in 1 min until snoozed or completed.`, 'warning');
    });
}

if (taskReminderModal) {
    taskReminderModal.addEventListener('click', (e) => {
        if (e.target === taskReminderModal && activeReminderTask) {
            sessionDismissedMap[activeReminderTask.task_id] = Date.now() + (60 * 1000);
            closeTaskReminderPopup();
        }
    });
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && taskReminderModal && !taskReminderModal.classList.contains('hidden') && activeReminderTask) {
        sessionDismissedMap[activeReminderTask.task_id] = Date.now() + (60 * 1000);
        closeTaskReminderPopup();
    }
});

if (reminderCompleteBtn) {
    reminderCompleteBtn.addEventListener('click', async () => {
        if (!activeReminderTask) return;
        const taskId = activeReminderTask.task_id;
        const taskTitle = activeReminderTask.title;
        try {
            reminderCompleteBtn.disabled = true;
            reminderCompleteBtn.innerHTML = '<span>Saving...</span>';

            const res = await fetch(`/api/tasks/${taskId}/toggle-complete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_completed: true })
            });

            if (res.ok) {
                clearTaskSnooze(taskId);
                delete sessionDismissedMap[taskId];
                closeTaskReminderPopup();
                showToast(`Marked "${taskTitle}" as complete!`, 'success');
                fetchNotifications();
                fetchMyTasks();
            } else {
                alert('Could not update task completion status.');
            }
        } catch (e) {
            alert('Failed to update task status.');
        } finally {
            reminderCompleteBtn.disabled = false;
            reminderCompleteBtn.innerHTML = `
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:0.4rem;">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                Mark as Complete
            `;
        }
    });
}

// Background ticker to check due tasks every 10 seconds without needing full network request
setInterval(() => {
    if (latestUserTasks && latestUserTasks.length > 0) {
        evaluateDueReminders(latestUserTasks);
    }
}, 10000);

// Periodic Refresh
setInterval(() => {
    fetchStats();
    fetchNotifications();
    const tasksView = document.getElementById('tasksView');
    if (tasksView && !tasksView.classList.contains('hidden')) {
        fetchMyTasks();
        if (currentUser && currentUser.can_create_users) {
            fetchAllTasks();
        }
    }
    if (!currentCandidate && recruitmentView && !recruitmentView.classList.contains('hidden')) {
        fetchCandidates();
    }
}, 30000);

// ==========================================================================
// Employee Directory Management
// ==========================================================================
let cachedEmployees = [];
let currentEmpViewMode = 'table';

const empStatTotal = document.getElementById('empStatTotal');
const empStatActive = document.getElementById('empStatActive');
const empStatDepts = document.getElementById('empStatDepts');
const empStatProbation = document.getElementById('empStatProbation');
const navEmployeesCount = document.getElementById('navEmployeesCount');

const empSearchInput = document.getElementById('empSearchInput');
const empDeptFilter = document.getElementById('empDeptFilter');
const empTypeFilter = document.getElementById('empTypeFilter');
const empStatusFilter = document.getElementById('empStatusFilter');
const empViewGridBtn = document.getElementById('empViewGridBtn');
const empViewTableBtn = document.getElementById('empViewTableBtn');
const empCardsGrid = document.getElementById('empCardsGrid');
const empTableView = document.getElementById('empTableView');
const empTableBody = document.getElementById('empTableBody');
const empTableScrollCtrls = document.getElementById('empTableScrollCtrls');
const empScrollLeftBtn = document.getElementById('empScrollLeftBtn');
const empScrollRightBtn = document.getElementById('empScrollRightBtn');

const employeeModal = document.getElementById('employeeModal');
const employeeModalTitle = document.getElementById('employeeModalTitle');
const closeEmployeeModalBtn = document.getElementById('closeEmployeeModalBtn');
const cancelEmployeeBtn = document.getElementById('cancelEmployeeBtn');
const openAddEmployeeModalBtn = document.getElementById('openAddEmployeeModalBtn');
const employeeForm = document.getElementById('employeeForm');
const employeeAlert = document.getElementById('employeeAlert');
const employeeAlertText = document.getElementById('employeeAlertText');
const submitEmployeeBtn = document.getElementById('submitEmployeeBtn');

const empEditId = document.getElementById('empEditId');
const empCandidateAppId = document.getElementById('empCandidateAppId');
const empNameInput = document.getElementById('empNameInput');
const empEmailInput = document.getElementById('empEmailInput');
const empPhoneInput = document.getElementById('empPhoneInput');
const empDeptSelect = document.getElementById('empDeptSelect');
const empDesignationInput = document.getElementById('empDesignationInput');
const empJoiningDateInput = document.getElementById('empJoiningDateInput');
const empTypeSelect = document.getElementById('empTypeSelect');
const empStatusSelect = document.getElementById('empStatusSelect');
const empLocationSelect = document.getElementById('empLocationSelect');

async function fetchEmployeeStats() {
    try {
        const res = await fetch('/api/employees/stats');
        const data = await res.json();
        if (data.success && data.data) {
            const s = data.data;
            if (empStatTotal) empStatTotal.textContent = s.total;
            if (empStatActive) empStatActive.textContent = s.active;
            if (empStatDepts) empStatDepts.textContent = s.departments;
            if (empStatProbation) empStatProbation.textContent = (s.probation || 0) + (s.on_leave || 0);

            if (navEmployeesCount) {
                navEmployeesCount.textContent = s.total;
                navEmployeesCount.style.display = s.total > 0 ? 'inline-block' : 'none';
            }
        }
    } catch (e) {
        console.error('Error fetching employee stats:', e);
    }
}

let empSearchTimeout = null;
if (empSearchInput) {
    empSearchInput.addEventListener('input', () => {
        clearTimeout(empSearchTimeout);
        empSearchTimeout = setTimeout(fetchEmployees, 250);
    });
}
if (empDeptFilter) empDeptFilter.addEventListener('change', fetchEmployees);
if (empTypeFilter) empTypeFilter.addEventListener('change', fetchEmployees);
if (empStatusFilter) empStatusFilter.addEventListener('change', fetchEmployees);

function setEmployeeViewMode(mode) {
    currentEmpViewMode = mode;
    if (mode === 'grid') {
        if (empCardsGrid) empCardsGrid.classList.remove('hidden');
        if (empTableView) empTableView.classList.add('hidden');
        if (empTableScrollCtrls) empTableScrollCtrls.classList.add('hidden');
        if (empViewGridBtn) empViewGridBtn.classList.add('active');
        if (empViewTableBtn) empViewTableBtn.classList.remove('active');
    } else {
        if (empCardsGrid) empCardsGrid.classList.add('hidden');
        if (empTableView) empTableView.classList.remove('hidden');
        if (empTableScrollCtrls) empTableScrollCtrls.classList.remove('hidden');
        if (empViewGridBtn) empViewGridBtn.classList.remove('active');
        if (empViewTableBtn) empViewTableBtn.classList.add('active');
    }
}

if (empViewGridBtn) empViewGridBtn.addEventListener('click', () => setEmployeeViewMode('grid'));
if (empViewTableBtn) empViewTableBtn.addEventListener('click', () => setEmployeeViewMode('table'));

if (empScrollLeftBtn && empTableView) {
    empScrollLeftBtn.addEventListener('click', () => {
        empTableView.scrollBy({ left: -320, behavior: 'smooth' });
    });
}
if (empScrollRightBtn && empTableView) {
    empScrollRightBtn.addEventListener('click', () => {
        empTableView.scrollBy({ left: 320, behavior: 'smooth' });
    });
}

// Mouse wheel horizontal translation on table container
if (empTableView) {
    empTableView.addEventListener('wheel', (e) => {
        if (Math.abs(e.deltaX) === 0 && Math.abs(e.deltaY) > 0 && !e.shiftKey) {
            const maxScroll = empTableView.scrollWidth - empTableView.clientWidth;
            if (maxScroll > 0) {
                const canScrollRight = e.deltaY > 0 && empTableView.scrollLeft < maxScroll;
                const canScrollLeft = e.deltaY < 0 && empTableView.scrollLeft > 0;
                if (canScrollRight || canScrollLeft) {
                    empTableView.scrollLeft += e.deltaY;
                    e.preventDefault();
                }
            }
        }
    }, { passive: false });
}

async function fetchEmployees() {
    if (!empCardsGrid && !empTableBody) return;

    const dept = empDeptFilter ? empDeptFilter.value : '';
    const status = empStatusFilter ? empStatusFilter.value : '';
    const empType = empTypeFilter ? empTypeFilter.value : '';
    const search = empSearchInput ? empSearchInput.value.trim() : '';

    const params = new URLSearchParams();
    if (dept) params.append('department', dept);
    if (status) params.append('status', status);
    if (empType) params.append('employment_type', empType);
    if (search) params.append('search', search);

    try {
        if (empCardsGrid) {
            empCardsGrid.innerHTML = '<div class="text-center" style="grid-column: 1/-1; padding:3rem; color:var(--text-secondary);">Loading workforce records...</div>';
        }
        if (empTableBody) {
            empTableBody.innerHTML = '<tr><td colspan="10" class="text-center">Loading workforce records...</td></tr>';
        }

        const res = await fetch(`/api/employees?${params.toString()}`);
        const data = await res.json();

        if (data.success && data.data) {
            cachedEmployees = data.data;
            applyEmployeeSorting();
            const countPill = document.getElementById('empShowingCountPill');
            if (countPill) countPill.textContent = `${cachedEmployees.length} staff`;
        } else {
            if (empCardsGrid) empCardsGrid.innerHTML = '<div class="text-center text-red" style="grid-column: 1/-1; padding:2rem;">Failed to load employees.</div>';
            if (empTableBody) empTableBody.innerHTML = '<tr><td colspan="10" class="text-center text-red">Failed to load employees.</td></tr>';
        }
    } catch (e) {
        console.error('Error fetching employees:', e);
        if (empCardsGrid) empCardsGrid.innerHTML = '<div class="text-center text-red" style="grid-column: 1/-1; padding:2rem;">Network error fetching employees.</div>';
        if (empTableBody) empTableBody.innerHTML = '<tr><td colspan="10" class="text-center text-red">Network error fetching employees.</td></tr>';
    }
}

function getEmployeeInitials(name) {
    if (!name) return 'MM';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getEmployeeStatusClass(status) {
    const s = (status || '').toLowerCase().replace(/\s+/g, '');
    if (s === 'active') return 'active';
    if (s === 'probation') return 'probation';
    if (s === 'onleave' || s === 'leave') return 'onleave';
    return 'active';
}

function getEmployeeTypeClass(type) {
    const t = (type || '').toLowerCase().trim();
    if (t === 'permanent') return 'permanent';
    if (t === 'temporary') return 'temporary';
    if (t === 'contract') return 'contract';
    if (t === 'probation') return 'probation';
    if (t === 'internship') return 'internship';
    return 'permanent';
}

function renderEmployees(employees) {
    if (!employees || employees.length === 0) {
        const emptyMsg = `
            <div style="grid-column: 1/-1; text-align:center; padding:3.5rem 1.5rem; background:#FFFFFF; border:1px dashed #CBD5E1; border-radius:12px;">
                <div style="font-size:1.1rem; font-weight:600; color:var(--text-muted); margin-bottom:0.75rem;">No Employees</div>
                <h3 style="font-size:1.1rem; color:var(--text-primary); font-weight:700; margin-bottom:0.35rem;">No Employees Found</h3>
                <p style="color:var(--text-secondary); font-size:0.85rem; max-width:400px; margin:0 auto 1.25rem auto;">
                    No workforce records matched your current department, status, work type, or search query.
                </p>
                <button type="button" class="btn btn-blue btn-sm" onclick="openEmployeeModal()">+ Add New Employee</button>
            </div>
        `;
        if (empCardsGrid) empCardsGrid.innerHTML = emptyMsg;
        if (empTableBody) empTableBody.innerHTML = '<tr><td colspan="10" class="text-center">No employee records found.</td></tr>';
        return;
    }

    // Render Cards Grid
    if (empCardsGrid) {
        empCardsGrid.innerHTML = employees.map(emp => {
            const initials = getEmployeeInitials(emp.name);
            const statusClass = getEmployeeStatusClass(emp.status);
            const statusLabel = escapeHtml(emp.status || 'Active');
            const typeClass = getEmployeeTypeClass(emp.employment_type);
            const typeLabel = escapeHtml(emp.employment_type || 'Permanent');

            return `
                <div class="emp-card" data-emp-id="${escapeHtml(emp.emp_id)}">
                    <div class="emp-card-header">
                        <div class="emp-avatar">${initials}</div>
                        <div class="emp-header-info">
                            <div class="emp-name-row">
                                <div class="emp-name" title="${escapeHtml(emp.name)}">${escapeHtml(emp.name)}</div>
                                <span class="emp-code-pill">${escapeHtml(emp.emp_id)}</span>
                            </div>
                            <div class="emp-designation">${escapeHtml(emp.designation || 'Staff')}</div>
                        </div>
                        <span class="emp-status-badge ${statusClass}">${statusLabel}</span>
                    </div>

                    <div class="emp-card-body">
                        <div class="emp-meta-item">
                            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M3 21h18"></path>
                                <path d="M5 21V7l8-4v18"></path>
                                <path d="M19 21V11l-6-4"></path>
                            </svg>
                            <span class="emp-dept-badge">${escapeHtml(emp.department || 'Dairy Processing')}</span>
                        </div>
                        <div class="emp-meta-item">
                            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                                <circle cx="12" cy="10" r="3"></circle>
                            </svg>
                            <span>${escapeHtml(emp.location || 'Perundurai Mega Plant (HQ)')}</span>
                        </div>
                        <div class="emp-meta-item">
                            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                                <polyline points="22,6 12,13 2,6"></polyline>
                            </svg>
                            <a href="mailto:${escapeHtml(emp.email)}">${escapeHtml(emp.email)}</a>
                        </div>
                        ${emp.phone ? `
                            <div class="emp-meta-item">
                                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                                </svg>
                                <a href="tel:${escapeHtml(emp.phone)}">${escapeHtml(emp.phone)}</a>
                            </div>
                        ` : ''}
                        <div class="emp-meta-item" style="color:var(--text-muted); font-size:0.75rem;">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                                <line x1="16" y1="2" x2="16" y2="6"></line>
                                <line x1="8" y1="2" x2="8" y2="6"></line>
                                <line x1="3" y1="10" x2="21" y2="10"></line>
                            </svg>
                            <span>Joined: ${escapeHtml(emp.joining_date || '—')}</span>
                            ${emp.candidate_app_id ? `• <span title="Onboarded from Candidate Pipeline" style="color:var(--blue); font-weight:600;">${escapeHtml(emp.candidate_app_id)}</span>` : ''}
                        </div>
                    </div>

                    <div class="emp-card-footer">
                        <span class="emp-type-badge ${typeClass}">${typeLabel}</span>
                        <div class="emp-actions-btns">
                            <button type="button" class="btn btn-secondary btn-sm" onclick="selectModule('leave', 'Leave & Time-Off'); openApplyLeaveModal('${escapeHtml(emp.emp_id)}')" title="Apply Leave">
                                Leave
                            </button>
                            <button type="button" class="btn btn-secondary btn-sm" onclick="openIdBadgeModal('${escapeHtml(emp.emp_id)}')">
                                ID Pass
                            </button>
                            <button type="button" class="btn btn-secondary btn-sm" onclick="openEmployeeModal('${escapeHtml(emp.emp_id)}')">
                                Edit
                            </button>
                            <button type="button" class="btn btn-red btn-sm" style="padding:0.35rem 0.6rem;" title="Delete Record" onclick="confirmDeleteEmployee('${escapeHtml(emp.emp_id)}', '${escapeHtml(emp.name)}')">
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="3 6 5 6 21 6"></polyline>
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // Render Table Body
    if (empTableBody) {
        empTableBody.innerHTML = employees.map(emp => {
            const statusClass = getEmployeeStatusClass(emp.status);
            const statusLabel = escapeHtml(emp.status || 'Active');
            const typeClass = getEmployeeTypeClass(emp.employment_type);
            const typeLabel = escapeHtml(emp.employment_type || 'Permanent');

            return `
                <tr>
                    <td><code>${escapeHtml(emp.emp_id)}</code></td>
                    <td><strong>${escapeHtml(emp.name)}</strong></td>
                    <td><span class="emp-dept-badge">${escapeHtml(emp.department || 'Dairy Processing')}</span></td>
                    <td>${escapeHtml(emp.designation || 'Staff')}</td>
                    <td><span class="emp-type-badge ${typeClass}">${typeLabel}</span></td>
                    <td>
                        <div style="display:inline-flex; align-items:center; gap:0.45rem; font-size:0.825rem; white-space:nowrap;">
                            <a href="mailto:${escapeHtml(emp.email)}" style="color:var(--blue); font-weight:500; text-decoration:none;">${escapeHtml(emp.email)}</a>
                            ${emp.phone ? `<span style="color:var(--text-muted); font-size:0.7rem;">•</span><a href="tel:${escapeHtml(emp.phone)}" style="color:var(--text-secondary); text-decoration:none;">${escapeHtml(emp.phone)}</a>` : ''}
                        </div>
                    </td>
                    <td>${escapeHtml(emp.location || 'Perundurai Mega Plant (HQ)')}</td>
                    <td>${escapeHtml(emp.joining_date || '—')}</td>
                    <td><span class="emp-status-badge ${statusClass}">${statusLabel}</span></td>
                    <td>
                        <div style="display:inline-flex; align-items:center; gap:0.4rem; white-space:nowrap;">
                            <button type="button" class="btn btn-secondary btn-sm" onclick="selectModule('leave', 'Leave & Time-Off'); openApplyLeaveModal('${escapeHtml(emp.emp_id)}')" title="Apply Leave">Leave</button>
                            <button type="button" class="btn btn-secondary btn-sm" onclick="openIdBadgeModal('${escapeHtml(emp.emp_id)}')">ID Pass</button>
                            <button type="button" class="btn btn-secondary btn-sm" onclick="openEmployeeModal('${escapeHtml(emp.emp_id)}')">Edit</button>
                            <button type="button" class="btn btn-red btn-sm" style="padding:0.35rem 0.6rem;" title="Delete Record" onclick="confirmDeleteEmployee('${escapeHtml(emp.emp_id)}', '${escapeHtml(emp.name)}')">
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="3 6 5 6 21 6"></polyline>
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                </svg>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }
}

// Modal Form Logic
function openEmployeeModal(empId = null) {
    if (!employeeModal) return;
    if (employeeAlert) employeeAlert.style.display = 'none';
    if (employeeForm) employeeForm.reset();

    if (empId) {
        const emp = cachedEmployees.find(e => e.emp_id === empId);
        if (emp) {
            if (employeeModalTitle) employeeModalTitle.textContent = `Edit Employee: ${emp.emp_id}`;
            if (empEditId) empEditId.value = emp.emp_id;
            if (empCandidateAppId) empCandidateAppId.value = emp.candidate_app_id || '';
            if (empNameInput) empNameInput.value = emp.name || '';
            if (empEmailInput) empEmailInput.value = emp.email || '';
            if (empPhoneInput) empPhoneInput.value = emp.phone || '';
            if (empDeptSelect) empDeptSelect.value = emp.department || 'Dairy Processing & Production';
            if (empDesignationInput) empDesignationInput.value = emp.designation || '';
            if (empJoiningDateInput) empJoiningDateInput.value = emp.joining_date || '';
            if (empTypeSelect) empTypeSelect.value = emp.employment_type || 'Permanent';
            if (empStatusSelect) empStatusSelect.value = emp.status || 'Active';
            if (empLocationSelect) empLocationSelect.value = emp.location || 'Perundurai Mega Plant (HQ)';
            if (submitEmployeeBtn) submitEmployeeBtn.textContent = 'Update Employee';
        }
    } else {
        if (employeeModalTitle) employeeModalTitle.textContent = 'Add New Employee';
        if (empEditId) empEditId.value = '';
        if (empCandidateAppId) empCandidateAppId.value = '';
        if (empJoiningDateInput) {
            const today = new Date().toISOString().split('T')[0];
            empJoiningDateInput.value = today;
        }
        if (empTypeSelect) empTypeSelect.value = 'Permanent';
        if (empLocationSelect) empLocationSelect.value = 'Perundurai Mega Plant (HQ)';
        if (submitEmployeeBtn) submitEmployeeBtn.textContent = 'Save Employee';
    }

    employeeModal.classList.remove('hidden');
}

function closeEmployeeModal() {
    if (employeeModal) employeeModal.classList.add('hidden');
}

if (openAddEmployeeModalBtn) openAddEmployeeModalBtn.addEventListener('click', () => openEmployeeModal());
if (closeEmployeeModalBtn) closeEmployeeModalBtn.addEventListener('click', closeEmployeeModal);
if (cancelEmployeeBtn) cancelEmployeeBtn.addEventListener('click', closeEmployeeModal);
if (employeeModal) {
    employeeModal.addEventListener('click', (e) => {
        if (e.target === employeeModal) closeEmployeeModal();
    });
}

// Onboard Candidate directly into Employee Directory
async function onboardCandidateAsEmployee(appId) {
    let candidate = currentCandidate;
    if (!candidate || candidate.app_id !== appId) {
        try {
            const res = await fetch(`/api/candidates/${appId}`);
            const data = await res.json();
            if (data.success && data.data) {
                candidate = data.data;
            }
        } catch (e) {}
    }

    if (!candidate) {
        alert('Could not find candidate details.');
        return;
    }

    // Immediately close Candidate Details modal overlay to prevent any overlap
    closeModal();

    if (!employeeModal) return;
    if (employeeAlert) employeeAlert.style.display = 'none';
    if (employeeForm) employeeForm.reset();

    if (employeeModalTitle) employeeModalTitle.textContent = `Onboard Candidate (${escapeHtml(candidate.app_id)})`;
    if (empEditId) empEditId.value = '';
    if (empCandidateAppId) empCandidateAppId.value = candidate.app_id;
    if (empNameInput) empNameInput.value = candidate.name || '';
    if (empEmailInput) empEmailInput.value = candidate.email || '';
    if (empPhoneInput) empPhoneInput.value = candidate.phone || '';
    if (empDeptSelect) empDeptSelect.value = 'Dairy Processing & Production';
    if (empDesignationInput) empDesignationInput.value = 'Executive Staff';
    if (empJoiningDateInput) {
        const today = new Date().toISOString().split('T')[0];
        empJoiningDateInput.value = today;
    }
    if (empTypeSelect) empTypeSelect.value = 'Permanent';
    if (empStatusSelect) empStatusSelect.value = 'Active';
    if (empLocationSelect) {
        const cLoc = (candidate.location || '').toLowerCase();
        empLocationSelect.value = (cLoc.includes('bengaluru') || cLoc.includes('bangalore')) 
            ? 'Bengaluru Regional Office' 
            : 'Perundurai Mega Plant (HQ)';
    }
    if (submitEmployeeBtn) submitEmployeeBtn.textContent = 'Complete Onboarding';

    employeeModal.classList.remove('hidden');
}

// Save or Update Employee Form Submission
if (employeeForm) {
    employeeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (employeeAlert) employeeAlert.style.display = 'none';

        const isEditing = empEditId && empEditId.value.trim() !== '';
        const targetId = isEditing ? empEditId.value.trim() : '';
        const candidateAppId = empCandidateAppId ? empCandidateAppId.value.trim() : '';

        const payload = {
            name: empNameInput ? empNameInput.value.trim() : '',
            email: empEmailInput ? empEmailInput.value.trim() : '',
            phone: empPhoneInput ? empPhoneInput.value.trim() : '',
            department: empDeptSelect ? empDeptSelect.value : 'Dairy Processing & Production',
            designation: empDesignationInput ? empDesignationInput.value.trim() : 'Staff',
            joining_date: empJoiningDateInput ? empJoiningDateInput.value : '',
            employment_type: empTypeSelect ? empTypeSelect.value : 'Permanent',
            status: empStatusSelect ? empStatusSelect.value : 'Active',
            location: empLocationSelect ? empLocationSelect.value : 'Perundurai Mega Plant (HQ)',
            candidate_app_id: candidateAppId,
        };

        if (submitEmployeeBtn) {
            submitEmployeeBtn.disabled = true;
            submitEmployeeBtn.textContent = 'Saving...';
        }

        try {
            let res;
            if (isEditing) {
                res = await fetch(`/api/employees/${targetId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
            } else if (candidateAppId) {
                // Direct candidate onboarding endpoint
                res = await fetch(`/api/candidates/${candidateAppId}/onboard`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
            } else {
                res = await fetch('/api/employees', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
            }

            const data = await res.json();
            if (data.success) {
                closeEmployeeModal();
                showToast(`${data.message || 'Employee record saved successfully!'}`, 'success');
                fetchEmployees();
                fetchEmployeeStats();

                // If onboarded from candidate modal, close the candidate modal as well
                if (candidateAppId && elements.modal && !elements.modal.classList.contains('hidden')) {
                    closeModal();
                    fetchCandidates();
                }
            } else {
                if (employeeAlert && employeeAlertText) {
                    employeeAlertText.textContent = data.detail || data.message || 'Failed to save employee.';
                    employeeAlert.style.display = 'block';
                }
            }
        } catch (err) {
            if (employeeAlert && employeeAlertText) {
                employeeAlertText.textContent = 'Network or server error occurred.';
                employeeAlert.style.display = 'block';
            }
        } finally {
            if (submitEmployeeBtn) {
                submitEmployeeBtn.disabled = false;
                submitEmployeeBtn.textContent = isEditing ? 'Update Employee' : (candidateAppId ? 'Complete Onboarding' : 'Save Employee');
            }
        }
    });
}

// Delete Employee
async function confirmDeleteEmployee(empId, empName) {
    if (!confirm(`Are you sure you want to remove ${empName} (${empId}) from the Milky Mist Employee Directory?`)) {
        return;
    }

    try {
        const res = await fetch(`/api/employees/${empId}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            showToast(`Removed ${empId} from Employee Directory.`, 'success');
            fetchEmployees();
            fetchEmployeeStats();
        } else {
            alert(data.detail || 'Could not delete employee record.');
        }
    } catch (e) {
        alert('Network error deleting employee.');
    }
}

// Initialize Application
checkAuth();
fetchStats();
fetchCandidates();
fetchEmployeeStats();
fetchLeaveStats();
fetchSettings();

// ==========================================================================
// HR Analytics Dashboard Logic
// ==========================================================================
const analyticsView = document.getElementById('analyticsView');

async function fetchAnalyticsOverview() {
    try {
        const res = await fetch('/api/analytics/overview');
        const data = await res.json();
        if (!data.success || !data.data) return;

        const { workforce, tasks, recruitment } = data.data;

        // 1. Top KPI Summary Cards
        const anTotalStaff = document.getElementById('anTotalStaff');
        const anStaffSub = document.getElementById('anStaffSub');
        const anHiringRate = document.getElementById('anHiringRate');
        const anHiringSub = document.getElementById('anHiringSub');
        const anTaskRate = document.getElementById('anTaskRate');
        const anTaskSub = document.getElementById('anTaskSub');
        const anHqRatio = document.getElementById('anHqRatio');
        const anHqSub = document.getElementById('anHqSub');

        if (anTotalStaff) anTotalStaff.textContent = workforce.total;
        if (anStaffSub) anStaffSub.textContent = `${workforce.active} Active • ${workforce.probation} Probation • ${workforce.on_leave} Leave`;

        if (anHiringRate) anHiringRate.textContent = `${recruitment.approval_rate}%`;
        if (anHiringSub) anHiringSub.textContent = `${recruitment.shortlisted} Approved / ${recruitment.total_applications} Applications`;

        if (anTaskRate) anTaskRate.textContent = `${tasks.completion_rate}%`;
        if (anTaskSub) anTaskSub.textContent = `${tasks.completed} Done / ${tasks.total_assignments} Assigned`;

        const hqCount = (workforce.locations && workforce.locations['Perundurai Mega Plant (HQ)']) || 0;
        const blrCount = (workforce.locations && workforce.locations['Bengaluru Regional Office']) || 0;
        const totalLoc = hqCount + blrCount;
        const hqPct = totalLoc > 0 ? Math.round((hqCount / totalLoc) * 100) : 0;
        const blrPct = totalLoc > 0 ? (100 - hqPct) : 0;

        if (anHqRatio) anHqRatio.textContent = `${hqPct}%`;
        if (anHqSub) anHqSub.textContent = `${hqCount} Staff at Perundurai HQ`;

        // 2. Location Distribution Split
        const anHqCountEl = document.getElementById('anHqCount');
        const anHqPctEl = document.getElementById('anHqPct');
        const anHqMeter = document.getElementById('anHqMeter');
        const anBlrCountEl = document.getElementById('anBlrCount');
        const anBlrPctEl = document.getElementById('anBlrPct');
        const anBlrMeter = document.getElementById('anBlrMeter');

        if (anHqCountEl) anHqCountEl.textContent = `${hqCount} staff`;
        if (anHqPctEl) anHqPctEl.textContent = `(${hqPct}%)`;
        if (anHqMeter) anHqMeter.style.width = `${hqPct}%`;

        if (anBlrCountEl) anBlrCountEl.textContent = `${blrCount} staff`;
        if (anBlrPctEl) anBlrPctEl.textContent = `(${blrPct}%)`;
        if (anBlrMeter) anBlrMeter.style.width = `${blrPct}%`;

        // 3. Department Breakdown
        const deptContainer = document.getElementById('anDeptBarsContainer');
        if (deptContainer) {
            const depts = workforce.departments || [];
            if (depts.length === 0) {
                deptContainer.innerHTML = '<div class="text-center" style="color:var(--text-secondary); padding:1.5rem;">No department data recorded.</div>';
            } else {
                const maxCount = Math.max(...depts.map(d => d.count), 1);
                deptContainer.innerHTML = depts.map(d => {
                    const pct = Math.round((d.count / maxCount) * 100);
                    return `
                        <div class="dept-bar-row">
                            <div class="dept-bar-header">
                                <span class="dept-bar-name">${escapeHtml(d.name)}</span>
                                <span class="dept-bar-count">${d.count} staff</span>
                            </div>
                            <div class="meter-bar-track">
                                <div class="meter-bar-fill hq" style="width: ${pct}%;"></div>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }

        // 4. Recruitment Funnel
        const funnelTotal = document.getElementById('funnelTotal');
        const funnelPending = document.getElementById('funnelPending');
        const funnelShortlisted = document.getElementById('funnelShortlisted');
        const funnelOnboarded = document.getElementById('funnelOnboarded');

        const funnelBarTotal = document.getElementById('funnelBarTotal');
        const funnelBarPending = document.getElementById('funnelBarPending');
        const funnelBarShortlisted = document.getElementById('funnelBarShortlisted');
        const funnelBarOnboarded = document.getElementById('funnelBarOnboarded');

        if (funnelTotal) funnelTotal.textContent = recruitment.total_applications;
        if (funnelPending) funnelPending.textContent = recruitment.pending;
        if (funnelShortlisted) funnelShortlisted.textContent = recruitment.shortlisted;
        if (funnelOnboarded) funnelOnboarded.textContent = recruitment.onboarded;

        const maxApps = Math.max(recruitment.total_applications, 1);
        if (funnelBarTotal) funnelBarTotal.style.width = '100%';
        if (funnelBarPending) funnelBarPending.style.width = `${Math.max(Math.round((recruitment.pending / maxApps) * 100), 4)}%`;
        if (funnelBarShortlisted) funnelBarShortlisted.style.width = `${Math.max(Math.round((recruitment.shortlisted / maxApps) * 100), 4)}%`;
        if (funnelBarOnboarded) funnelBarOnboarded.style.width = `${Math.max(Math.round((recruitment.onboarded / maxApps) * 100), 4)}%`;

        // 5. Operations & Task Priorities Matrix
        const anPrioUrgent = document.getElementById('anPrioUrgent');
        const anPrioHigh = document.getElementById('anPrioHigh');
        const anPrioMedium = document.getElementById('anPrioMedium');
        const anPrioLow = document.getElementById('anPrioLow');
        const anTaskRateLabel = document.getElementById('anTaskRateLabel');
        const anTaskFulfillmentMeter = document.getElementById('anTaskFulfillmentMeter');

        if (anPrioUrgent) anPrioUrgent.textContent = (tasks.priorities && tasks.priorities.urgent) || 0;
        if (anPrioHigh) anPrioHigh.textContent = (tasks.priorities && tasks.priorities.high) || 0;
        if (anPrioMedium) anPrioMedium.textContent = (tasks.priorities && tasks.priorities.medium) || 0;
        if (anPrioLow) anPrioLow.textContent = (tasks.priorities && tasks.priorities.low) || 0;

        if (anTaskRateLabel) anTaskRateLabel.textContent = `${tasks.completion_rate}% Fulfilled`;
        if (anTaskFulfillmentMeter) anTaskFulfillmentMeter.style.width = `${tasks.completion_rate}%`;

    } catch (e) {
        console.error('Error fetching analytics overview:', e);
    }
}

// ==========================================================================
// Interactive Enhancements & Enterprise Systems
// ==========================================================================

// 1. Sorting Logic for Tables
function applyCandidateSorting() {
    if (!currentCandSort.col) {
        renderTable(cachedCandidates);
        return;
    }
    const { col, dir } = currentCandSort;
    const sorted = [...cachedCandidates].sort((a, b) => {
        let va = a[col] ?? '';
        let vb = b[col] ?? '';
        if (col === 'age') {
            va = Number(va) || 0;
            vb = Number(vb) || 0;
            return dir === 'asc' ? va - vb : vb - va;
        }
        return dir === 'asc' 
            ? String(va).localeCompare(String(vb))
            : String(vb).localeCompare(String(va));
    });
    renderTable(sorted);
}

function applyEmployeeSorting() {
    if (!currentEmpSort.col) {
        renderEmployees(cachedEmployees);
        return;
    }
    const { col, dir } = currentEmpSort;
    const sorted = [...cachedEmployees].sort((a, b) => {
        let va = a[col] ?? '';
        let vb = b[col] ?? '';
        return dir === 'asc' 
            ? String(va).localeCompare(String(vb))
            : String(vb).localeCompare(String(va));
    });
    renderEmployees(sorted);
}

// Attach table header sort listeners
document.querySelectorAll('.sortable-th').forEach(th => {
    th.addEventListener('click', () => {
        const table = th.closest('table');
        const sortKey = th.dataset.sort;
        if (!sortKey) return;

        const isCandTable = table && table.id === 'candidatesTable';
        const sortState = isCandTable ? currentCandSort : currentEmpSort;

        if (sortState.col === sortKey) {
            sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
        } else {
            sortState.col = sortKey;
            sortState.dir = 'asc';
        }

        table.querySelectorAll('.sortable-th').forEach(h => {
            h.classList.remove('sorted-asc', 'sorted-desc');
        });
        th.classList.add(sortState.dir === 'asc' ? 'sorted-asc' : 'sorted-desc');

        if (isCandTable) {
            applyCandidateSorting();
            showToast(`Sorted candidates by ${sortKey.toUpperCase()} (${sortState.dir.toUpperCase()})`, 'info', 1800);
        } else {
            applyEmployeeSorting();
            showToast(`Sorted workforce by ${sortKey.toUpperCase()} (${sortState.dir.toUpperCase()})`, 'info', 1800);
        }
    });
});

// 2. Recruitment Table Scroll Controls
const candScrollLeftBtn = document.getElementById('candScrollLeftBtn');
const candScrollRightBtn = document.getElementById('candScrollRightBtn');
const candTableContainer = document.getElementById('candTableContainer');

if (candScrollLeftBtn && candTableContainer) {
    candScrollLeftBtn.addEventListener('click', () => {
        candTableContainer.scrollBy({ left: -320, behavior: 'smooth' });
    });
}
if (candScrollRightBtn && candTableContainer) {
    candScrollRightBtn.addEventListener('click', () => {
        candTableContainer.scrollBy({ left: 320, behavior: 'smooth' });
    });
}
if (candTableContainer) {
    candTableContainer.addEventListener('wheel', (e) => {
        if (Math.abs(e.deltaX) === 0 && Math.abs(e.deltaY) > 0 && !e.shiftKey) {
            const maxScroll = candTableContainer.scrollWidth - candTableContainer.clientWidth;
            if (maxScroll > 0) {
                const canScrollRight = e.deltaY > 0 && candTableContainer.scrollLeft < maxScroll;
                const canScrollLeft = e.deltaY < 0 && candTableContainer.scrollLeft > 0;
                if (canScrollRight || canScrollLeft) {
                    candTableContainer.scrollLeft += e.deltaY;
                    e.preventDefault();
                }
            }
        }
    }, { passive: false });
}

// 3. Department Quick Filter Chips
const empDeptPills = document.querySelectorAll('#empDeptPillsBar .dept-chip');
if (empDeptPills.length > 0 && empDeptFilter) {
    empDeptPills.forEach(pill => {
        pill.addEventListener('click', () => {
            empDeptPills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            const deptVal = pill.dataset.dept || '';
            empDeptFilter.value = deptVal;
            fetchEmployees();
        });
    });
}

// 4. Live Plant Shift Operations Clock
function updatePlantShiftStatus() {
    const clockEl = document.getElementById('plantShiftClock');
    const badgeEl = document.getElementById('plantShiftBadge');
    if (!clockEl && !badgeEl) return;

    // Use IST time (UTC + 5:30)
    const now = new Date();
    const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
    const istTime = new Date(utcMs + (5.5 * 3600000));
    
    const hours = istTime.getHours();
    const minutes = String(istTime.getMinutes()).padStart(2, '0');
    const seconds = String(istTime.getSeconds()).padStart(2, '0');
    const timeStr = `${String(hours).padStart(2, '0')}:${minutes}:${seconds} IST`;

    if (clockEl) clockEl.textContent = timeStr;

    let shiftName = 'Shift B (Operations)';
    if (hours >= 6 && hours < 14) {
        shiftName = 'Shift A (Production)';
    } else if (hours >= 14 && hours < 22) {
        shiftName = 'Shift B (Operations)';
    } else {
        shiftName = 'Shift C (Cold Chain)';
    }

    if (badgeEl) badgeEl.textContent = shiftName;
}
setInterval(updatePlantShiftStatus, 1000);
updatePlantShiftStatus();

// 5. Smart ID Badge Modal Logic
const idCardModal = document.getElementById('idCardModal');
const closeIdBadgeBtn = document.getElementById('closeIdBadgeBtn');
const printIdBadgeBtn = document.getElementById('printIdBadgeBtn');

function openIdBadgeModal(empId) {
    if (!idCardModal) return;
    const emp = cachedEmployees.find(e => e.emp_id === empId);
    if (!emp) {
        showToast('Employee record not found', 'error');
        return;
    }

    const idAvatar = document.getElementById('idCardAvatar');
    const idName = document.getElementById('idCardName');
    const idDesig = document.getElementById('idCardDesig');
    const idEmpId = document.getElementById('idCardEmpId');
    const idDept = document.getElementById('idCardDept');
    const idType = document.getElementById('idCardType');
    const idLoc = document.getElementById('idCardLoc');
    const idJoined = document.getElementById('idCardJoined');
    const idEmail = document.getElementById('idCardEmail');
    const idPhone = document.getElementById('idCardPhone');
    const idBarcode = document.getElementById('idCardBarcode');

    if (idAvatar) idAvatar.textContent = getEmployeeInitials(emp.name);
    if (idName) idName.textContent = emp.name;
    if (idDesig) idDesig.textContent = emp.designation || 'Staff';
    if (idEmpId) idEmpId.textContent = emp.emp_id;
    if (idDept) idDept.textContent = emp.department || 'Dairy Processing';
    if (idType) idType.textContent = (emp.employment_type || 'Permanent').toUpperCase();
    if (idLoc) idLoc.textContent = emp.location || 'Perundurai Mega Plant (HQ)';
    if (idJoined) idJoined.textContent = emp.joining_date || '—';
    if (idEmail) idEmail.textContent = emp.email || '—';
    if (idPhone) idPhone.textContent = emp.phone || '—';
    if (idBarcode) idBarcode.textContent = `*MM-${emp.emp_id}*`;

    idCardModal.classList.remove('hidden');
}

function closeIdBadgeModal() {
    if (idCardModal) idCardModal.classList.add('hidden');
}

if (closeIdBadgeBtn) closeIdBadgeBtn.addEventListener('click', closeIdBadgeModal);
if (idCardModal) {
    idCardModal.addEventListener('click', (e) => {
        if (e.target === idCardModal) closeIdBadgeModal();
    });
}
if (printIdBadgeBtn) {
    printIdBadgeBtn.addEventListener('click', () => {
        window.print();
    });
}

// 6. Command Palette Spotlight Controller
const cmdPaletteModal = document.getElementById('cmdPaletteModal');
const cmdPaletteInput = document.getElementById('cmdPaletteInput');
const cmdPaletteResults = document.getElementById('cmdPaletteResults');
const openCommandPaletteBtn = document.getElementById('openCommandPaletteBtn');

let cmdSelectedIndex = 0;
let cmdCurrentItems = [];

const staticCmds = [
    { type: 'action', icon: '', title: 'Add New Employee', desc: 'Create a new staff record', action: () => { selectModule('employees', 'Workforce'); openEmployeeModal(); } },
    { type: 'action', icon: '', title: 'Assign New Task', desc: 'Create an operations task assignment', action: () => { selectModule('tasks', 'Operations Tasks'); openNewTaskModal(); } },
    { type: 'action', icon: '', title: 'Schedule Candidate Interview', desc: 'Book interview round & assign interviewer', action: () => { selectModule('interviews', 'Interviews & Scorecards'); openScheduleInterviewModal(); } },
    { type: 'action', icon: '', title: 'Assign Shift Roster', desc: 'Set employee shift at Perundurai or Bengaluru', action: () => { selectModule('attendance', 'Shift & Attendance'); openAssignRosterModal(); } },
    { type: 'nav', icon: '', title: 'Go to Recruitment Candidates', desc: 'View incoming applicant pipeline', action: () => selectModule('recruitment', 'Recruitment') },
    { type: 'nav', icon: '', title: 'Go to Employee Management', desc: 'Browse Milky Mist workforce directory', action: () => selectModule('employees', 'Workforce') },
    { type: 'nav', icon: '', title: 'Go to Interview Scorecards', desc: 'Evaluate candidates with 5-star scorecard', action: () => selectModule('interviews', 'Interviews & Scorecards') },
    { type: 'nav', icon: '', title: 'Go to Shift & Attendance', desc: 'Daily roll call and shift roster', action: () => selectModule('attendance', 'Shift & Attendance') },
    { type: 'action', icon: '', title: 'Run Monthly Attendance Payroll', desc: 'Auto-calculate salary, attendance deductions, and shift allowances', action: () => { selectModule('payroll', 'Payroll & Benefits'); runAttendancePayroll(); } },
    { type: 'action', icon: '', title: 'Issue Candidate Offer Letter', desc: 'Create appointment letter with CTC breakdown for candidate', action: () => { openCreateOfferModalFromCandidate(); } },
    { type: 'action', icon: '', title: 'Apply for Employee Leave', desc: 'Submit formal time-off request with shift cover', action: () => { selectModule('leave', 'Leave & Time-Off'); openApplyLeaveModal(); } },
    { type: 'action', icon: '', title: 'Review Pending Leave Requests', desc: 'Approve or reject staff time-off applications', action: () => { selectModule('leave', 'Leave & Time-Off'); } },
    { type: 'nav', icon: '', title: 'Go to Leave & Time-Off', desc: 'Staff leave balances, quotas, and approval workflow', action: () => selectModule('leave', 'Leave & Time-Off') },
    { type: 'nav', icon: '', title: 'Go to Payroll & Benefits', desc: 'Monthly compensation ledger, LOP deductions, and salary slips', action: () => selectModule('payroll', 'Payroll & Benefits') },
    { type: 'nav', icon: '', title: 'Go to System Audit Trail', desc: 'View immutable system activity log', action: () => selectModule('audit', 'Audit Trail') },
    { type: 'nav', icon: '', title: 'Go to Enterprise Settings', desc: 'Configure shifts, recruitment rules, and policies', action: () => selectModule('settings', 'Portal Settings') },
    { type: 'nav', icon: '', title: 'Go to Analytics & Operations', desc: 'Workforce KPIs and shift breakdown', action: () => selectModule('analytics', 'Analytics') },
    { type: 'nav', icon: '', title: 'Go to User Accounts', desc: 'Admin role privileges and settings', action: () => selectModule('users', 'System Users') },
    { type: 'action', icon: '', title: 'Backup System Database (.db)', desc: 'Download instant SQLite snapshot', action: () => {
        window.open('/api/settings/backup', '_blank');
        showToast('Downloading database backup...', 'success');
    }},
    { type: 'action', icon: '', title: 'Export Employees (CSV)', desc: 'Download current workforce records to CSV', action: () => {
        window.open('/api/employees/export?format=csv', '_blank');
        showToast('Exporting employees to CSV...', 'success');
    }},
    { type: 'action', icon: '', title: 'Export Employees (Excel)', desc: 'Download workforce records to XLSX', action: () => {
        window.open('/api/employees/export?format=excel', '_blank');
        showToast('Exporting employees to Excel...', 'success');
    }},
    { type: 'action', icon: '', title: 'Export Audit Log (CSV)', desc: 'Download enterprise audit trail CSV', action: () => {
        window.open('/api/audit-logs/export', '_blank');
        showToast('Exporting audit logs to CSV...', 'success');
    }},
    { type: 'action', icon: '', title: 'Refresh All Data', desc: 'Reload candidate pipeline and stats', action: () => {
        fetchStats();
        fetchCandidates();
        fetchEmployees();
        if (typeof fetchInterviews === 'function') fetchInterviews();
        if (typeof fetchAttendance === 'function') fetchAttendance();
        if (typeof fetchAuditLogs === 'function') fetchAuditLogs();
        showToast('Data refreshed successfully', 'success');
    }}
];

function openCommandPalette() {
    if (!cmdPaletteModal) return;
    cmdPaletteModal.classList.remove('hidden');
    if (cmdPaletteInput) {
        cmdPaletteInput.value = '';
        cmdPaletteInput.focus();
    }
    renderCommandPaletteResults('');
}

function closeCommandPalette() {
    if (!cmdPaletteModal) return;
    cmdPaletteModal.classList.add('hidden');
}

function renderCommandPaletteResults(query) {
    if (!cmdPaletteResults) return;
    const q = (query || '').toLowerCase().trim();

    let items = [];
    if (!q) {
        items = staticCmds;
    } else {
        const filteredStatic = staticCmds.filter(c => 
            c.title.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q)
        );
        const matchedCandidates = (cachedCandidates || []).filter(c => 
            (c.name && c.name.toLowerCase().includes(q)) || 
            (c.app_id && c.app_id.toLowerCase().includes(q)) ||
            (c.email && c.email.toLowerCase().includes(q))
        ).slice(0, 4).map(c => ({
            type: 'candidate',
            icon: '',
            title: `${c.name} (${c.app_id})`,
            desc: `Applicant • ${c.location || 'Unknown'} • Status: ${c.status}`,
            action: () => {
                selectModule('recruitment', 'Recruitment');
                viewCandidate(c.app_id);
            }
        }));

        const matchedEmployees = (cachedEmployees || []).filter(e =>
            (e.name && e.name.toLowerCase().includes(q)) ||
            (e.emp_id && e.emp_id.toLowerCase().includes(q)) ||
            (e.email && e.email.toLowerCase().includes(q)) ||
            (e.designation && e.designation.toLowerCase().includes(q))
        ).slice(0, 4).map(e => ({
            type: 'employee',
            icon: '',
            title: `${e.name} (${e.emp_id})`,
            desc: `${e.designation || 'Staff'} • ${e.department || 'Dairy Processing'} • ${e.location}`,
            action: () => {
                selectModule('employees', 'Workforce');
                openIdBadgeModal(e.emp_id);
            }
        }));

        items = [...filteredStatic, ...matchedCandidates, ...matchedEmployees];
    }

    cmdCurrentItems = items;
    cmdSelectedIndex = 0;

    if (items.length === 0) {
        cmdPaletteResults.innerHTML = '<div style="padding:1.5rem; text-align:center; color:var(--text-secondary); font-size:0.875rem;">No matching commands, staff, or candidates found.</div>';
        return;
    }

    cmdPaletteResults.innerHTML = items.map((item, idx) => `
        <div class="cmd-item ${idx === 0 ? 'selected' : ''}" data-cmd-idx="${idx}">
            <div class="cmd-item-icon">${item.icon}</div>
            <div class="cmd-item-info">
                <div class="cmd-item-title">${escapeHtml(item.title)}</div>
                <div class="cmd-item-sub">${escapeHtml(item.desc)}</div>
            </div>
            <span class="cmd-item-tag">${item.type.toUpperCase()}</span>
        </div>
    `).join('');

    cmdPaletteResults.querySelectorAll('.cmd-item').forEach(el => {
        el.addEventListener('click', () => {
            const idx = Number(el.dataset.cmdIdx);
            executeCommandItem(idx);
        });
    });
}

function executeCommandItem(idx) {
    const item = cmdCurrentItems[idx];
    if (!item) return;
    closeCommandPalette();
    try {
        item.action();
    } catch (e) {
        console.error('Error executing command palette action:', e);
    }
}

function updateCommandSelection(newIdx) {
    if (cmdCurrentItems.length === 0) return;
    cmdSelectedIndex = Math.max(0, Math.min(newIdx, cmdCurrentItems.length - 1));
    const items = cmdPaletteResults.querySelectorAll('.cmd-item');
    items.forEach((el, idx) => {
        if (idx === cmdSelectedIndex) {
            el.classList.add('selected');
            el.scrollIntoView({ block: 'nearest' });
        } else {
            el.classList.remove('selected');
        }
    });
}

// Command palette key listeners
window.addEventListener('keydown', (e) => {
    const isCmdK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k';
    const isSlash = e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
    
    if (isCmdK || isSlash) {
        e.preventDefault();
        if (cmdPaletteModal && !cmdPaletteModal.classList.contains('hidden')) {
            closeCommandPalette();
        } else {
            openCommandPalette();
        }
        return;
    }

    if (cmdPaletteModal && !cmdPaletteModal.classList.contains('hidden')) {
        if (e.key === 'Escape') {
            closeCommandPalette();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            updateCommandSelection(cmdSelectedIndex + 1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            updateCommandSelection(cmdSelectedIndex - 1);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            executeCommandItem(cmdSelectedIndex);
        }
    }
});

if (cmdPaletteInput) {
    cmdPaletteInput.addEventListener('input', (e) => {
        renderCommandPaletteResults(e.target.value);
    });
}

if (openCommandPaletteBtn) {
    openCommandPaletteBtn.addEventListener('click', openCommandPalette);
}

if (cmdPaletteModal) {
    cmdPaletteModal.addEventListener('click', (e) => {
        if (e.target === cmdPaletteModal) closeCommandPalette();
    });
}

// ============================================================================
// 7. INTERVIEW SCHEDULING & CANDIDATE SCORECARDS MODULE
// ============================================================================
let cachedInterviews = [];
let currentScorecardRatings = {
    rating_technical: 4,
    rating_safety: 4,
    rating_experience: 4,
    rating_culture: 4
};

async function fetchInterviews() {
    const searchInput = document.getElementById('ivSearchInput');
    const statusFilter = document.getElementById('ivStatusFilter');
    const roundFilter = document.getElementById('ivRoundFilter');
    const tbody = document.getElementById('interviewsTableBody');

    const params = new URLSearchParams();
    if (searchInput && searchInput.value.trim()) params.append('search', searchInput.value.trim());
    if (statusFilter && statusFilter.value) params.append('status', statusFilter.value);
    if (roundFilter && roundFilter.value) params.append('round', roundFilter.value);

    try {
        const res = await fetch(`/api/interviews?${params.toString()}`);
        const data = await res.json();
        if (!data.success) {
            if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="text-center" style="color:var(--red);">Error loading interviews</td></tr>`;
            return;
        }

        cachedInterviews = data.data || [];

        // Compute Stats
        const scheduled = cachedInterviews.filter(i => i.status === 'Scheduled').length;
        const completed = cachedInterviews.filter(i => i.status === 'Completed').length;
        const hires = cachedInterviews.filter(i => i.recommendation === 'Hire' || i.recommendation === 'Strong Hire').length;

        const statSchedEl = document.getElementById('ivStatScheduled');
        const statCompEl = document.getElementById('ivStatCompleted');
        const statHireEl = document.getElementById('ivStatHires');
        const statPendEl = document.getElementById('ivStatPendingScorecards');
        const navIvCount = document.getElementById('navInterviewsCount');

        if (statSchedEl) statSchedEl.textContent = scheduled;
        if (statCompEl) statCompEl.textContent = completed;
        if (statHireEl) statHireEl.textContent = hires;
        if (statPendEl) statPendEl.textContent = scheduled;
        if (navIvCount) navIvCount.textContent = scheduled;

        renderInterviewsTable(cachedInterviews);
    } catch (e) {
        console.error('Failed to fetch interviews:', e);
        if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="text-center" style="color:var(--red);">Network error loading interviews</td></tr>`;
    }
}

function renderInterviewsTable(interviews) {
    const tbody = document.getElementById('interviewsTableBody');
    if (!tbody) return;

    if (!interviews || interviews.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="text-center" style="padding:2.5rem; color:var(--text-secondary);">No interviews scheduled matching criteria. Click "+ Schedule Interview" to book candidate rounds.</td></tr>`;
        return;
    }

    tbody.innerHTML = interviews.map(i => {
        let statusBadge = '<span class="badge badge-amber">Scheduled</span>';
        if (i.status === 'Completed') statusBadge = '<span class="badge badge-green">Completed</span>';
        else if (i.status === 'Cancelled') statusBadge = '<span class="badge badge-red">Cancelled</span>';

        let scoreHtml = '<span style="color:var(--text-muted); font-size:0.8rem;">Scorecard Pending</span>';
        if (i.status === 'Completed' && i.avg_score) {
            const stars = '★'.repeat(Math.round(i.avg_score)) + '☆'.repeat(Math.max(0, 5 - Math.round(i.avg_score)));
            scoreHtml = `<div class="scorecard-stars" style="display:inline-flex; align-items:center; gap:0.25rem;"><span style="color:#F59E0B; font-size:0.95rem;">${stars}</span> <strong>${Number(i.avg_score).toFixed(1)}</strong></div>`;
        }

        let recBadge = '<span style="color:var(--text-muted);">-</span>';
        if (i.recommendation) {
            let cls = 'rec-hire';
            if (i.recommendation === 'Strong Hire') cls = 'rec-strong-hire';
            else if (i.recommendation === 'Hold') cls = 'rec-hold';
            else if (i.recommendation === 'Reject') cls = 'rec-reject';
            recBadge = `<span class="recommendation-badge ${cls}">${escapeHtml(i.recommendation)}</span>`;
        }

        let actions = '';
        if (i.status === 'Scheduled') {
            actions = `
                <button type="button" class="btn btn-blue btn-sm" onclick="openScorecardModal(${i.id})" title="Open Evaluation Scorecard">📝 Scorecard</button>
                <button type="button" class="btn btn-secondary btn-sm" onclick="cancelInterviewSchedule(${i.id})" title="Cancel this interview" style="color:var(--red);">✕</button>
            `;
        } else if (i.status === 'Completed') {
            actions = `
                <button type="button" class="btn btn-secondary btn-sm" onclick="openScorecardModal(${i.id})" title="View Submitted Scorecard">View Review</button>
            `;
        } else {
            actions = `<span style="color:var(--text-muted); font-size:0.8rem;">Cancelled</span>`;
        }

        const dateStr = i.scheduled_at ? new Date(i.scheduled_at).toLocaleString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
        }) : '-';

        return `
            <tr>
                <td><code>#IV-${String(i.id).padStart(4, '0')}</code></td>
                <td>
                    <strong>${escapeHtml(i.candidate_name)}</strong>
                    <div style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(i.candidate_app_id)} • ${escapeHtml(i.candidate_phone || '')}</div>
                </td>
                <td><span class="badge badge-purple">${escapeHtml(i.interview_round)}</span></td>
                <td><strong>${escapeHtml(i.interviewer)}</strong></td>
                <td>${escapeHtml(dateStr)}</td>
                <td><span style="font-size:0.8rem;">${escapeHtml(i.location || 'Perundurai Mega Plant (HQ)')}</span></td>
                <td>${statusBadge}</td>
                <td>${scoreHtml}</td>
                <td>${recBadge}</td>
                <td style="text-align:right; white-space:nowrap;">${actions}</td>
            </tr>
        `;
    }).join('');
}

function openScheduleInterviewModal(preselectedAppId) {
    const modal = document.getElementById('scheduleInterviewModal');
    const select = document.getElementById('ivCandidateSelect');
    const dateInput = document.getElementById('ivScheduledAtInput');
    const notesInput = document.getElementById('ivNotesInput');

    if (notesInput) notesInput.value = '';

    // Set default datetime to tomorrow at 10:00 AM
    if (dateInput) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(10, 0, 0, 0);
        const yyyy = tomorrow.getFullYear();
        const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
        const dd = String(tomorrow.getDate()).padStart(2, '0');
        const hh = String(tomorrow.getHours()).padStart(2, '0');
        const min = String(tomorrow.getMinutes()).padStart(2, '0');
        dateInput.value = `${yyyy}-${mm}-${dd}T${hh}:${min}`;
    }

    // Populate candidate dropdown
    if (select) {
        select.innerHTML = '<option value="">Select Candidate...</option>';
        if (cachedCandidates && cachedCandidates.length > 0) {
            cachedCandidates.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.app_id;
                opt.textContent = `${c.name} (${c.app_id}) - ${c.location || 'HQ'}`;
                opt.dataset.name = c.name;
                opt.dataset.email = c.email || '';
                opt.dataset.phone = c.phone || '';
                if (preselectedAppId && c.app_id === preselectedAppId) {
                    opt.selected = true;
                }
                select.appendChild(opt);
            });
        }
    }

    if (modal) modal.classList.remove('hidden');
}

function closeScheduleInterviewModal() {
    const modal = document.getElementById('scheduleInterviewModal');
    if (modal) modal.classList.add('hidden');
}

async function handleScheduleInterviewSubmit(e) {
    e.preventDefault();
    const select = document.getElementById('ivCandidateSelect');
    const roundSelect = document.getElementById('ivRoundSelect');
    const interviewerSelect = document.getElementById('ivInterviewerSelect');
    const dateInput = document.getElementById('ivScheduledAtInput');
    const locationSelect = document.getElementById('ivLocationSelect');
    const notesInput = document.getElementById('ivNotesInput');

    if (!select || !select.value) {
        showToast('Please select a candidate', 'error');
        return;
    }

    const selectedOption = select.options[select.selectedIndex];
    const payload = {
        candidate_app_id: select.value,
        candidate_name: selectedOption.dataset.name || 'Candidate',
        candidate_email: selectedOption.dataset.email || '',
        candidate_phone: selectedOption.dataset.phone || '',
        interview_round: roundSelect ? roundSelect.value : 'Plant Technical Round',
        interviewer: interviewerSelect ? interviewerSelect.value : 'R. Senthil Kumar',
        scheduled_at: dateInput ? dateInput.value : '',
        location: locationSelect ? locationSelect.value : 'Perundurai Mega Plant (HQ)',
        notes: notesInput ? notesInput.value : ''
    };

    try {
        const res = await fetch('/api/interviews', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            showToast('Interview successfully scheduled!', 'success');
            closeScheduleInterviewModal();
            fetchInterviews();
        } else {
            showToast(data.message || 'Error scheduling interview', 'error');
        }
    } catch (err) {
        console.error('Error scheduling interview:', err);
        showToast('Network error scheduling interview', 'error');
    }
}

function updateStarUI() {
    const categories = [
        { id: 'starTechnical', key: 'rating_technical' },
        { id: 'starSafety', key: 'rating_safety' },
        { id: 'starExperience', key: 'rating_experience' },
        { id: 'starCulture', key: 'rating_culture' }
    ];

    categories.forEach(cat => {
        const container = document.getElementById(cat.id);
        if (!container) return;
        const currentVal = currentScorecardRatings[cat.key] || 1;
        const buttons = container.querySelectorAll('.star-btn');
        buttons.forEach(btn => {
            const val = Number(btn.dataset.val);
            if (val <= currentVal) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    });

    const sum = currentScorecardRatings.rating_technical +
                currentScorecardRatings.rating_safety +
                currentScorecardRatings.rating_experience +
                currentScorecardRatings.rating_culture;
    const avg = (sum / 4.0).toFixed(1);
    const avgDisplay = document.getElementById('scorecardAvgDisplay');
    if (avgDisplay) {
        avgDisplay.textContent = `${avg} / 5.0`;
    }
}

function initStarRatingEvents() {
    const containers = ['starTechnical', 'starSafety', 'starExperience', 'starCulture'];
    containers.forEach(id => {
        const container = document.getElementById(id);
        if (!container) return;
        const key = container.dataset.field;
        container.querySelectorAll('.star-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const val = Number(btn.dataset.val);
                currentScorecardRatings[key] = val;
                updateStarUI();
            });
        });
    });
}

async function openScorecardModal(interviewId) {
    const modal = document.getElementById('scorecardModal');
    const idInput = document.getElementById('scorecardInterviewId');
    const subtitle = document.getElementById('scorecardSubtitle');
    const notesInput = document.getElementById('scorecardNotesInput');
    const recSelect = document.getElementById('scorecardRecommendation');

    const iv = cachedInterviews.find(i => i.id === interviewId);
    if (!iv) {
        showToast('Interview record not found', 'error');
        return;
    }

    if (idInput) idInput.value = iv.id;
    if (subtitle) {
        subtitle.textContent = `${iv.candidate_name} (${iv.candidate_app_id}) • ${iv.interview_round} • Interviewer: ${iv.interviewer}`;
    }

    // Set ratings
    currentScorecardRatings = {
        rating_technical: iv.rating_technical || 4,
        rating_safety: iv.rating_safety || 4,
        rating_experience: iv.rating_experience || 4,
        rating_culture: iv.rating_culture || 4
    };
    updateStarUI();

    if (recSelect) recSelect.value = iv.recommendation || 'Hire';
    if (notesInput) notesInput.value = iv.scorecard_notes || '';

    if (modal) modal.classList.remove('hidden');
}

function closeScorecardModal() {
    const modal = document.getElementById('scorecardModal');
    if (modal) modal.classList.add('hidden');
}

async function submitScorecard() {
    const idInput = document.getElementById('scorecardInterviewId');
    const recSelect = document.getElementById('scorecardRecommendation');
    const notesInput = document.getElementById('scorecardNotesInput');

    if (!idInput || !idInput.value) return;
    const interviewId = idInput.value;

    const payload = {
        rating_technical: currentScorecardRatings.rating_technical,
        rating_safety: currentScorecardRatings.rating_safety,
        rating_experience: currentScorecardRatings.rating_experience,
        rating_culture: currentScorecardRatings.rating_culture,
        recommendation: recSelect ? recSelect.value : 'Hire',
        scorecard_notes: notesInput ? notesInput.value.trim() : ''
    };

    try {
        const res = await fetch(`/api/interviews/${interviewId}/scorecard`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            showToast('Scorecard submitted and recorded in audit log!', 'success');
            closeScorecardModal();
            fetchInterviews();
        } else {
            showToast(data.message || 'Error submitting scorecard', 'error');
        }
    } catch (e) {
        console.error('Error submitting scorecard:', e);
        showToast('Network error submitting scorecard', 'error');
    }
}

async function cancelInterviewSchedule(interviewId) {
    if (!confirm('Are you sure you want to cancel this scheduled interview?')) return;

    try {
        const res = await fetch(`/api/interviews/${interviewId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'Cancelled' })
        });
        const data = await res.json();
        if (data.success) {
            showToast('Interview cancelled', 'info');
            fetchInterviews();
        } else {
            showToast(data.message || 'Failed to cancel interview', 'error');
        }
    } catch (e) {
        console.error('Error cancelling interview:', e);
        showToast('Network error cancelling interview', 'error');
    }
}


// ============================================================================
// 8. EMPLOYEE SHIFT ROSTER & DAILY ATTENDANCE MODULE
// ============================================================================
let cachedAttendance = [];

function initAttendanceView() {
    const datePicker = document.getElementById('attDatePicker');
    if (datePicker && !datePicker.value) {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        datePicker.value = `${yyyy}-${mm}-${dd}`;
    }

    fetchAttendance();
    fetchAttendanceStats();
}

async function fetchAttendance() {
    const datePicker = document.getElementById('attDatePicker');
    const deptFilter = document.getElementById('attDeptFilter');
    const shiftFilter = document.getElementById('attShiftFilter');
    const tbody = document.getElementById('attendanceTableBody');

    const params = new URLSearchParams();
    if (datePicker && datePicker.value) params.append('date', datePicker.value);
    if (deptFilter && deptFilter.value) params.append('dept', deptFilter.value);
    if (shiftFilter && shiftFilter.value) params.append('shift', shiftFilter.value);

    try {
        const res = await fetch(`/api/attendance?${params.toString()}`);
        const data = await res.json();
        if (!data.success) {
            if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="text-center" style="color:var(--red);">Error loading attendance</td></tr>`;
            return;
        }

        cachedAttendance = data.data || [];
        renderAttendanceTable(cachedAttendance);
    } catch (e) {
        console.error('Error fetching attendance:', e);
        if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="text-center" style="color:var(--red);">Network error loading attendance</td></tr>`;
    }
}

async function fetchAttendanceStats() {
    const datePicker = document.getElementById('attDatePicker');
    const dateVal = datePicker ? datePicker.value : '';

    try {
        const res = await fetch(`/api/attendance/stats?date=${dateVal}`);
        const data = await res.json();
        if (data.success && data.data) {
            const s = data.data;
            const totalEl = document.getElementById('attStatTotal');
            const presEl = document.getElementById('attStatPresent');
            const lateEl = document.getElementById('attStatLate');
            const rateEl = document.getElementById('attStatRate');
            const navBadge = document.getElementById('navAttendanceBadge');

            const totalVal = s.total ?? s.total_rostered ?? 0;
            const presentVal = s.present ?? s.present_count ?? 0;
            const lateVal = s.late ?? s.late_count ?? 0;
            const rateVal = s.rate ?? s.fulfillment_rate ?? 0;

            if (totalEl) totalEl.textContent = totalVal;
            if (presEl) presEl.textContent = presentVal;
            if (lateEl) lateEl.textContent = lateVal;
            if (rateEl) rateEl.textContent = `${rateVal}%`;
            if (navBadge) navBadge.textContent = `${presentVal} on duty`;
        }
    } catch (e) {
        console.error('Error fetching attendance stats:', e);
    }
}

function getShiftTagClass(shiftName) {
    const s = (shiftName || '').toLowerCase();
    if (s.includes('shift a')) return 'shift-a';
    if (s.includes('shift b')) return 'shift-b';
    if (s.includes('shift c')) return 'shift-c';
    return 'shift-general';
}

function getAttBadgeClass(status) {
    const s = (status || '').toLowerCase();
    if (s === 'present') return 'att-present';
    if (s === 'late') return 'att-late';
    if (s === 'leave') return 'att-leave';
    if (s === 'absent') return 'att-absent';
    return 'att-pending';
}

function renderAttendanceTable(records) {
    const tbody = document.getElementById('attendanceTableBody');
    if (!tbody) return;

    if (!records || records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center" style="padding:2.5rem; color:var(--text-secondary);">No rostered staff records found for selected date & filters. Use "📅 Assign Roster" to allocate shifts.</td></tr>`;
        return;
    }

    tbody.innerHTML = records.map(r => {
        const shiftCls = getShiftTagClass(r.shift_name);
        const attCls = getAttBadgeClass(r.status);
        const curStatus = (r.status || 'Pending').toLowerCase();

        return `
            <tr>
                <td><code>${escapeHtml(r.emp_id)}</code></td>
                <td>
                    <strong>${escapeHtml(r.name)}</strong>
                    <div style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(r.designation || 'Staff')}</div>
                </td>
                <td><span style="font-size:0.8rem;">${escapeHtml(r.department)}</span></td>
                <td><span class="shift-tag ${shiftCls}">${escapeHtml(r.shift_name)}</span></td>
                <td><span style="font-size:0.8rem;">${escapeHtml(r.location)}</span></td>
                <td><span class="att-status-badge ${attCls}">${escapeHtml(r.status || 'Pending')}</span></td>
                <td>${escapeHtml(r.check_in_time || '-')}</td>
                <td><span style="font-size:0.8rem; color:var(--text-secondary);">${escapeHtml(r.notes || '-')}</span></td>
                <td style="text-align:right; white-space:nowrap;">
                    <div style="display:inline-flex; gap:0.25rem;">
                        <button type="button" class="btn-att-quick ${curStatus === 'present' ? 'active-present' : ''}" 
                                onclick="quickMarkAttendance('${escapeHtml(r.emp_id)}', 'Present')" title="Mark Present">P</button>
                        <button type="button" class="btn-att-quick ${curStatus === 'late' ? 'active-late' : ''}" 
                                onclick="quickMarkAttendance('${escapeHtml(r.emp_id)}', 'Late')" title="Mark Late">L</button>
                        <button type="button" class="btn-att-quick ${curStatus === 'leave' ? 'active-leave' : ''}" 
                                onclick="quickMarkAttendance('${escapeHtml(r.emp_id)}', 'Leave')" title="Mark on Leave">Lv</button>
                        <button type="button" class="btn-att-quick ${curStatus === 'absent' ? 'active-absent' : ''}" 
                                onclick="quickMarkAttendance('${escapeHtml(r.emp_id)}', 'Absent')" title="Mark Absent">A</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

async function quickMarkAttendance(empId, status) {
    const datePicker = document.getElementById('attDatePicker');
    const dateVal = datePicker ? datePicker.value : new Date().toISOString().split('T')[0];

    let checkInTime = null;
    if (status === 'Present' || status === 'Late') {
        const now = new Date();
        checkInTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    }

    try {
        const res = await fetch('/api/attendance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                emp_id: empId,
                date: dateVal,
                status: status,
                check_in_time: checkInTime,
                notes: `Quick roll call by ${currentUser ? currentUser.username : 'admin'}`
            })
        });
        const data = await res.json();
        if (data.success) {
            showToast(`Marked ${empId} as ${status}`, 'success');
            fetchAttendance();
            fetchAttendanceStats();
        } else {
            showToast(data.message || 'Error updating attendance', 'error');
        }
    } catch (e) {
        console.error('Error updating attendance:', e);
        showToast('Network error updating attendance', 'error');
    }
}

function openAssignRosterModal() {
    const modal = document.getElementById('assignRosterModal');
    const empSelect = document.getElementById('rosterEmpSelect');
    const dateInput = document.getElementById('rosterDateInput');

    if (dateInput) {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        dateInput.value = `${yyyy}-${mm}-${dd}`;
    }

    if (empSelect) {
        empSelect.innerHTML = '<option value="">Select Employee...</option>';
        if (cachedEmployees && cachedEmployees.length > 0) {
            cachedEmployees.forEach(e => {
                const opt = document.createElement('option');
                opt.value = e.emp_id;
                opt.textContent = `${e.name} (${e.emp_id}) - ${e.department} - ${e.location}`;
                empSelect.appendChild(opt);
            });
        }
    }

    if (modal) modal.classList.remove('hidden');
}

function closeAssignRosterModal() {
    const modal = document.getElementById('assignRosterModal');
    if (modal) modal.classList.add('hidden');
}

async function handleAssignRosterSubmit(e) {
    e.preventDefault();
    const empSelect = document.getElementById('rosterEmpSelect');
    const dateInput = document.getElementById('rosterDateInput');
    const shiftSelect = document.getElementById('rosterShiftSelect');

    if (!empSelect || !empSelect.value) {
        showToast('Please select an employee', 'error');
        return;
    }

    const payload = {
        emp_id: empSelect.value,
        roster_date: dateInput ? dateInput.value : '',
        shift_name: shiftSelect ? shiftSelect.value : 'Shift A (06:00-14:00)'
    };

    try {
        const res = await fetch('/api/roster', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            showToast('Shift assigned and logged successfully!', 'success');
            closeAssignRosterModal();
            fetchAttendance();
            fetchAttendanceStats();
        } else {
            showToast(data.message || 'Error assigning roster', 'error');
        }
    } catch (err) {
        console.error('Error assigning roster:', err);
        showToast('Network error assigning roster', 'error');
    }
}


// ============================================================================
// 9. SYSTEM AUDIT TRAIL MODULE
// ============================================================================
let cachedAuditLogs = [];

async function fetchAuditLogs() {
    const searchInput = document.getElementById('auditSearchInput');
    const actionFilter = document.getElementById('auditActionFilter');
    const tbody = document.getElementById('auditTableBody');

    const params = new URLSearchParams();
    if (searchInput && searchInput.value.trim()) params.append('search', searchInput.value.trim());
    if (actionFilter && actionFilter.value) params.append('action', actionFilter.value);

    try {
        const res = await fetch(`/api/audit-logs?${params.toString()}`);
        const data = await res.json();
        if (!data.success) {
            if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="text-center" style="color:var(--red);">Error loading audit logs</td></tr>`;
            return;
        }

        cachedAuditLogs = data.data || [];

        // Compute metrics
        const total = cachedAuditLogs.length;
        const candidates = cachedAuditLogs.filter(l => l.action.startsWith('STATUS_') || l.action.includes('CANDIDATE')).length;
        const staff = cachedAuditLogs.filter(l => l.action.includes('EMPLOYEE')).length;
        const ops = cachedAuditLogs.filter(l => 
            l.action.includes('TASK') || l.action.includes('INTERVIEW') || 
            l.action.includes('SCORECARD') || l.action.includes('ATTENDANCE') || 
            l.action.includes('ROSTER')
        ).length;

        const statTot = document.getElementById('auditStatTotal');
        const statCand = document.getElementById('auditStatCandidates');
        const statStf = document.getElementById('auditStatStaff');
        const statOps = document.getElementById('auditStatOperations');
        const navAudit = document.getElementById('navAuditBadge');

        if (statTot) statTot.textContent = total;
        if (statCand) statCand.textContent = candidates;
        if (statStf) statStf.textContent = staff;
        if (statOps) statOps.textContent = ops;
        if (navAudit) navAudit.textContent = `${total} events`;

        renderAuditTable(cachedAuditLogs);
    } catch (e) {
        console.error('Error loading audit logs:', e);
        if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="text-center" style="color:var(--red);">Network error loading audit trail</td></tr>`;
    }
}

function getAuditBadgeClass(action) {
    const a = (action || '').toUpperCase();
    if (a.includes('SHORTLIST') || a.includes('CREATE') || a.includes('ONBOARD')) return 'audit-create';
    if (a.includes('REJECT') || a.includes('DELETE') || a.includes('CANCEL')) return 'audit-delete';
    if (a.includes('TASK')) return 'audit-task';
    if (a.includes('INTERVIEW') || a.includes('SCORECARD')) return 'audit-interview';
    if (a.includes('ATTENDANCE') || a.includes('ROSTER')) return 'audit-attendance';
    return 'audit-default';
}

function renderAuditTable(logs) {
    const tbody = document.getElementById('auditTableBody');
    if (!tbody) return;

    if (!logs || logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center" style="padding:2.5rem; color:var(--text-secondary);">No audit events matching current search & filter criteria.</td></tr>`;
        return;
    }

    tbody.innerHTML = logs.map(l => {
        const badgeCls = getAuditBadgeClass(l.action);
        const dateStr = l.timestamp ? new Date(l.timestamp).toLocaleString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
        }) : '-';

        return `
            <tr>
                <td><code>#AUD-${String(l.id).padStart(4, '0')}</code></td>
                <td style="white-space:nowrap; font-size:0.8rem; color:var(--text-secondary);">${escapeHtml(dateStr)}</td>
                <td>
                    <strong>${escapeHtml(l.actor_user || 'system')}</strong>
                    <span class="badge badge-gray" style="font-size:0.65rem; margin-left:0.25rem;">${escapeHtml(l.actor_role || 'admin')}</span>
                </td>
                <td><span class="audit-action-badge ${badgeCls}">${escapeHtml(l.action)}</span></td>
                <td><span style="font-weight:600; font-size:0.825rem;">${escapeHtml(l.target_entity)}</span></td>
                <td><code>${escapeHtml(l.target_id || '-')}</code></td>
                <td style="max-width:320px; font-size:0.8rem; color:var(--text-primary);">${escapeHtml(l.details || '-')}</td>
                <td><code style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(l.ip_address || '127.0.0.1')}</code></td>
            </tr>
        `;
    }).join('');
}


// ============================================================================
// 10. GLOBAL EVENT WIREUP FOR NEW MODULES
// ============================================================================
// Interview Schedule Listeners
const openScheduleInterviewBtn = document.getElementById('openScheduleInterviewBtn');
const closeScheduleInterviewBtn = document.getElementById('closeScheduleInterviewBtn');
const cancelScheduleInterviewBtn = document.getElementById('cancelScheduleInterviewBtn');
const scheduleInterviewForm = document.getElementById('scheduleInterviewForm');
const ivSearchInput = document.getElementById('ivSearchInput');
const ivStatusFilter = document.getElementById('ivStatusFilter');
const ivRoundFilter = document.getElementById('ivRoundFilter');

if (openScheduleInterviewBtn) openScheduleInterviewBtn.addEventListener('click', () => openScheduleInterviewModal());
if (closeScheduleInterviewBtn) closeScheduleInterviewBtn.addEventListener('click', closeScheduleInterviewModal);
if (cancelScheduleInterviewBtn) cancelScheduleInterviewBtn.addEventListener('click', closeScheduleInterviewModal);
if (scheduleInterviewForm) scheduleInterviewForm.addEventListener('submit', handleScheduleInterviewSubmit);

if (ivSearchInput) {
    let ivDebounceTimer;
    ivSearchInput.addEventListener('input', () => {
        clearTimeout(ivDebounceTimer);
        ivDebounceTimer = setTimeout(fetchInterviews, 300);
    });
}
if (ivStatusFilter) ivStatusFilter.addEventListener('change', fetchInterviews);
if (ivRoundFilter) ivRoundFilter.addEventListener('change', fetchInterviews);

// Scorecard Modal Listeners
const closeScorecardBtn = document.getElementById('closeScorecardBtn');
const cancelScorecardBtn = document.getElementById('cancelScorecardBtn');
const submitScorecardBtn = document.getElementById('submitScorecardBtn');

if (closeScorecardBtn) closeScorecardBtn.addEventListener('click', closeScorecardModal);
if (cancelScorecardBtn) cancelScorecardBtn.addEventListener('click', closeScorecardModal);
if (submitScorecardBtn) submitScorecardBtn.addEventListener('click', submitScorecard);
initStarRatingEvents();

// Attendance Listeners
const attDatePicker = document.getElementById('attDatePicker');
const attDeptFilter = document.getElementById('attDeptFilter');
const attShiftFilter = document.getElementById('attShiftFilter');
const openRosterModalBtn = document.getElementById('openRosterModalBtn');
const closeAssignRosterBtn = document.getElementById('closeAssignRosterBtn');
const cancelAssignRosterBtn = document.getElementById('cancelAssignRosterBtn');
const assignRosterForm = document.getElementById('assignRosterForm');

if (attDatePicker) attDatePicker.addEventListener('change', () => {
    fetchAttendance();
    fetchAttendanceStats();
});
if (attDeptFilter) attDeptFilter.addEventListener('change', fetchAttendance);
if (attShiftFilter) attShiftFilter.addEventListener('change', fetchAttendance);
if (openRosterModalBtn) openRosterModalBtn.addEventListener('click', openAssignRosterModal);
if (closeAssignRosterBtn) closeAssignRosterBtn.addEventListener('click', closeAssignRosterModal);
if (cancelAssignRosterBtn) cancelAssignRosterBtn.addEventListener('click', closeAssignRosterModal);
if (assignRosterForm) assignRosterForm.addEventListener('submit', handleAssignRosterSubmit);

// Audit Log Listeners
const auditSearchInput = document.getElementById('auditSearchInput');
const auditActionFilter = document.getElementById('auditActionFilter');
const refreshAuditBtn = document.getElementById('refreshAuditBtn');

if (auditSearchInput) {
    let auditDebounceTimer;
    auditSearchInput.addEventListener('input', () => {
        clearTimeout(auditDebounceTimer);
        auditDebounceTimer = setTimeout(fetchAuditLogs, 300);
    });
}
if (auditActionFilter) auditActionFilter.addEventListener('change', fetchAuditLogs);
if (refreshAuditBtn) refreshAuditBtn.addEventListener('click', () => {
    fetchAuditLogs();
    showToast('Audit trail refreshed', 'success');
});

// ============================================================================
// 11. ENTERPRISE SYSTEM SETTINGS & CONTROL CENTER MODULE
// ============================================================================
let cachedSettings = {};

async function fetchSettings() {
    try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        if (!data.success) {
            showToast('Failed to load system settings', 'error');
            return;
        }

        cachedSettings = data.values || {};

        // 1. Update Telemetry Strip
        if (data.telemetry) {
            const t = data.telemetry;
            const telDbSize = document.getElementById('telDbSize');
            const telTotalSettings = document.getElementById('telTotalSettings');
            const telServerOs = document.getElementById('telServerOs');
            const telActiveUser = document.getElementById('telActiveUser');

            if (telDbSize) telDbSize.textContent = `${t.db_size_kb} KB`;
            if (telTotalSettings) telTotalSettings.textContent = `${t.total_settings} Active`;
            if (telServerOs) telServerOs.textContent = t.server_os || 'Windows 64-bit';
            if (telActiveUser) telActiveUser.textContent = `${t.active_user} (${t.user_role})`;
        }

        // 2. Populate form fields
        populateSettingsFields(cachedSettings);
    } catch (e) {
        console.error('Error fetching system settings:', e);
        showToast('Network error loading settings', 'error');
    }
}

function populateSettingsFields(vals) {
    if (!vals) return;

    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val !== undefined && val !== null ? val : '';
    };

    const setChecked = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.checked = Boolean(val);
    };

    // 1. Site Identity & Branding
    setVal('set_site_title', vals.site_title || 'Milky Mist HR Portal');
    setVal('set_site_subtitle', vals.site_subtitle || 'Candidate Intelligence, Workforce & Plant HR Control');
    setVal('set_site_env_tag', vals.site_env_tag || 'INTERNAL');
    setVal('set_portal_admin_email', vals.portal_admin_email || 'admin@milkymist.local');
    setChecked('set_maintenance_mode', vals.maintenance_mode);
    setVal('set_maintenance_message', vals.maintenance_message || 'Scheduled routine system maintenance in progress. Data is fully preserved.');

    // 2. Appearance, Themes & Layout
    setVal('set_site_theme_accent', vals.site_theme_accent || 'blue');
    setVal('set_sidebar_default_mode', vals.sidebar_default_mode || 'collapsed');
    setChecked('set_show_collapsed_badges', vals.show_collapsed_badges !== false);
    setChecked('set_dense_table_mode_default', vals.dense_table_mode_default !== false);
    setVal('set_ui_zoom_scale', vals.ui_zoom_scale || '100%');

    // 3. Candidate Intake Portal (:8000)
    setChecked('set_public_portal_active', vals.public_portal_active !== false);
    setVal('set_portal_announcement', vals.portal_announcement || '');
    setVal('set_max_resume_mb', vals.max_resume_mb || 10);
    setVal('set_allowed_file_types', vals.allowed_file_types || 'PDF, DOCX');
    setChecked('set_auto_parse_resume', vals.auto_parse_resume !== false);
    setVal('set_candidate_success_msg', vals.candidate_success_msg || '');

    // 4. Security & Access Policy
    setVal('set_session_timeout_hours', vals.session_timeout_hours || 8);
    setChecked('set_allow_staff_create_users', vals.allow_staff_create_users);
    setVal('set_min_password_length', vals.min_password_length || 6);
    setChecked('set_enforce_audit_logging', vals.enforce_audit_logging !== false);
    setVal('set_audit_retention_days', vals.audit_retention_days || 365);
    setChecked('set_remember_me_enabled', vals.remember_me_enabled !== false);

    // 5. Notifications & Audio
    setVal('set_task_reminder_interval_mins', vals.task_reminder_interval_mins || 60);
    setChecked('set_task_popup_on_login', vals.task_popup_on_login !== false);
    setChecked('set_desktop_notifications_enabled', vals.desktop_notifications_enabled !== false);
    setChecked('set_sound_effects_enabled', vals.sound_effects_enabled !== false);
    setVal('set_notification_poll_interval_sec', vals.notification_poll_interval_sec || 15);

    // Apply live customizations
    applyLiveSiteSettings(vals);
}

function applyLiveSiteSettings(vals) {
    if (!vals) return;

    // 1. Accent Theme Palette
    const themeMap = {
        blue: { primary: '#2563EB', hover: '#1D4ED8', subtle: '#EFF6FF' },
        navy: { primary: '#1E3A8A', hover: '#172554', subtle: '#F0F4FA' },
        emerald: { primary: '#059669', hover: '#047857', subtle: '#ECFDF5' },
        purple: { primary: '#7C3AED', hover: '#6D28D9', subtle: '#F5F3FF' },
        slate: { primary: '#334155', hover: '#1E293B', subtle: '#F1F5F9' }
    };
    const t = themeMap[vals.site_theme_accent] || themeMap.blue;
    document.documentElement.style.setProperty('--blue', t.primary);
    document.documentElement.style.setProperty('--blue-hover', t.hover);
    document.documentElement.style.setProperty('--blue-subtle', t.subtle);

    // 2. Title & Environment Tag
    if (vals.site_title) {
        document.title = vals.site_title;
    }
    const envTag = document.querySelector('.portal-env-tag');
    if (envTag && vals.site_env_tag) {
        envTag.textContent = vals.site_env_tag;
    }

    // 3. Maintenance Banner
    const maintBanner = document.getElementById('siteMaintenanceBanner');
    const maintText = document.getElementById('siteMaintenanceBannerText');
    if (maintBanner) {
        const isMaint = Boolean(vals.maintenance_mode);
        if (isMaint) {
            maintBanner.classList.remove('hidden');
            if (maintText) maintText.textContent = vals.maintenance_message || 'Scheduled routine system maintenance in progress.';
        } else {
            maintBanner.classList.add('hidden');
        }
    }

    // 4. UI Zoom / Density
    if (vals.ui_zoom_scale) {
        if (vals.ui_zoom_scale === '90%') document.body.style.zoom = '0.92';
        else if (vals.ui_zoom_scale === '108%') document.body.style.zoom = '1.08';
        else document.body.style.zoom = '1';
    }
}

function collectSettingsFromUI() {
    const getVal = (id) => {
        const el = document.getElementById(id);
        return el ? el.value.trim() : '';
    };

    const getChecked = (id) => {
        const el = document.getElementById(id);
        return el ? el.checked : false;
    };

    return {
        // 1. Site Identity & Branding
        site_title: getVal('set_site_title'),
        site_subtitle: getVal('set_site_subtitle'),
        site_env_tag: getVal('set_site_env_tag'),
        portal_admin_email: getVal('set_portal_admin_email'),
        maintenance_mode: getChecked('set_maintenance_mode'),
        maintenance_message: getVal('set_maintenance_message'),

        // 2. Appearance, Themes & Layout
        site_theme_accent: getVal('set_site_theme_accent'),
        sidebar_default_mode: getVal('set_sidebar_default_mode'),
        show_collapsed_badges: getChecked('set_show_collapsed_badges'),
        dense_table_mode_default: getChecked('set_dense_table_mode_default'),
        ui_zoom_scale: getVal('set_ui_zoom_scale'),

        // 3. Candidate Intake Portal (:8000)
        public_portal_active: getChecked('set_public_portal_active'),
        portal_announcement: getVal('set_portal_announcement'),
        max_resume_mb: Number(getVal('set_max_resume_mb')) || 10,
        allowed_file_types: getVal('set_allowed_file_types'),
        auto_parse_resume: getChecked('set_auto_parse_resume'),
        candidate_success_msg: getVal('set_candidate_success_msg'),

        // 4. Security & Access Policy
        session_timeout_hours: Number(getVal('set_session_timeout_hours')) || 8,
        allow_staff_create_users: getChecked('set_allow_staff_create_users'),
        min_password_length: Number(getVal('set_min_password_length')) || 6,
        enforce_audit_logging: true,
        audit_retention_days: Number(getVal('set_audit_retention_days')) || 365,
        remember_me_enabled: getChecked('set_remember_me_enabled'),

        // 5. Notifications & Audio
        task_reminder_interval_mins: Number(getVal('set_task_reminder_interval_mins')) || 60,
        task_popup_on_login: getChecked('set_task_popup_on_login'),
        desktop_notifications_enabled: getChecked('set_desktop_notifications_enabled'),
        sound_effects_enabled: getChecked('set_sound_effects_enabled'),
        notification_poll_interval_sec: Number(getVal('set_notification_poll_interval_sec')) || 15
    };
}

async function saveAllSettings() {
    const updates = collectSettingsFromUI();
    const saveBtn = document.getElementById('saveSettingsBtn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
    }

    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ updates })
        });
        const data = await res.json();
        if (data.success) {
            showToast('All site and portal settings saved successfully!', 'success');
            applyLiveSiteSettings(updates);
            fetchSettings();
        } else {
            showToast(data.message || 'Error saving site settings', 'error');
        }
    } catch (e) {
        console.error('Error saving settings:', e);
        showToast('Network error saving settings', 'error');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save All Settings';
        }
    }
}

async function resetAllSettings() {
    if (!confirm('Are you sure you want to reset all site and portal configurations to default settings? This action will be recorded in the audit trail.')) {
        return;
    }

    try {
        const res = await fetch('/api/settings/reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (data.success) {
            showToast('Site settings reset to default values!', 'success');
            fetchSettings();
        } else {
            showToast(data.message || 'Error resetting settings', 'error');
        }
    } catch (e) {
        console.error('Error resetting settings:', e);
        showToast('Network error resetting settings', 'error');
    }
}

function initSettingsTabs() {
    const tabBtns = document.querySelectorAll('.settings-tab-btn');
    const panels = {
        site_branding: document.getElementById('panelSettingsBranding'),
        permissions_control: document.getElementById('panelSettingsPermissions'),
        appearance: document.getElementById('panelSettingsAppearance'),
        candidate_portal: document.getElementById('panelSettingsCandidatePortal'),
        security_auth: document.getElementById('panelSettingsSecurity'),
        notifications_ui: document.getElementById('panelSettingsNotifications'),
        maintenance: document.getElementById('panelSettingsMaintenance')
    };

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.dataset.tab;
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            Object.entries(panels).forEach(([key, panel]) => {
                if (panel) {
                    if (key === targetTab) panel.classList.remove('hidden');
                    else panel.classList.add('hidden');
                }
            });
        });
    });
}

function handleTestNotification() {
    showToast('Test Notification: Site alert sounds and toasts are functioning properly.', 'info');
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Milky Mist Portal', {
            body: 'Test Notification: Site rules and alert toasts are active.',
            icon: ''
        });
    } else if ('Notification' in window && Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                new Notification('Milky Mist Portal', {
                    body: 'Desktop notifications enabled for Milky Mist HR.',
                    icon: ''
                });
            }
        });
    }
}

// Wire Settings Listeners
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const resetSettingsBtn = document.getElementById('resetSettingsBtn');
const resetAllSettingsCardBtn = document.getElementById('resetAllSettingsCardBtn');
const clearLocalPrefsBtn = document.getElementById('clearLocalPrefsBtn');
const testNotificationBtn = document.getElementById('testNotificationBtn');

if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', saveAllSettings);
if (resetSettingsBtn) resetSettingsBtn.addEventListener('click', resetAllSettings);
if (resetAllSettingsCardBtn) resetAllSettingsCardBtn.addEventListener('click', resetAllSettings);
if (clearLocalPrefsBtn) {
    clearLocalPrefsBtn.addEventListener('click', () => {
        try {
            localStorage.removeItem('mm_sidebar_pinned');
            localStorage.removeItem('mm_tasks_snoozed');
            showToast('Local browser preferences and snooze caches cleared!', 'success');
        } catch (e) {
            showToast('Failed to clear local preferences.', 'error');
        }
    });
}
if (testNotificationBtn) testNotificationBtn.addEventListener('click', handleTestNotification);
initSettingsTabs();

/* ==========================================================================
   Milky Mist Payroll & Offer Letter System Controllers
   ========================================================================== */

function formatINR(val) {
    if (val === null || val === undefined || isNaN(val)) return '₹0.00';
    return '₹' + Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function inrToWords(num) {
    if (!num || isNaN(num) || num <= 0) return 'Zero Rupees Only';
    const a = ['', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '];
    const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    function convertGroup(n) {
        if (n === 0) return '';
        if (n < 20) return a[n];
        const tens = b[Math.floor(n / 10)];
        const ones = n % 10 ? ' ' + a[n % 10].trim() : '';
        return (tens + ones).trim() + ' ';
    }
    const n = Math.floor(num);
    const crore = Math.floor(n / 10000000);
    const lakh = Math.floor((n % 10000000) / 100000);
    const thousand = Math.floor((n % 100000) / 1000);
    const hundred = Math.floor((n % 1000) / 100);
    const rest = n % 100;
    let str = '';
    if (crore) str += convertGroup(crore) + 'Crore ';
    if (lakh) str += convertGroup(lakh) + 'Lakh ';
    if (thousand) str += convertGroup(thousand) + 'Thousand ';
    if (hundred) str += convertGroup(hundred) + 'Hundred ';
    if (rest) {
        if (str !== '') str += 'and ';
        str += convertGroup(rest);
    }
    return str.trim() + ' Rupees Only';
}

// 1. Fetch & Render Payroll Records
async function fetchPayroll() {
    const month = document.getElementById('payMonthSelector')?.value || '2026-10';
    const dept = document.getElementById('payDeptFilter')?.value || '';
    const search = document.getElementById('paySearchInput')?.value || '';
    const tbody = document.getElementById('payrollTableBody');
    const exportBtn = document.getElementById('exportPayrollCsvBtn');

    if (exportBtn) {
        exportBtn.href = `/api/payroll/export?month=${encodeURIComponent(month)}`;
    }

    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="13" class="text-center" style="padding:1.5rem; color:var(--text-secondary);">Loading payroll records...</td></tr>';
    }

    try {
        const query = new URLSearchParams({ month, department: dept, search }).toString();
        const res = await fetch(`/api/payroll?${query}`);
        const data = await res.json();

        if (!data.success) {
            if (tbody) tbody.innerHTML = `<tr><td colspan="13" class="text-center" style="color:var(--red); padding:1.5rem;">Error: ${escapeHtml(data.message || 'Failed to load payroll')}</td></tr>`;
            return;
        }

        const records = data.data || [];
        if (records.length === 0) {
            if (tbody) tbody.innerHTML = '<tr><td colspan="13" class="text-center" style="padding:2rem; color:var(--text-secondary);">No payroll records found for this period. Click <strong>"Run Attendance Payroll"</strong> to compute monthly ledger.</td></tr>';
            return;
        }

        let html = '';
        records.forEach(r => {
            const lopDeductionText = r.lop_days > 0 
                ? `<span style="color:#DC2626; font-weight:700;">${r.lop_days}d (-${formatINR(r.lop_deductions)})</span>`
                : `<span style="color:#16A34A;">0d (₹0.00)</span>`;

            html += `
                <tr>
                    <td><strong style="color:var(--blue);">${escapeHtml(r.emp_id)}</strong></td>
                    <td><strong>${escapeHtml(r.emp_name)}</strong></td>
                    <td><span style="font-size:0.8rem; color:var(--text-secondary);">${escapeHtml(r.department)}</span></td>
                    <td>${escapeHtml(r.designation)}</td>
                    <td>${formatINR(r.basic_pay)}</td>
                    <td>${formatINR(r.plant_allowance)}</td>
                    <td><span style="color:#7C3AED; font-weight:600;">${formatINR(r.shift_allowance)}</span></td>
                    <td>${lopDeductionText}</td>
                    <td><strong>${formatINR(r.gross_salary)}</strong></td>
                    <td style="color:#DC2626;">-${formatINR(r.total_deductions)}</td>
                    <td><strong style="color:#1E40AF; font-size:0.95rem;">${formatINR(r.net_salary)}</strong></td>
                    <td>
                        <span class="badge" style="background:#DCFCE7; color:#15803D; font-weight:700; text-transform:uppercase; font-size:0.7rem; padding:0.2rem 0.5rem; border-radius:4px;">
                            ${escapeHtml(r.payment_status || 'Processed')}
                        </span>
                    </td>
                    <td style="text-align:right;">
                        <button type="button" class="btn btn-sm" style="background:#EEF2FF; color:#4338CA; border:1px solid #C7D2FE; font-weight:600; padding:0.25rem 0.6rem;" onclick="openPayslipModal('${escapeHtml(r.emp_id)}', '${escapeHtml(r.payroll_month)}')">
                            View Slip
                        </button>
                    </td>
                </tr>
            `;
        });

        if (tbody) tbody.innerHTML = html;
    } catch (err) {
        console.error('Error fetching payroll:', err);
        if (tbody) tbody.innerHTML = '<tr><td colspan="13" class="text-center" style="color:var(--red); padding:1.5rem;">Failed to connect to payroll service.</td></tr>';
    }
}

// 2. Fetch High-Impact KPI Telemetry
async function fetchPayrollStats() {
    const month = document.getElementById('payMonthSelector')?.value || '2026-10';
    try {
        const res = await fetch(`/api/payroll/stats?month=${encodeURIComponent(month)}`);
        const json = await res.json();
        if (json.success && json.data) {
            const d = json.data;
            const elDisbursed = document.getElementById('payStatDisbursed');
            const elCount = document.getElementById('payStatStaffCount');
            const elLop = document.getElementById('payStatLopDeductions');
            const elAllowances = document.getElementById('payStatAllowances');

            if (elDisbursed) elDisbursed.textContent = formatINR(d.total_disbursed ?? d.total_net_disbursed);
            if (elCount) elCount.textContent = d.total_staff ?? d.staff_count ?? '0';
            if (elLop) elLop.textContent = formatINR(d.total_lop_deductions);
            if (elAllowances) elAllowances.textContent = formatINR(d.total_allowances ?? d.total_shift_allowances);
        }
    } catch (err) {
        console.error('Error fetching payroll stats:', err);
    }
}

// 3. Run Attendance Payroll Generator
async function runAttendancePayroll() {
    const month = document.getElementById('payMonthSelector')?.value || '2026-10';
    const btn = document.getElementById('runPayrollBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = 'Computing Payroll...';
    }

    try {
        const res = await fetch(`/api/payroll/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ month_year: month })
        });
        const data = await res.json();
        if (data.success) {
            const count = data.count ?? data.processed ?? 0;
            const payout = data.total_payout ?? data.total_net ?? 0;
            showToast(`Payroll for ${month} calculated for ${count} staff! Disbursed: ${formatINR(payout)}`, 'success');
            await fetchPayroll();
            await fetchPayrollStats();
        } else {
            showToast(`Payroll failed: ${data.message}`, 'error');
        }
    } catch (err) {
        console.error('Error running payroll:', err);
        showToast('Server error while calculating payroll.', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = 'Run Attendance Payroll';
        }
    }
}

// 4. Payslip Document Viewer & Print Controller
async function openPayslipModal(empId, month) {
    if (!month) month = document.getElementById('payMonthSelector')?.value || '2026-10';
    const modal = document.getElementById('payslipModal');

    try {
        const res = await fetch(`/api/payroll/${encodeURIComponent(empId)}/slip?month=${encodeURIComponent(month)}`);
        const json = await res.json();
        if (!json.success || !json.data) {
            showToast(`Payslip not found for ${empId}`, 'error');
            return;
        }

        const s = json.data;
        // Header
        const sub = document.getElementById('slipSubtitle');
        const badge = document.getElementById('slipMonthBadge');
        if (sub) sub.textContent = `Pay Period: ${s.payroll_month}`;
        if (badge) badge.textContent = s.payroll_month.toUpperCase();

        // Emp Info
        document.getElementById('slipEmpId').textContent = s.emp_id;
        document.getElementById('slipEmpName').textContent = s.emp_name;
        document.getElementById('slipDept').textContent = s.department;
        document.getElementById('slipDesig').textContent = s.designation;
        document.getElementById('slipLocation').textContent = s.plant_location || 'Perundurai Mega Plant (HQ)';
        document.getElementById('slipBank').textContent = s.bank_account || 'HDFC-Bank-0492';
        document.getElementById('slipUan').textContent = s.pf_uan || 'UAN-1009482711';
        document.getElementById('slipPresentDays').textContent = s.present_days;
        document.getElementById('slipLopDays').textContent = s.lop_days;

        // Earnings
        document.getElementById('slipBasic').textContent = formatINR(s.basic_pay);
        document.getElementById('slipHra').textContent = formatINR(s.hra);
        document.getElementById('slipConveyance').textContent = formatINR(s.conveyance);
        document.getElementById('slipPlantAllowance').textContent = formatINR(s.plant_allowance);
        document.getElementById('slipShiftAllowance').textContent = formatINR(s.shift_allowance);

        // Deductions
        document.getElementById('slipPf').textContent = formatINR(s.pf_deduction);
        document.getElementById('slipEsi').textContent = formatINR(s.esi_deduction);
        document.getElementById('slipLopDeduction').textContent = formatINR(s.lop_deductions);

        // Totals
        document.getElementById('slipGross').textContent = formatINR(s.gross_salary);
        document.getElementById('slipTotalDeductions').textContent = formatINR(s.total_deductions);
        document.getElementById('slipNetPay').textContent = formatINR(s.net_salary);
        document.getElementById('slipNetWords').textContent = inrToWords(s.net_salary);

        if (modal) modal.classList.remove('hidden');
    } catch (err) {
        console.error('Error loading payslip:', err);
        showToast('Failed to retrieve payslip.', 'error');
    }
}

function closePayslipModal() {
    const modal = document.getElementById('payslipModal');
    if (modal) modal.classList.add('hidden');
}

// 5. Offer Letter Generation & Dynamic CTC Calculator
function updateCtcBreakdown() {
    const ctcAnnual = parseFloat(document.getElementById('offerCtcAnnual')?.value) || 0;
    const grossMonthly = Math.round(ctcAnnual / 12);
    const basic = Math.round(grossMonthly * 0.50);
    const hra = Math.round(basic * 0.50); // 25% of gross
    const plant = Math.round(grossMonthly * 0.15); // 15% of gross
    const pf = Math.round(basic * 0.12); // 12% PF
    const estNet = grossMonthly - pf;

    const elGross = document.getElementById('previewGross');
    const elBasic = document.getElementById('previewBasic');
    const elHra = document.getElementById('previewHra');
    const elPlant = document.getElementById('previewPlant');
    const elPf = document.getElementById('previewPf');
    const elNet = document.getElementById('previewNet');

    if (elGross) elGross.textContent = formatINR(grossMonthly);
    if (elBasic) elBasic.textContent = formatINR(basic);
    if (elHra) elHra.textContent = formatINR(hra);
    if (elPlant) elPlant.textContent = formatINR(plant);
    if (elPf) elPf.textContent = formatINR(pf);
    if (elNet) elNet.textContent = formatINR(estNet);
}

async function openCreateOfferModalFromCandidate(appId) {
    const modal = document.getElementById('createOfferModal');
    const subTitle = document.getElementById('offerCandidateSubtitle');
    const form = document.getElementById('createOfferForm');
    if (form) form.reset();

    const joinDateInput = document.getElementById('offerJoiningDate');
    if (joinDateInput) {
        const d = new Date();
        d.setDate(d.getDate() + 21); // Default 3 weeks out
        joinDateInput.value = d.toISOString().split('T')[0];
    }

    const ctcInput = document.getElementById('offerCtcAnnual');
    if (ctcInput) ctcInput.value = 600000;
    updateCtcBreakdown();

    if (appId) {
        document.getElementById('offerCandidateAppId').value = appId;
        if (subTitle) subTitle.textContent = `Candidate Application: ${appId}`;

        // Attempt to find candidate details
        try {
            const res = await fetch(`/api/candidates/${encodeURIComponent(appId)}`);
            const json = await res.json();
            if (json.success && json.data) {
                const c = json.data;
                document.getElementById('offerCandidateName').value = c.name || '';
                document.getElementById('offerCandidateEmail').value = c.email || '';
                
                // Auto-suggest designation based on work experience
                const we = (c.work_experience || '').toLowerCase();
                const ed = (c.education || '').toLowerCase();
                let desig = 'Dairy Operations Specialist';
                let dept = 'Dairy Processing & Production';
                if (we.includes('qa') || we.includes('food safety') || we.includes('haccp') || ed.includes('food')) {
                    desig = 'Senior Food Safety & HACCP Specialist';
                    dept = 'QA & Food Safety';
                } else if (we.includes('cold') || we.includes('logistics') || we.includes('supply')) {
                    desig = 'Cold Chain Fleet Supervisor';
                    dept = 'Cold Chain Logistics';
                } else if (we.includes('electr') || we.includes('plc') || we.includes('automation') || ed.includes('engineer')) {
                    desig = 'Automation & CIP Systems Engineer';
                    dept = 'Engineering & Automation';
                }
                document.getElementById('offerDesignation').value = desig;
                document.getElementById('offerDepartment').value = dept;
            }
        } catch (err) {
            console.error('Error fetching candidate for offer:', err);
        }
    } else {
        document.getElementById('offerCandidateAppId').value = '';
        if (subTitle) subTitle.textContent = 'Ad-hoc Offer & Appointment Letter';
    }

    if (modal) modal.classList.remove('hidden');
}

function closeCreateOfferModal() {
    const modal = document.getElementById('createOfferModal');
    if (modal) modal.classList.add('hidden');
}

async function submitCreateOffer(e) {
    if (e) e.preventDefault();

    const appId = document.getElementById('offerCandidateAppId')?.value.trim() || null;
    const name = document.getElementById('offerCandidateName')?.value.trim();
    const email = document.getElementById('offerCandidateEmail')?.value.trim();
    const designation = document.getElementById('offerDesignation')?.value.trim();
    const department = document.getElementById('offerDepartment')?.value;
    const plantLocation = document.getElementById('offerPlantLocation')?.value;
    const joiningDate = document.getElementById('offerJoiningDate')?.value;
    const ctcAnnual = parseFloat(document.getElementById('offerCtcAnnual')?.value) || 0;
    const notes = document.getElementById('offerNotes')?.value.trim();

    if (!name || !email || !designation || !joiningDate || !ctcAnnual) {
        showToast('Please fill all required offer letter fields.', 'warning');
        return;
    }

    const payload = {
        candidate_app_id: appId,
        candidate_name: name,
        candidate_email: email,
        designation: designation,
        department: department,
        plant_location: plantLocation,
        joining_date: joiningDate,
        ctc_annual: ctcAnnual,
        special_conditions: notes
    };

    const submitBtn = document.getElementById('submitCreateOfferBtn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Generating Letterhead...';
    }

    try {
        const res = await fetch('/api/offers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success && data.data) {
            closeCreateOfferModal();
            showToast(`Offer letter generated: ${data.data.offer_ref}`, 'success');
            await openOfferLetterModal(data.data.offer_ref);
        } else {
            showToast(`Failed to generate offer: ${data.message}`, 'error');
        }
    } catch (err) {
        console.error('Error submitting offer letter:', err);
        showToast('Server error while issuing offer letter.', 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Issue Official Offer Letter';
        }
    }
}

// 6. View & Print Official Offer Letter Document
async function openOfferLetterModal(identifier) {
    const modal = document.getElementById('offerLetterViewModal');
    try {
        const res = await fetch(`/api/offers/${encodeURIComponent(identifier)}`);
        const json = await res.json();
        if (!json.success || !json.data) {
            showToast('Offer letter document not found.', 'error');
            return;
        }

        const o = json.data;
        document.getElementById('offerDocRef').textContent = `Ref: ${o.offer_ref}`;
        document.getElementById('offerDocDate').textContent = o.issue_date || 'Today';
        document.getElementById('offerDocCandName').textContent = o.candidate_name;
        document.getElementById('offerDocCandEmail').textContent = o.candidate_email;
        document.getElementById('offerDocCandAppId').textContent = o.candidate_app_id ? `Candidate Application ID: ${o.candidate_app_id}` : '';
        document.getElementById('offerDocGreetingName').textContent = o.candidate_name.split(' ')[0] || o.candidate_name;
        document.getElementById('offerDocDesignation').textContent = o.designation;
        document.getElementById('offerDocDepartment').textContent = o.department;
        document.getElementById('offerDocPlantLocation').textContent = o.plant_location;
        document.getElementById('offerDocJoiningDate').textContent = o.joining_date;
        document.getElementById('offerDocAnnualCtc').textContent = `${formatINR(o.ctc_annual)} /- per annum`;
        document.getElementById('offerDocSignName').textContent = o.candidate_name;

        // Annexure Numbers
        document.getElementById('offerDocBasicMonthly').textContent = formatINR(o.basic_monthly);
        document.getElementById('offerDocBasicAnnual').textContent = formatINR(o.basic_monthly * 12);
        document.getElementById('offerDocHraMonthly').textContent = formatINR(o.hra_monthly);
        document.getElementById('offerDocHraAnnual').textContent = formatINR(o.hra_monthly * 12);
        document.getElementById('offerDocPlantMonthly').textContent = formatINR(o.plant_allowance_monthly);
        document.getElementById('offerDocPlantAnnual').textContent = formatINR(o.plant_allowance_monthly * 12);
        document.getElementById('offerDocPfMonthly').textContent = formatINR(o.pf_monthly);
        document.getElementById('offerDocPfAnnual').textContent = formatINR(o.pf_monthly * 12);
        document.getElementById('offerDocGrossMonthly').textContent = formatINR(o.gross_monthly);
        document.getElementById('offerDocGrossAnnual').textContent = formatINR(o.ctc_annual);

        if (modal) modal.classList.remove('hidden');
    } catch (err) {
        console.error('Error loading offer letter:', err);
        showToast('Failed to load offer letter document.', 'error');
    }
}

function closeOfferLetterModal() {
    const modal = document.getElementById('offerLetterViewModal');
    if (modal) modal.classList.add('hidden');
}

// 7. Wire Payroll & Offer Listeners
document.addEventListener('DOMContentLoaded', () => {
    // Payroll toolbar listeners
    const payMonth = document.getElementById('payMonthSelector');
    const payDept = document.getElementById('payDeptFilter');
    const paySearch = document.getElementById('paySearchInput');
    const runPayBtn = document.getElementById('runPayrollBtn');

    if (payMonth) {
        payMonth.addEventListener('change', () => {
            fetchPayroll();
            fetchPayrollStats();
        });
    }
    if (payDept) payDept.addEventListener('change', fetchPayroll);
    if (paySearch) {
        let debouncePayTimer;
        paySearch.addEventListener('input', () => {
            clearTimeout(debouncePayTimer);
            debouncePayTimer = setTimeout(fetchPayroll, 300);
        });
    }
    if (runPayBtn) runPayBtn.addEventListener('click', runAttendancePayroll);

    // Payslip modal buttons
    const closeSlipBtn = document.getElementById('closePayslipBtn');
    const cancelSlipBtn = document.getElementById('cancelPayslipBtn');
    const printSlipBtn = document.getElementById('printPayslipBtn');
    if (closeSlipBtn) closeSlipBtn.addEventListener('click', closePayslipModal);
    if (cancelSlipBtn) cancelSlipBtn.addEventListener('click', closePayslipModal);
    if (printSlipBtn) printSlipBtn.addEventListener('click', () => window.print());

    // Create Offer modal buttons & CTC input
    const closeCreateOffer = document.getElementById('closeCreateOfferBtn');
    const cancelCreateOffer = document.getElementById('cancelCreateOfferBtn');
    const createOfferForm = document.getElementById('createOfferForm');
    const ctcInput = document.getElementById('offerCtcAnnual');

    if (closeCreateOffer) closeCreateOffer.addEventListener('click', closeCreateOfferModal);
    if (cancelCreateOffer) cancelCreateOffer.addEventListener('click', closeCreateOfferModal);
    if (createOfferForm) createOfferForm.addEventListener('submit', submitCreateOffer);
    if (ctcInput) ctcInput.addEventListener('input', updateCtcBreakdown);

    // View Offer Letter modal buttons
    const closeOfferViewBtn = document.getElementById('closeOfferLetterViewBtn');
    const cancelOfferViewBtn = document.getElementById('cancelOfferLetterViewBtn');
    const printOfferBtn = document.getElementById('printOfferLetterBtn');
    if (closeOfferViewBtn) closeOfferViewBtn.addEventListener('click', closeOfferLetterModal);
    if (cancelOfferViewBtn) cancelOfferViewBtn.addEventListener('click', closeOfferLetterModal);
    if (printOfferBtn) printOfferBtn.addEventListener('click', () => window.print());

    // Leave & Time-Off Management Listeners
    const tabRequestsBtn = document.getElementById('tabLeaveRequestsBtn');
    const tabBalancesBtn = document.getElementById('tabLeaveBalancesBtn');
    const reqSection = document.getElementById('leaveRequestsTabSection');
    const balSection = document.getElementById('leaveBalancesTabSection');

    if (tabRequestsBtn && tabBalancesBtn) {
        tabRequestsBtn.addEventListener('click', () => {
            tabRequestsBtn.classList.add('active');
            tabRequestsBtn.style.background = '#FFFFFF';
            tabRequestsBtn.style.color = 'var(--text-primary)';
            tabBalancesBtn.classList.remove('active');
            tabBalancesBtn.style.background = 'transparent';
            tabBalancesBtn.style.color = 'var(--text-secondary)';
            if (reqSection) reqSection.classList.remove('hidden');
            if (balSection) balSection.classList.add('hidden');
        });
        tabBalancesBtn.addEventListener('click', () => {
            tabBalancesBtn.classList.add('active');
            tabBalancesBtn.style.background = '#FFFFFF';
            tabBalancesBtn.style.color = 'var(--text-primary)';
            tabRequestsBtn.classList.remove('active');
            tabRequestsBtn.style.background = 'transparent';
            tabRequestsBtn.style.color = 'var(--text-secondary)';
            if (balSection) balSection.classList.remove('hidden');
            if (reqSection) reqSection.classList.add('hidden');
            fetchLeaveBalances();
        });
    }

    const leaveStatus = document.getElementById('leaveStatusFilter');
    const leaveType = document.getElementById('leaveTypeFilter');
    const leaveSearch = document.getElementById('leaveSearchInput');

    if (leaveStatus) leaveStatus.addEventListener('change', fetchLeaveRequests);
    if (leaveType) leaveType.addEventListener('change', fetchLeaveRequests);
    if (leaveSearch) {
        let debLeave;
        leaveSearch.addEventListener('input', () => {
            clearTimeout(debLeave);
            debLeave = setTimeout(fetchLeaveRequests, 300);
        });
    }

    const openApplyLeave = document.getElementById('openApplyLeaveBtn');
    const closeApplyLeave = document.getElementById('closeApplyLeaveBtn');
    const cancelApplyLeave = document.getElementById('cancelApplyLeaveBtn');
    const applyForm = document.getElementById('applyLeaveForm');
    const empSelect = document.getElementById('leaveEmpSelect');
    const startDateInput = document.getElementById('leaveStartDate');
    const endDateInput = document.getElementById('leaveEndDate');

    if (openApplyLeave) openApplyLeave.addEventListener('click', () => openApplyLeaveModal());
    if (closeApplyLeave) closeApplyLeave.addEventListener('click', closeApplyLeaveModal);
    if (cancelApplyLeave) cancelApplyLeave.addEventListener('click', closeApplyLeaveModal);
    if (applyForm) applyForm.addEventListener('submit', submitApplyLeave);
    if (empSelect) empSelect.addEventListener('change', (e) => updateLeaveModalBalancePreview(e.target.value));
    if (startDateInput) startDateInput.addEventListener('change', calculateLeaveDays);
    if (endDateInput) endDateInput.addEventListener('change', calculateLeaveDays);

    const closeRejectLeave = document.getElementById('closeRejectLeaveBtn');
    const cancelRejectLeave = document.getElementById('cancelRejectLeaveBtn');
    const confirmRejectLeave = document.getElementById('confirmRejectLeaveBtn');

    if (closeRejectLeave) closeRejectLeave.addEventListener('click', closeRejectLeaveModal);
    if (cancelRejectLeave) cancelRejectLeave.addEventListener('click', closeRejectLeaveModal);
    if (confirmRejectLeave) confirmRejectLeave.addEventListener('click', confirmRejectLeave);
});

/* ==========================================================================
   Milky Mist Leave & Time-Off Management Controllers
   ========================================================================== */

// 1. Fetch & Render Leave Requests
async function fetchLeaveRequests() {
    const status = document.getElementById('leaveStatusFilter')?.value || '';
    const type = document.getElementById('leaveTypeFilter')?.value || '';
    const search = document.getElementById('leaveSearchInput')?.value || '';
    const tbody = document.getElementById('leaveRequestsTableBody');

    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="11" class="text-center" style="padding:1.5rem; color:var(--text-secondary);">Loading leave requests...</td></tr>';
    }

    try {
        const query = new URLSearchParams({ status, search }).toString();
        const res = await fetch(`/api/leaves?${query}`);
        const data = await res.json();

        if (!data.success) {
            if (tbody) tbody.innerHTML = `<tr><td colspan="11" class="text-center" style="color:var(--red); padding:1.5rem;">Error: ${escapeHtml(data.message || 'Failed to load leaves')}</td></tr>`;
            return;
        }

        let requests = data.data || [];
        if (type) {
            requests = requests.filter(r => (r.leave_type || '').toLowerCase().includes(type.toLowerCase()));
        }

        if (requests.length === 0) {
            if (tbody) tbody.innerHTML = '<tr><td colspan="11" class="text-center" style="padding:2rem; color:var(--text-secondary);">No leave applications found matching your criteria.</td></tr>';
            return;
        }

        let html = '';
        requests.forEach(r => {
            const st = (r.status || 'Pending').toLowerCase();
            let statusBadge = '<span class="badge" style="background:#FEF3C7; color:#B45309; font-weight:700;">Pending</span>';
            if (st === 'approved') {
                statusBadge = '<span class="badge" style="background:#DCFCE7; color:#15803D; font-weight:700;">Approved</span>';
            } else if (st === 'rejected') {
                statusBadge = '<span class="badge" style="background:#FEE2E2; color:#B91C1C; font-weight:700;">Rejected</span>';
            }

            // Leave type badge style
            let typeColor = '#1E40AF';
            let typeBg = '#DBEAFE';
            if (r.leave_type.includes('Sick')) { typeColor = '#B45309'; typeBg = '#FEF3C7'; }
            else if (r.leave_type.includes('Earned')) { typeColor = '#6D28D9'; typeBg = '#EDE9FE'; }
            else if (r.leave_type.includes('Comp')) { typeColor = '#0E7490'; typeBg = '#CFFAFE'; }

            const typeBadge = `<span class="badge" style="background:${typeBg}; color:${typeColor}; font-weight:700;">${escapeHtml(r.leave_type)}</span>`;

            let actionHtml = '';
            if (st === 'pending') {
                actionHtml = `
                    <div style="display:inline-flex; gap:0.35rem;">
                        <button type="button" class="btn btn-sm btn-green" style="padding:0.25rem 0.55rem; font-weight:700;" onclick="approveLeaveRequest('${escapeHtml(r.leave_id)}')">
                            Approve
                        </button>
                        <button type="button" class="btn btn-sm btn-red" style="padding:0.25rem 0.55rem;" onclick="openRejectLeaveModal('${escapeHtml(r.leave_id)}')">
                            Reject
                        </button>
                    </div>
                `;
            } else {
                actionHtml = `<span style="font-size:0.75rem; color:var(--text-secondary);">${escapeHtml(r.admin_notes || (st === 'approved' ? 'Active' : 'Declined'))}</span>`;
            }

            const approverText = r.approved_by 
                ? `<span>${escapeHtml(r.approved_by)}</span><div style="font-size:0.7rem; color:var(--text-muted);">${escapeHtml(r.approved_at || '')}</div>` 
                : '<span style="color:var(--text-muted); font-size:0.775rem;">Awaiting Review</span>';

            html += `
                <tr>
                    <td><strong style="color:var(--blue);">${escapeHtml(r.leave_id)}</strong></td>
                    <td><strong>${escapeHtml(r.emp_name)}</strong> <span style="font-size:0.75rem; color:var(--text-muted);">(${escapeHtml(r.emp_id)})</span></td>
                    <td><span style="font-size:0.8rem; color:var(--text-secondary);">${escapeHtml(r.department)}</span></td>
                    <td>${typeBadge}</td>
                    <td><span style="font-size:0.825rem;">${escapeHtml(r.start_date)} → ${escapeHtml(r.end_date)}</span></td>
                    <td><strong style="color:#1E3A8A;">${r.days_count}d</strong></td>
                    <td><span style="font-size:0.8rem;">${escapeHtml(r.handover_to || '—')}</span></td>
                    <td title="${escapeHtml(r.reason)}"><span style="max-width:180px; display:inline-block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; vertical-align:bottom;">${escapeHtml(r.reason)}</span></td>
                    <td>${statusBadge}</td>
                    <td>${approverText}</td>
                    <td style="text-align:right;">${actionHtml}</td>
                </tr>
            `;
        });

        if (tbody) tbody.innerHTML = html;
    } catch (err) {
        console.error('Error fetching leave requests:', err);
        if (tbody) tbody.innerHTML = '<tr><td colspan="11" class="text-center" style="color:var(--red); padding:1.5rem;">Failed to connect to leave management service.</td></tr>';
    }
}

// 2. Fetch & Render Leave Balances
async function fetchLeaveBalances() {
    const tbody = document.getElementById('leaveBalancesTableBody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="10" class="text-center" style="padding:1.5rem; color:var(--text-secondary);">Loading leave balances...</td></tr>';
    }

    try {
        const res = await fetch('/api/leaves/balances');
        const data = await res.json();

        if (!data.success) {
            if (tbody) tbody.innerHTML = `<tr><td colspan="10" class="text-center" style="color:var(--red); padding:1.5rem;">Error: ${escapeHtml(data.message || 'Failed to load balances')}</td></tr>`;
            return;
        }

        const balances = data.data || [];
        if (balances.length === 0) {
            if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="text-center" style="padding:2rem; color:var(--text-secondary);">No staff leave balances configured.</td></tr>';
            return;
        }

        let totalQuotaDaysLeft = 0;
        let html = '';

        balances.forEach(b => {
            totalQuotaDaysLeft += (b.total_left || 0);

            html += `
                <tr>
                    <td><strong style="color:var(--blue);">${escapeHtml(b.emp_id)}</strong></td>
                    <td><strong>${escapeHtml(b.emp_name)}</strong></td>
                    <td><span style="font-size:0.8rem; color:var(--text-secondary);">${escapeHtml(b.department)}</span></td>
                    <td>
                        <span style="font-weight:700; color:#1E40AF;">${b.cl_left}</span> / ${b.cl_quota} 
                        <span style="font-size:0.75rem; color:var(--text-muted);">(${b.cl_used} used)</span>
                    </td>
                    <td>
                        <span style="font-weight:700; color:#15803D;">${b.sl_left}</span> / ${b.sl_quota} 
                        <span style="font-size:0.75rem; color:var(--text-muted);">(${b.sl_used} used)</span>
                    </td>
                    <td>
                        <span style="font-weight:700; color:#B45309;">${b.el_left}</span> / ${b.el_quota} 
                        <span style="font-size:0.75rem; color:var(--text-muted);">(${b.el_used} used)</span>
                    </td>
                    <td>${b.comp_off}d</td>
                    <td><strong style="color:#1E3A8A; font-size:0.95rem;">${b.total_left} days</strong></td>
                    <td><span style="color:#64748B;">${b.total_used} days</span></td>
                    <td style="text-align:right;">
                        <button type="button" class="btn btn-sm btn-blue" style="padding:0.25rem 0.6rem; font-weight:700;" onclick="openApplyLeaveModal('${escapeHtml(b.emp_id)}')">
                            + Apply
                        </button>
                    </td>
                </tr>
            `;
        });

        if (tbody) tbody.innerHTML = html;

        const elQuotaLeft = document.getElementById('leaveStatTotalQuotaLeft');
        if (elQuotaLeft) elQuotaLeft.textContent = totalQuotaDaysLeft;
    } catch (err) {
        console.error('Error fetching leave balances:', err);
        if (tbody) tbody.innerHTML = '<tr><td colspan="10" class="text-center" style="color:var(--red); padding:1.5rem;">Failed to load balance ledger.</td></tr>';
    }
}

// 3. Fetch Leave Telemetry KPIs
async function fetchLeaveStats() {
    try {
        const res = await fetch('/api/leaves/stats');
        const json = await res.json();
        if (json.success && json.data) {
            const d = json.data;
            const elPending = document.getElementById('leaveStatPending');
            const elOnLeave = document.getElementById('leaveStatOnLeaveToday');
            const elTotalDays = document.getElementById('leaveStatTotalDays');
            const navBadge = document.getElementById('navLeaveBadge');

            if (elPending) elPending.textContent = d.pending_count || '0';
            if (elOnLeave) elOnLeave.textContent = d.on_leave_today || '0';
            if (elTotalDays) elTotalDays.textContent = d.total_days_approved || '0';

            if (navBadge) {
                if (d.pending_count > 0) {
                    navBadge.textContent = d.pending_count;
                    navBadge.style.display = 'inline-block';
                } else {
                    navBadge.style.display = 'none';
                }
            }
        }
    } catch (err) {
        console.error('Error fetching leave stats:', err);
    }
}

// 4. Leave Application Modal Controller
async function openApplyLeaveModal(prefilledEmpId) {
    const modal = document.getElementById('applyLeaveModal');
    const select = document.getElementById('leaveEmpSelect');
    const previewBox = document.getElementById('leaveBalancePreviewBox');

    // Populate employee dropdown if empty
    if (select && select.options.length <= 1) {
        try {
            const res = await fetch('/api/employees');
            const json = await res.json();
            if (json.success && json.data) {
                select.innerHTML = '<option value="">-- Choose Employee --</option>' + 
                    json.data.map(e => `<option value="${escapeHtml(e.emp_id)}">${escapeHtml(e.name)} (${escapeHtml(e.emp_id)}) — ${escapeHtml(e.department)}</option>`).join('');
            }
        } catch (e) {
            console.error('Error loading employees for leave modal:', e);
        }
    }

    // Default dates: tomorrow
    const d1 = new Date();
    d1.setDate(d1.getDate() + 1);
    const dStr1 = d1.toISOString().split('T')[0];

    const startInput = document.getElementById('leaveStartDate');
    const endInput = document.getElementById('leaveEndDate');
    const daysInput = document.getElementById('leaveDaysCount');
    const reasonInput = document.getElementById('leaveReason');
    const handoverInput = document.getElementById('leaveHandover');

    if (startInput) startInput.value = dStr1;
    if (endInput) endInput.value = dStr1;
    if (daysInput) daysInput.value = 1;
    if (reasonInput) reasonInput.value = '';
    if (handoverInput) handoverInput.value = '';

    if (prefilledEmpId && select) {
        select.value = prefilledEmpId;
        updateLeaveModalBalancePreview(prefilledEmpId);
    } else {
        if (select) select.value = '';
        if (previewBox) previewBox.style.display = 'none';
    }

    if (modal) modal.classList.remove('hidden');
}

function closeApplyLeaveModal() {
    const modal = document.getElementById('applyLeaveModal');
    if (modal) modal.classList.add('hidden');
}

async function updateLeaveModalBalancePreview(empId) {
    const box = document.getElementById('leaveBalancePreviewBox');
    if (!empId) {
        if (box) box.style.display = 'none';
        return;
    }
    try {
        const res = await fetch(`/api/leaves/balances?emp_id=${encodeURIComponent(empId)}`);
        const json = await res.json();
        if (json.success && json.data && json.data.length > 0) {
            const b = json.data[0];
            document.getElementById('previewClLeft').textContent = b.cl_left;
            document.getElementById('previewSlLeft').textContent = b.sl_left;
            document.getElementById('previewElLeft').textContent = b.el_left;
            document.getElementById('previewTotalLeft').textContent = b.total_left;
            if (box) box.style.display = 'block';
        }
    } catch (e) {
        console.error('Error loading preview balances:', e);
    }
}

function calculateLeaveDays() {
    const startVal = document.getElementById('leaveStartDate')?.value;
    const endVal = document.getElementById('leaveEndDate')?.value;
    const daysInput = document.getElementById('leaveDaysCount');
    if (!startVal || !endVal || !daysInput) return;

    const s = new Date(startVal);
    const e = new Date(endVal);
    if (e >= s) {
        const diffTime = Math.abs(e - s);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
        daysInput.value = diffDays;
    } else {
        daysInput.value = 1;
    }
}

async function submitApplyLeave(e) {
    if (e) e.preventDefault();

    const empId = document.getElementById('leaveEmpSelect')?.value;
    const leaveType = document.getElementById('leaveTypeSelect')?.value;
    const startDate = document.getElementById('leaveStartDate')?.value;
    const endDate = document.getElementById('leaveEndDate')?.value;
    const daysCount = parseFloat(document.getElementById('leaveDaysCount')?.value) || 1;
    const handoverTo = document.getElementById('leaveHandover')?.value.trim();
    const reason = document.getElementById('leaveReason')?.value.trim();

    if (!empId || !leaveType || !startDate || !endDate || !reason) {
        showToast('Please fill all required leave application fields.', 'warning');
        return;
    }

    const payload = {
        emp_id: empId,
        leave_type: leaveType,
        start_date: startDate,
        end_date: endDate,
        days_count: daysCount,
        reason: reason,
        handover_to: handoverTo
    };

    const submitBtn = document.getElementById('submitApplyLeaveBtn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting Request...';
    }

    try {
        const res = await fetch('/api/leaves', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            closeApplyLeaveModal();
            showToast(`Leave request ${data.data.leave_id} submitted for ${data.data.emp_name}!`, 'success');
            await fetchLeaveRequests();
            await fetchLeaveBalances();
            await fetchLeaveStats();
        } else {
            showToast(`Failed: ${data.message || 'Submission error'}`, 'error');
        }
    } catch (err) {
        console.error('Error submitting leave:', err);
        showToast('Server error while applying for leave.', 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Leave Request';
        }
    }
}

// 5. Approve & Reject Leave Actions
async function approveLeaveRequest(leaveId) {
    if (!confirm(`Are you sure you want to approve leave request ${leaveId}? This will automatically sync to attendance records.`)) {
        return;
    }

    try {
        const res = await fetch(`/api/leaves/${encodeURIComponent(leaveId)}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'Approved', admin_notes: 'Approved by HR Lead' })
        });
        const data = await res.json();
        if (data.success) {
            showToast(`Leave ${leaveId} approved! Attendance roster updated.`, 'success');
            await fetchLeaveRequests();
            await fetchLeaveBalances();
            await fetchLeaveStats();
        } else {
            showToast(`Error: ${data.message}`, 'error');
        }
    } catch (err) {
        console.error('Error approving leave:', err);
        showToast('Server error while approving leave.', 'error');
    }
}

function openRejectLeaveModal(leaveId) {
    const modal = document.getElementById('rejectLeaveModal');
    const input = document.getElementById('rejectLeaveId');
    const notes = document.getElementById('rejectLeaveNotes');
    if (input) input.value = leaveId;
    if (notes) notes.value = '';
    if (modal) modal.classList.remove('hidden');
}

function closeRejectLeaveModal() {
    const modal = document.getElementById('rejectLeaveModal');
    if (modal) modal.classList.add('hidden');
}

async function confirmRejectLeave() {
    const leaveId = document.getElementById('rejectLeaveId')?.value;
    const notes = document.getElementById('rejectLeaveNotes')?.value.trim();

    if (!notes) {
        showToast('Please provide a reason for rejecting this leave.', 'warning');
        return;
    }

    try {
        const res = await fetch(`/api/leaves/${encodeURIComponent(leaveId)}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'Rejected', admin_notes: notes })
        });
        const data = await res.json();
        if (data.success) {
            closeRejectLeaveModal();
            showToast(`Leave request ${leaveId} rejected.`, 'info');
            await fetchLeaveRequests();
            await fetchLeaveBalances();
            await fetchLeaveStats();
        } else {
            showToast(`Error: ${data.message}`, 'error');
        }
    } catch (err) {
        console.error('Error rejecting leave:', err);
        showToast('Server error while rejecting leave.', 'error');
    }
}

// ==========================================================================
// Approved Resumes Controller & Actions
// ==========================================================================
let cachedApprovedCandidates = [];

async function fetchApprovedResumes() {
    const tbody = document.getElementById('approvedTableBody');
    if (!tbody) return;

    const search = document.getElementById('approvedSearchInput')?.value || '';
    const pipelineFilter = document.getElementById('approvedPipelineFilter')?.value || '';

    const queryParams = new URLSearchParams();
    if (search) queryParams.append('search', search);
    if (pipelineFilter) queryParams.append('pipeline_status', pipelineFilter);

    try {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding:2.5rem; color:var(--text-secondary);">Loading approved candidates...</td></tr>';
        const res = await fetch(`/api/approved?${queryParams.toString()}`);
        const data = await res.json();

        if (data.success) {
            cachedApprovedCandidates = data.data || [];
            updateApprovedTelemetry(cachedApprovedCandidates, data.telemetry);
            renderApprovedResumesTable(cachedApprovedCandidates);
        } else {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding:2.5rem; color:var(--red);">Failed to load approved candidates.</td></tr>';
        }
    } catch (err) {
        console.error('Error fetching approved resumes:', err);
        tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding:2.5rem; color:var(--text-secondary);">Network error loading approved candidates.</td></tr>';
    }
}

function updateApprovedTelemetry(candidates, telemetry) {
    const totalEl = document.getElementById('approvedStatTotal');
    const readyEl = document.getElementById('approvedStatReady');
    const inPipeEl = document.getElementById('approvedStatInPipeline');
    const onboardedEl = document.getElementById('approvedStatOnboarded');
    const countPill = document.getElementById('approvedShowingCountPill');
    const navBadge = document.getElementById('navApprovedBadge');

    const awaiting = telemetry ? telemetry.awaiting_recruitment : candidates.filter(c => !c.in_pipeline).length;
    const inPipe = telemetry ? telemetry.in_pipeline : 0;
    const onboarded = telemetry ? telemetry.onboarded : 0;

    if (totalEl) totalEl.textContent = awaiting;
    if (readyEl) readyEl.textContent = awaiting;
    if (inPipeEl) inPipeEl.textContent = inPipe;
    if (onboardedEl) onboardedEl.textContent = onboarded;
    if (countPill) countPill.textContent = `${candidates.length} awaiting recruitment`;
    if (navBadge) {
        navBadge.textContent = awaiting;
        navBadge.style.display = awaiting > 0 ? 'inline-flex' : 'none';
    }
}

function renderApprovedResumesTable(candidates) {
    const tbody = document.getElementById('approvedTableBody');
    if (!tbody) return;

    // Reset batch selection state
    const selectAllCb = document.getElementById('selectAllApprovedCheckbox');
    if (selectAllCb) selectAllCb.checked = false;
    updateApprovedBatchBar();

    if (!candidates || candidates.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="text-center" style="padding:3.5rem; color:var(--text-secondary);">
                    <div style="font-size:1.1rem; font-weight:600; color:var(--text-muted); margin-bottom:0.6rem;">No Records</div>
                    <strong style="font-size:1rem; color:var(--text-primary);">No approved resumes awaiting recruitment</strong>
                    <p style="font-size:0.875rem; margin-top:0.4rem; color:var(--text-muted); max-width:480px; margin-left:auto; margin-right:auto;">
                        All approved candidates have been transferred to the active <strong>Recruitment Pipeline</strong> or no candidates are pending recruitment. Candidates approved from <strong>Applications Received</strong> will appear here.
                    </p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = candidates.map(c => {
        const initials = (c.name || 'MM').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
        const isInPipeline = !!c.in_pipeline;
        const isOnboarded = c.recruitment_status === 'onboarded';
        const pct = c.progress_percent || 0;
        const completedCount = c.completed_count || 0;
        const totalStages = c.total_stages || 5;

        let statusBadge = '';
        if (isOnboarded) {
            statusBadge = `<span class="badge" style="background:#ECFDF5; color:#065F46; border:1px solid #A7F3D0; font-weight:600; padding:0.25rem 0.55rem; border-radius:4px; font-size:0.75rem;">Onboarded (${escapeHtml(c.onboarded_emp_id || 'Staff')})</span>`;
        } else if (isInPipeline) {
            statusBadge = `
                <div style="display:flex; flex-direction:column; gap:3px;">
                    <span class="badge" style="background:#EFF6FF; color:#1E40AF; border:1px solid #BFDBFE; font-weight:600; padding:0.25rem 0.55rem; border-radius:4px; font-size:0.75rem;">In Recruitment (${completedCount}/${totalStages} • ${pct}%)</span>
                    ${c.target_role ? `<span style="font-size:0.74rem; color:var(--text-secondary); margin-top:1px;">Role: <strong style="color:var(--text-primary); font-weight:600;">${escapeHtml(c.target_role)}</strong></span>` : ''}
                </div>
            `;
        } else {
            statusBadge = `
                <span class="badge" style="background:#FEF3C7; color:#92400E; border:1px solid #FDE68A; font-weight:600; padding:0.25rem 0.55rem; border-radius:4px; font-size:0.75rem;" title="Candidate approved in talent pool. Recruitment process not yet started.">
                    Awaiting Recruitment
                </span>
            `;
        }

        let actionButtons = '';
        if (!isInPipeline) {
            actionButtons = `
                <button type="button" class="btn btn-blue btn-sm" style="font-weight:600; padding:0.35rem 0.75rem; display:inline-flex; align-items:center; gap:0.35rem;" onclick="openStartRecruitmentModal('${escapeHtml(c.app_id)}')">
                    <span>Start Recruitment</span>
                </button>
            `;
        } else if (!isOnboarded) {
            actionButtons = `
                <button type="button" class="btn btn-secondary btn-sm" style="font-weight:500; padding:0.35rem 0.65rem;" onclick="selectModule('recruitment_pipeline', 'Recruitment')">
                    <span>View Pipeline (${pct}%)</span>
                </button>
                <button type="button" class="btn btn-secondary btn-sm" style="padding:0.35rem 0.6rem; font-size:0.75rem; color:var(--red);" title="Withdraw from pipeline back to talent pool" onclick="withdrawCandidateRecruitment('${escapeHtml(c.app_id)}', '${escapeHtml(c.name)}')">
                    Withdraw
                </button>
            `;
        } else {
            actionButtons = `
                <button type="button" class="btn btn-secondary btn-sm" style="font-weight:500; padding:0.35rem 0.75rem;" onclick="selectModule('employees', 'Onboarded Employees')">
                    <span>View Staff Record</span>
                </button>
            `;
        }

        const resumeBtn = c.resume_filename ? `
            <a href="/api/resume/${encodeURIComponent(c.resume_filename)}" target="_blank" class="btn btn-secondary btn-sm" style="padding:0.25rem 0.55rem; font-size:0.75rem; text-decoration:none;" title="Download Resume PDF">
                Resume PDF
            </a>
        ` : '<span style="color:var(--text-muted); font-size:0.75rem;">No PDF</span>';

        return `
            <tr>
                <td style="text-align:center;">
                    <input type="checkbox" class="approved-candidate-cb" data-app-id="${escapeHtml(c.app_id)}" ${isInPipeline ? 'disabled title="Candidate is already in recruitment pipeline"' : ''} onchange="updateApprovedBatchBar()">
                </td>
                <td><code>${escapeHtml(c.app_id)}</code></td>
                <td>
                    <div style="display:flex; align-items:center; gap:0.6rem;">
                        <div style="width:30px; height:30px; border-radius:50%; background:#F1F5F9; border:1px solid #E2E8F0; color:#475569; display:flex; align-items:center; justify-content:center; font-weight:600; font-size:0.72rem; flex-shrink:0;">
                            ${escapeHtml(initials)}
                        </div>
                        <div>
                            <strong style="color:var(--text-primary); font-weight:600;">${escapeHtml(c.name)}</strong>
                            <div style="font-size:0.75rem; color:var(--text-muted);">${c.dob ? `${escapeHtml(c.dob)} (${c.age || '—'} yrs)` : ''}</div>
                        </div>
                    </div>
                </td>
                <td>
                    <div><a href="mailto:${escapeHtml(c.email)}" style="color:var(--blue); font-size:0.85rem;">${escapeHtml(c.email)}</a></div>
                    <div style="font-size:0.78rem; color:var(--text-muted);">${escapeHtml(c.phone || '—')}</div>
                </td>
                <td><span style="font-size:0.85rem;">${escapeHtml(c.location || '—')}</span></td>
                <td>
                    <div style="max-width:240px; font-size:0.82rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(c.education || '')}">
                        ${escapeHtml(c.education || 'Not specified')}
                    </div>
                    <div style="max-width:240px; font-size:0.78rem; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(c.work_experience || '')}">
                        ${escapeHtml(c.work_experience || 'Fresher')}
                    </div>
                </td>
                <td>${statusBadge}</td>
                <td style="text-align:right; white-space:nowrap;">
                    <div style="display:inline-flex; align-items:center; gap:0.4rem;">
                        ${resumeBtn}
                        <button type="button" class="btn btn-secondary btn-sm" style="padding:0.25rem 0.55rem; font-size:0.78rem;" title="View Candidate Details" onclick="viewCandidate('${escapeHtml(c.app_id)}')">
                            View
                        </button>
                        ${actionButtons}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function openStartRecruitmentModal(appId) {
    const candidate = cachedApprovedCandidates.find(c => c.app_id === appId) || currentCandidate;
    if (!candidate) {
        showToast('Candidate record not found in approved candidates.', 'error');
        return;
    }

    const modal = document.getElementById('startRecruitmentModal');
    if (!modal) return;

    const appIdInput = document.getElementById('startRecruitAppId');
    const nameEl = document.getElementById('startRecruitCandidateName');
    const badgeEl = document.getElementById('startRecruitAppIdBadge');
    const subEl = document.getElementById('startRecruitCandidateSub');
    const avatarEl = document.getElementById('startRecruitAvatar');
    const roleInput = document.getElementById('startRecruitRole');
    const deptSelect = document.getElementById('startRecruitDepartment');
    const assigneeSelect = document.getElementById('startRecruitAssignee');
    const notesInput = document.getElementById('startRecruitNotes');

    const initials = (candidate.name || 'MM').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
    if (appIdInput) appIdInput.value = candidate.app_id;
    if (nameEl) nameEl.textContent = candidate.name;
    if (badgeEl) badgeEl.textContent = `#${candidate.app_id}`;
    let ageClean = String(candidate.age || '').replace(/\s*(years|year|yrs|yr)\b/gi, '').trim();
    const ageText = ageClean ? `${ageClean} years` : '';
    if (subEl) subEl.textContent = [candidate.location || 'Location Pending', ageText, candidate.education ? candidate.education.split('\n')[0] : ''].filter(Boolean).join(' • ');

    // Auto-suggest role based on candidate details or education
    let defaultRole = 'Software Engineer';
    let defaultDept = 'Engineering & IT';
    const edu = (candidate.education || '').toLowerCase();
    const exp = (candidate.work_experience || '').toLowerCase();
    if (/food|dairy|agri|microbio|chem|safety/i.test(edu + ' ' + exp)) {
        defaultRole = 'QA & Food Safety Executive';
        defaultDept = 'QA & Food Safety';
    } else if (/mba|bba|sales|market|fmcg/i.test(edu + ' ' + exp)) {
        defaultRole = 'Sales & FMCG Coordinator';
        defaultDept = 'Sales & FMCG Distribution';
    } else if (/mech|electr|plant|operat|machine/i.test(edu + ' ' + exp)) {
        defaultRole = 'Plant Operations Manager';
        defaultDept = 'Dairy Processing & Production';
    } else if (/hr|human|recruit|personnel/i.test(edu + ' ' + exp)) {
        defaultRole = 'HR Executive';
        defaultDept = 'Human Resources';
    } else if (/finance|account|b.com|m.com|tax/i.test(edu + ' ' + exp)) {
        defaultRole = 'Finance & Accounts Associate';
        defaultDept = 'Finance & Accounts';
    }

    if (roleInput) roleInput.value = candidate.target_role || defaultRole;
    if (deptSelect) deptSelect.value = candidate.department || defaultDept;
    if (assigneeSelect && currentUser) assigneeSelect.value = currentUser.username;
    if (notesInput) notesInput.value = '';

    modal.classList.remove('hidden');
}

function closeStartRecruitmentModal() {
    const modal = document.getElementById('startRecruitmentModal');
    if (modal) modal.classList.add('hidden');
}

async function submitStartRecruitment(e) {
    if (e) e.preventDefault();

    const appId = document.getElementById('startRecruitAppId')?.value;
    const targetRole = document.getElementById('startRecruitRole')?.value.trim();
    const department = document.getElementById('startRecruitDepartment')?.value;
    const assignedRecruiter = document.getElementById('startRecruitAssignee')?.value;
    const initialStatus = document.getElementById('startRecruitInitialStatus')?.value || 'in_progress';
    const notes = document.getElementById('startRecruitNotes')?.value.trim();

    if (!appId) {
        showToast('Candidate ID is required.', 'error');
        return;
    }
    if (!targetRole) {
        showToast('Please enter a target job role.', 'warning');
        return;
    }

    const confirmBtn = document.getElementById('confirmStartRecruitBtn');
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<span>Initiating...</span>';
    }

    try {
        const res = await fetch(`/api/recruitment/candidates/${encodeURIComponent(appId)}/start-recruitment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                target_role: targetRole,
                department: department,
                assigned_recruiter: assignedRecruiter,
                initial_status: initialStatus,
                notes: notes
            })
        });

        const data = await res.json();
        if (data.success) {
            closeStartRecruitmentModal();
            const candidateName = data.data?.name || appId;
            showToast(`Recruitment initiated for ${candidateName} (Role: ${targetRole})`, 'success');
            await fetchApprovedResumes();
            await fetchStats();
            if (typeof fetchRecruitmentPipeline === 'function') {
                await fetchRecruitmentPipeline();
            }
        } else {
            showToast(`Error: ${data.message || data.detail || 'Failed to start recruitment'}`, 'error');
        }
    } catch (err) {
        console.error('Error starting recruitment:', err);
        showToast('Network error starting recruitment.', 'error');
    } finally {
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = '<span>Confirm & Start Recruitment</span>';
        }
    }
}

async function withdrawCandidateRecruitment(appId, name) {
    const candidateName = name || appId;
    if (!confirm(`Withdraw candidate "${candidateName}" from active recruitment?\n\nThey will be safely returned to the Approved Resumes pool and paused from hiring evaluation.`)) {
        return;
    }

    try {
        const res = await fetch(`/api/recruitment/candidates/${encodeURIComponent(appId)}/withdraw`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();

        if (data.success) {
            showToast(`Candidate ${candidateName} returned to Approved Talent Pool`, 'info');
            await fetchApprovedResumes();
            await fetchStats();
            if (typeof fetchRecruitmentPipeline === 'function') {
                await fetchRecruitmentPipeline();
            }
        } else {
            showToast(`Error: ${data.message || data.detail || 'Failed to withdraw'}`, 'error');
        }
    } catch (err) {
        console.error('Error withdrawing candidate:', err);
        showToast('Network error withdrawing candidate.', 'error');
    }
}

function updateApprovedBatchBar() {
    const checkboxes = document.querySelectorAll('.approved-candidate-cb:checked');
    const count = checkboxes.length;
    const bar = document.getElementById('approvedBatchActionBar');
    const countEl = document.getElementById('approvedSelectedCount');

    if (countEl) countEl.textContent = count;
    if (bar) {
        bar.style.display = count > 0 ? 'flex' : 'none';
    }
}

async function submitBatchStartRecruitment() {
    const checkboxes = document.querySelectorAll('.approved-candidate-cb:checked');
    const selectedIds = Array.from(checkboxes).map(cb => cb.dataset.appId).filter(Boolean);

    if (selectedIds.length === 0) {
        showToast('Please select at least one approved candidate.', 'warning');
        return;
    }

    const rolePrompt = prompt(`Start recruitment for ${selectedIds.length} candidate(s)?\n\nEnter Target Designation/Role for this batch (or leave blank to assign individually):`, "Executive Trainee");
    if (rolePrompt === null) return; // user cancelled

    try {
        const res = await fetch('/api/recruitment/candidates/batch-start-recruitment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                app_ids: selectedIds,
                target_role: rolePrompt || "Batch Trainee",
                department: "General",
                initial_status: "in_progress"
            })
        });

        const data = await res.json();
        if (data.success) {
            showToast(`Started recruitment for ${data.count} candidate(s)`, 'success');
            await fetchApprovedResumes();
            await fetchStats();
            if (typeof fetchRecruitmentPipeline === 'function') {
                await fetchRecruitmentPipeline();
            }
        } else {
            showToast(`Batch start failed: ${data.message || data.detail}`, 'error');
        }
    } catch (err) {
        console.error('Error in batch start recruitment:', err);
        showToast('Network error during batch recruitment initiation.', 'error');
    }
}

// Wire batch controls and start recruitment modal events
const selectAllApprovedCb = document.getElementById('selectAllApprovedCheckbox');
if (selectAllApprovedCb) {
    selectAllApprovedCb.addEventListener('change', (e) => {
        const rowCbs = document.querySelectorAll('.approved-candidate-cb:not(:disabled)');
        rowCbs.forEach(cb => { cb.checked = e.target.checked; });
        updateApprovedBatchBar();
    });
}

const clearApprovedSelBtn = document.getElementById('clearApprovedSelectionBtn');
if (clearApprovedSelBtn) {
    clearApprovedSelBtn.addEventListener('click', () => {
        const rowCbs = document.querySelectorAll('.approved-candidate-cb');
        rowCbs.forEach(cb => { cb.checked = false; });
        if (selectAllApprovedCb) selectAllApprovedCb.checked = false;
        updateApprovedBatchBar();
    });
}

const batchStartRecruitBtn = document.getElementById('batchStartRecruitBtn');
if (batchStartRecruitBtn) {
    batchStartRecruitBtn.addEventListener('click', submitBatchStartRecruitment);
}

const closeStartRecruitBtn = document.getElementById('closeStartRecruitmentModalBtn');
if (closeStartRecruitBtn) closeStartRecruitBtn.addEventListener('click', closeStartRecruitmentModal);

const cancelStartRecruitBtn = document.getElementById('cancelStartRecruitBtn');
if (cancelStartRecruitBtn) cancelStartRecruitBtn.addEventListener('click', closeStartRecruitmentModal);

const startRecruitForm = document.getElementById('startRecruitmentForm');
if (startRecruitForm) startRecruitForm.addEventListener('submit', submitStartRecruitment);

// Hook search & filter for approved resumes
const approvedSearchInput = document.getElementById('approvedSearchInput');
if (approvedSearchInput) {
    approvedSearchInput.addEventListener('input', debounce(() => fetchApprovedResumes(), 300));
}
const approvedPipelineFilter = document.getElementById('approvedPipelineFilter');
if (approvedPipelineFilter) {
    approvedPipelineFilter.addEventListener('change', () => fetchApprovedResumes());
}


// ==========================================================================
// Recruitment Pipeline & Dynamic Workflow Progress Controllers
// ==========================================================================
let activeWorkflowStages = ["Willingness", "Interview", "Salary Negotiation", "Offer Letter", "Joining Date"];
let cachedPipelineCandidates = [];
let selectedPipelineCandidateIds = new Set();

async function fetchRecruitmentPipeline() {
    const container = document.getElementById('pipelineContainer');
    if (!container) return;

    const search = document.getElementById('pipelineSearchInput')?.value || '';
    const status = document.getElementById('pipelineStatusFilter')?.value || '';

    try {
        const queryParams = new URLSearchParams();
        if (search) queryParams.append('search', search);
        if (status) queryParams.append('status', status);

        const res = await fetch(`/api/recruitment/candidates?${queryParams.toString()}`);
        const data = await res.json();

        if (data.success) {
            activeWorkflowStages = data.stages || activeWorkflowStages;
            cachedPipelineCandidates = data.data || [];
            
            // Clean up any stale selected candidate IDs that no longer appear
            const currentAppIds = new Set(cachedPipelineCandidates.map(c => c.app_id));
            for (const id of Array.from(selectedPipelineCandidateIds)) {
                if (!currentAppIds.has(id)) {
                    selectedPipelineCandidateIds.delete(id);
                }
            }
            updateBatchActionBar();

            updatePipelineStats(cachedPipelineCandidates);
            renderPipelineCandidates(cachedPipelineCandidates, activeWorkflowStages);
            
            const badge = document.getElementById('navPipelineBadge');
            if (badge) {
                badge.textContent = cachedPipelineCandidates.length;
                badge.style.display = cachedPipelineCandidates.length > 0 ? 'inline-block' : 'none';
            }
        } else {
            container.innerHTML = '<div class="text-center" style="padding:3rem; color:var(--text-secondary);">Failed to load pipeline data.</div>';
        }
    } catch (err) {
        console.error('Error loading recruitment pipeline:', err);
        container.innerHTML = '<div class="text-center" style="padding:3rem; color:var(--text-secondary);">Error connecting to pipeline service.</div>';
    }
}

function updatePipelineStats(candidates) {
    const totalEl = document.getElementById('pipeStatTotal');
    const onHoldEl = document.getElementById('pipeStatOnHold');
    const inProgEl = document.getElementById('pipeStatInProgress');
    const readyEl = document.getElementById('pipeStatReady');

    if (totalEl) totalEl.textContent = candidates.length;
    if (onHoldEl) onHoldEl.textContent = candidates.filter(c => c.recruitment_status === 'on_hold').length;
    if (inProgEl) inProgEl.textContent = candidates.filter(c => c.recruitment_status === 'in_progress').length;
    if (readyEl) readyEl.textContent = candidates.filter(c => c.recruitment_status === 'ready_to_onboard' || c.recruitment_status === 'onboarded').length;
}

function renderPipelineCandidates(candidates, stages) {
    const container = document.getElementById('pipelineContainer');
    if (!container) return;

    if (!candidates || candidates.length === 0) {
        container.innerHTML = `
            <div style="background:#FFFFFF; border:1px solid var(--border-color); border-radius:8px; padding:3rem 2rem; text-align:center;">
                <h3 style="margin-bottom:0.4rem; color:var(--text-primary); font-size:1.1rem; font-weight:700;">No Candidates in Recruitment Pipeline</h3>
                <p style="color:var(--text-secondary); max-width:480px; margin:0 auto 1.5rem; font-size:0.875rem;">
                    Candidates in the <strong>Approved Resumes</strong> talent bank will appear here once you proceed with <strong>Start Recruitment</strong> for their profile.
                </p>
                <button type="button" class="btn btn-blue" onclick="selectModule('approved', 'Approved Resumes')">
                    Go to Approved Resumes
                </button>
            </div>
        `;
        return;
    }

    container.innerHTML = candidates.map(c => {
        // Candidate's specific stages if custom, otherwise global active workflow stages
        const candStages = (c.stages && c.stages.length > 0) ? c.stages : (stages && stages.length > 0 ? stages : activeWorkflowStages);
        const completedStages = c.completed_stages || [];
        const totalStagesCount = candStages.length;
        const validCompletedCount = completedStages.filter(st => candStages.includes(st)).length;
        const percent = totalStagesCount > 0 
            ? Math.round((validCompletedCount / totalStagesCount) * 100) 
            : (c.progress_percent != null ? c.progress_percent : (c.progress_pct || 0));
        const isComplete = percent >= 100;
        const isOnboarded = c.recruitment_status === 'onboarded';
        const hasCustom = Boolean(c.has_custom_workflow || c.custom_stages);
        const isSelected = selectedPipelineCandidateIds.has(c.app_id);

        // Stage checkboxes (Strict Sequential Progression according to candidate's stages)
        const stagesHtml = candStages.map((st, idx) => {
            const isChecked = completedStages.includes(st);
            const isPriorCompleted = idx === 0 || completedStages.includes(candStages[idx - 1]);
            const isLocked = !isChecked && !isPriorCompleted;
            
            let tooltip = '';
            if (isLocked) {
                tooltip = `Locked: Complete prior stage "${candStages[idx - 1]}" first`;
            } else if (isChecked) {
                tooltip = `Completed • Click to uncheck (subsequent stages will also reset)`;
            } else {
                tooltip = `Click to complete stage: ${st}`;
            }

            return `
                <label class="pipeline-stage-item ${isChecked ? 'checked' : ''} ${isLocked ? 'locked' : ''}" 
                       title="${escapeHtml(tooltip)}" 
                       onclick="event.stopPropagation();">
                    <input type="checkbox" 
                           ${isChecked ? 'checked' : ''} 
                           ${isLocked ? 'disabled' : ''} 
                           onchange="toggleCandidateStage('${escapeHtml(c.app_id)}', '${escapeHtml(st)}', this.checked)">
                    <span>${isLocked ? '<span style="font-size:0.7rem; color:var(--text-muted); margin-right:3px;">•</span> ' : ''}${escapeHtml(st)}</span>
                </label>
            `;
        }).join('');

        return `
            <div class="pipeline-card ${isSelected ? 'selected' : ''}" id="pipeCard-${escapeHtml(c.app_id)}">
                <div class="pipeline-card-main">
                    <!-- Multi-select Checkbox on Far Left -->
                    <div class="pipeline-card-select-wrap">
                        <input type="checkbox" 
                               class="pipeline-select-cb" 
                               data-appid="${escapeHtml(c.app_id)}"
                               ${isSelected ? 'checked' : ''} 
                               onchange="toggleCandidateSelection('${escapeHtml(c.app_id)}', this.checked)">
                    </div>

                    <!-- Main Candidate Details & Stage Controls -->
                    <div class="pipeline-card-body">
                        <div class="pipeline-cand-header-row">
                            <div class="pipeline-cand-name">
                                <span>${escapeHtml(c.name)}</span>
                                <span class="pipeline-id-tag">${escapeHtml(c.app_id)}</span>
                                ${hasCustom ? `<span class="badge" style="background:#EFF6FF; color:#1D4ED8; border:1px solid #BFDBFE; font-size:0.68rem; font-weight:700; padding:2px 6px; border-radius:4px;" title="This candidate has a tailored evaluation workflow">Custom Process</span>` : ''}
                                ${isOnboarded ? `<span class="badge shortlisted">Onboarded: ${escapeHtml(c.onboarded_emp_id || '')}</span>` : ''}
                                <!-- Circular Progress Percentage Graph shifted right after badges with clear visibility -->
                                <div class="pipeline-circle-chart inline-header-chart" title="${percent}% Complete (${validCompletedCount}/${totalStagesCount} stages completed)">
                                    <svg viewBox="0 0 36 36" class="circle-graph-svg">
                                        <path class="circle-bg"
                                              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                                        <path class="circle-fill ${isComplete ? 'complete' : ''}"
                                              stroke-dasharray="${percent}, 100"
                                              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                                        <text x="18" y="19" class="circle-text ${isComplete ? 'complete' : ''}">${percent}%</text>
                                    </svg>
                                </div>
                            </div>

                            <div class="pipeline-card-actions">
                                <button type="button" class="btn btn-secondary btn-workflow-compact" onclick="openCandidateWorkflowModal('${escapeHtml(c.app_id)}', '${escapeHtml(c.name)}')" title="Customize workflow stages specifically for ${escapeHtml(c.name)}">
                                    Edit Workflow
                                </button>

                                <select class="pipe-status-select" onchange="changeCandidatePipelineStatus('${escapeHtml(c.app_id)}', this.value)">
                                    <option value="on_hold" ${c.recruitment_status === 'on_hold' ? 'selected' : ''}>On Hold</option>
                                    <option value="in_progress" ${c.recruitment_status === 'in_progress' ? 'selected' : ''}>In Progress</option>
                                    <option value="ready_to_onboard" ${c.recruitment_status === 'ready_to_onboard' ? 'selected' : ''}>Ready to Onboard</option>
                                    <option value="onboarded" ${c.recruitment_status === 'onboarded' ? 'selected' : ''} ${isOnboarded ? '' : 'disabled'}>Onboarded</option>
                                    <option value="rejected" ${c.recruitment_status === 'rejected' ? 'selected' : ''}>Rejected</option>
                                </select>

                                ${!isOnboarded ? `
                                    <button type="button" class="btn btn-green btn-onboard-compact" onclick="openOnboardCandidateModal('${escapeHtml(c.app_id)}', '${escapeHtml(c.name)}', '${escapeHtml(c.email)}')">
                                        Onboard
                                    </button>
                                ` : `
                                    <button type="button" class="btn btn-secondary btn-onboard-compact" onclick="selectModule('employees', 'Onboarded Employees')">
                                        Directory
                                    </button>
                                `}
                            </div>
                        </div>

                        <!-- Sequential Checklist Stages Row -->
                        <div class="pipeline-stages-row">
                            ${stagesHtml}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

async function toggleCandidateStage(appId, stageName, isCompleted) {
    const candidate = (cachedPipelineCandidates || []).find(c => c.app_id === appId);
    const stages = (candidate && candidate.stages && candidate.stages.length > 0)
        ? candidate.stages
        : (activeWorkflowStages || []);
    const stageIdx = stages.indexOf(stageName);

    if (candidate && isCompleted && stageIdx > 0) {
        const completedList = candidate.completed_stages || [];
        const prevStage = stages[stageIdx - 1];
        if (!completedList.includes(prevStage)) {
            showToast(`Cannot proceed to "${stageName}" until prior stage "${prevStage}" is completed.`, 'warning');
            await fetchRecruitmentPipeline();
            return;
        }
    }

    try {
        const res = await fetch(`/api/recruitment/candidates/${encodeURIComponent(appId)}/stage`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stage: stageName, completed: isCompleted })
        });
        const data = await res.json();
        if (data.success) {
            const msg = isCompleted 
                ? `Stage "${stageName}" completed for ${appId}`
                : `Stage "${stageName}" unchecked (subsequent stages reset)`;
            showToast(msg, 'info');
            await fetchRecruitmentPipeline();
        } else {
            showToast(`Error: ${data.detail || data.message || 'Failed to update stage'}`, 'error');
            await fetchRecruitmentPipeline();
        }
    } catch (err) {
        console.error('Error updating stage:', err);
        showToast('Failed to update stage.', 'error');
        await fetchRecruitmentPipeline();
    }
}

async function changeCandidatePipelineStatus(appId, newStatus) {
    const isReject = (newStatus === 'rejected');
    if (isReject) {
        if (!confirm(`Are you sure you want to REJECT candidate ${appId}? This will remove them from the recruitment pipeline and move them to Rejected Applications.`)) {
            await fetchRecruitmentPipeline();
            return;
        }
    }

    try {
        const res = await fetch(`/api/recruitment/candidates/${encodeURIComponent(appId)}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        const data = await res.json();
        if (data.success) {
            if (isReject) {
                showToast(`Candidate ${appId} moved to Rejected Applications.`, 'info');
                if (selectedPipelineCandidateIds && selectedPipelineCandidateIds.has(appId)) {
                    selectedPipelineCandidateIds.delete(appId);
                    updateBatchActionBar();
                }
            } else {
                showToast(`Status updated to ${newStatus}`, 'info');
            }
            await fetchRecruitmentPipeline();
            if (typeof fetchStats === 'function') await fetchStats();
            if (typeof fetchCandidates === 'function') await fetchCandidates();
            if (typeof fetchApprovedResumes === 'function') await fetchApprovedResumes();
        } else {
            showToast(`Error: ${data.detail || data.message}`, 'error');
            await fetchRecruitmentPipeline();
        }
    } catch (err) {
        console.error('Error changing pipeline status:', err);
        showToast('Failed to change status.', 'error');
        await fetchRecruitmentPipeline();
    }
}

// ============================================================================
// Multi-Select & Batch Operations for Recruitment Pipeline
// ============================================================================
function toggleCandidateSelection(appId, isChecked) {
    if (isChecked) {
        selectedPipelineCandidateIds.add(appId);
    } else {
        selectedPipelineCandidateIds.delete(appId);
    }
    const cardEl = document.getElementById('pipeCard-' + appId);
    if (cardEl) cardEl.classList.toggle('selected', isChecked);
    updateBatchActionBar();
}

function toggleSelectAllCandidates(isChecked) {
    if (isChecked) {
        (cachedPipelineCandidates || []).forEach(c => {
            if (c.app_id) selectedPipelineCandidateIds.add(c.app_id);
        });
    } else {
        selectedPipelineCandidateIds.clear();
    }
    document.querySelectorAll('.pipeline-select-cb').forEach(cb => {
        cb.checked = isChecked;
    });
    document.querySelectorAll('.pipeline-card').forEach(card => {
        card.classList.toggle('selected', isChecked);
    });
    updateBatchActionBar();
}

function clearCandidateSelection() {
    selectedPipelineCandidateIds.clear();
    const selectAllCb = document.getElementById('pipelineSelectAllCb');
    if (selectAllCb) {
        selectAllCb.checked = false;
        selectAllCb.indeterminate = false;
    }
    document.querySelectorAll('.pipeline-select-cb').forEach(cb => {
        cb.checked = false;
    });
    document.querySelectorAll('.pipeline-card').forEach(card => {
        card.classList.remove('selected');
    });
    updateBatchActionBar();
}

function updateBatchActionBar() {
    const bar = document.getElementById('pipelineBatchActionBar');
    if (!bar) return;
    const count = selectedPipelineCandidateIds.size;
    const total = (cachedPipelineCandidates || []).length;
    const selectAllCb = document.getElementById('pipelineSelectAllCb');

    if (count > 0) {
        bar.classList.remove('hidden');
        const badge = document.getElementById('batchSelectedCountBadge');
        if (badge) badge.textContent = `${count} selected`;
        const obNum = document.getElementById('batchOnboardNum');
        if (obNum) obNum.textContent = count;
        const rjNum = document.getElementById('batchRejectNum');
        if (rjNum) rjNum.textContent = count;

        if (selectAllCb) {
            selectAllCb.checked = (total > 0 && count === total);
            selectAllCb.indeterminate = (count > 0 && count < total);
        }
    } else {
        bar.classList.add('hidden');
        if (selectAllCb) {
            selectAllCb.checked = false;
            selectAllCb.indeterminate = false;
        }
    }
}

async function executeBatchStatus(newStatus) {
    const count = selectedPipelineCandidateIds.size;
    if (count === 0) {
        showToast('Please select at least one candidate first.', 'warning');
        return;
    }
    const labelMap = {
        'on_hold': 'On Hold',
        'in_progress': 'In Progress',
        'ready_to_onboard': 'Ready to Onboard',
        'rejected': 'Rejected'
    };
    const statusLabel = labelMap[newStatus] || newStatus;
    if (!confirm(`Are you sure you want to set status to "${statusLabel}" for ${count} selected candidate(s)?`)) {
        return;
    }

    try {
        const appIds = Array.from(selectedPipelineCandidateIds);
        const res = await fetch('/api/recruitment/batch/status', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ app_ids: appIds, status: newStatus })
        });
        const data = await res.json();
        if (data.success) {
            showToast(data.message || `Successfully updated ${data.count || count} candidate(s).`, 'success');
            clearCandidateSelection();
            await fetchRecruitmentPipeline();
        } else {
            showToast(`Error: ${data.detail || data.message || 'Batch update failed'}`, 'error');
        }
    } catch (err) {
        console.error('Batch status update failed:', err);
        showToast('Failed to execute batch status update.', 'error');
    }
}

async function executeBatchReject() {
    const count = selectedPipelineCandidateIds.size;
    if (count === 0) {
        showToast('Please select at least one candidate first.', 'warning');
        return;
    }
    if (!confirm(`Are you sure you want to REJECT ${count} selected candidate(s)? They will be removed from the pipeline and moved to Rejected Applications.`)) {
        return;
    }

    try {
        const appIds = Array.from(selectedPipelineCandidateIds);
        const res = await fetch('/api/recruitment/batch/status', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ app_ids: appIds, status: 'rejected' })
        });
        const data = await res.json();
        if (data.success) {
            showToast(`Successfully moved ${data.count || count} candidate(s) to Rejected Applications.`, 'info');
            clearCandidateSelection();
            await fetchRecruitmentPipeline();
            if (typeof fetchStats === 'function') await fetchStats();
            if (typeof fetchCandidates === 'function') await fetchCandidates();
            if (typeof fetchApprovedResumes === 'function') await fetchApprovedResumes();
        } else {
            showToast(`Error: ${data.detail || data.message || 'Batch rejection failed'}`, 'error');
        }
    } catch (err) {
        console.error('Batch rejection failed:', err);
        showToast('Failed to reject selected candidates.', 'error');
    }
}

async function executeBatchOnboard() {
    const count = selectedPipelineCandidateIds.size;
    if (count === 0) {
        showToast('Please select at least one candidate first.', 'warning');
        return;
    }
    if (!confirm(`Are you sure you want to bulk ONBOARD ${count} selected candidate(s)? This will generate active employee profiles in Onboarded Employees.`)) {
        return;
    }

    try {
        const appIds = Array.from(selectedPipelineCandidateIds);
        const res = await fetch('/api/recruitment/batch/onboard', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ app_ids: appIds })
        });
        const data = await res.json();
        if (data.success) {
            showToast(data.message || `Successfully onboarded ${data.count || count} candidate(s)!`, 'success');
            clearCandidateSelection();
            await fetchRecruitmentPipeline();
            if (typeof fetchEmployeeStats === 'function') await fetchEmployeeStats();
        } else {
            showToast(`Error: ${data.detail || data.message || 'Batch onboarding failed'}`, 'error');
        }
    } catch (err) {
        console.error('Batch onboarding failed:', err);
        showToast('Failed to bulk onboard candidates.', 'error');
    }
}

// Search and filter listeners for pipeline
const pipeSearchInput = document.getElementById('pipelineSearchInput');
if (pipeSearchInput) {
    let debounceTimer;
    pipeSearchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(fetchRecruitmentPipeline, 250);
    });
}

const pipeStatusFilter = document.getElementById('pipelineStatusFilter');
if (pipeStatusFilter) {
    pipeStatusFilter.addEventListener('change', fetchRecruitmentPipeline);
}

// Edit Workflow Stages Modal
let editingStagesList = [];

const openEditWorkflowModalBtn = document.getElementById('openEditWorkflowModalBtn');
const closeEditWorkflowBtn = document.getElementById('closeEditWorkflowBtn');
const cancelEditWorkflowBtn = document.getElementById('cancelEditWorkflowBtn');
const editWorkflowModal = document.getElementById('editWorkflowModal');
const addWorkflowStageBtn = document.getElementById('addWorkflowStageBtn');
const newStageInput = document.getElementById('newStageInput');
const resetWorkflowDefaultsBtn = document.getElementById('resetWorkflowDefaultsBtn');
const saveWorkflowBtn = document.getElementById('saveWorkflowBtn');

function renderWorkflowStagesEditor() {
    const listEl = document.getElementById('workflowStagesList');
    if (!listEl) return;

    listEl.innerHTML = editingStagesList.map((st, idx) => `
        <div class="workflow-stage-row">
            <div class="workflow-stage-drag">
                <span style="color:var(--text-muted); font-size:0.8rem; width:20px;">${idx + 1}.</span>
                <span>${escapeHtml(st)}</span>
            </div>
            <div class="workflow-stage-actions">
                <button type="button" class="btn-icon-xs" title="Move Up" onclick="moveWorkflowStage(${idx}, -1)" ${idx === 0 ? 'disabled style="opacity:0.4"' : ''}>▲</button>
                <button type="button" class="btn-icon-xs" title="Move Down" onclick="moveWorkflowStage(${idx}, 1)" ${idx === editingStagesList.length - 1 ? 'disabled style="opacity:0.4"' : ''}>▼</button>
                <button type="button" class="btn-icon-xs delete" title="Remove Stage" onclick="removeWorkflowStage(${idx})">✕</button>
            </div>
        </div>
    `).join('');
}

function moveWorkflowStage(index, direction) {
    const newIdx = index + direction;
    if (newIdx < 0 || newIdx >= editingStagesList.length) return;
    const temp = editingStagesList[index];
    editingStagesList[index] = editingStagesList[newIdx];
    editingStagesList[newIdx] = temp;
    renderWorkflowStagesEditor();
}

function removeWorkflowStage(index) {
    if (editingStagesList.length <= 1) {
        showToast('Workflow must have at least one stage.', 'warning');
        return;
    }
    editingStagesList.splice(index, 1);
    renderWorkflowStagesEditor();
}

let editingWorkflowTargetAppId = null;

async function openCandidateWorkflowModal(appId, candidateName) {
    editingWorkflowTargetAppId = appId;
    const titleEl = document.getElementById('editWorkflowModalTitle');
    const subEl = document.getElementById('editWorkflowModalSubtitle');
    const saveBtn = document.getElementById('saveWorkflowBtn');

    if (titleEl) titleEl.textContent = `Edit Workflow — ${candidateName}`;
    if (subEl) subEl.textContent = `Customize the evaluation stages specifically for ${candidateName} (${appId}). If this candidate has a different evaluation process, adjust their stages below.`;
    if (saveBtn) saveBtn.textContent = 'Save Candidate Workflow';

    try {
        const res = await fetch(`/api/recruitment/candidates/${encodeURIComponent(appId)}/workflow`);
        const data = await res.json();
        editingStagesList = (data.stages && data.stages.length > 0) ? [...data.stages] : [...activeWorkflowStages];
    } catch (e) {
        const cand = (cachedPipelineCandidates || []).find(c => c.app_id === appId);
        editingStagesList = (cand && cand.stages && cand.stages.length > 0) ? [...cand.stages] : [...activeWorkflowStages];
    }

    renderWorkflowStagesEditor();
    if (editWorkflowModal) editWorkflowModal.classList.remove('hidden');
}

if (openEditWorkflowModalBtn) {
    openEditWorkflowModalBtn.addEventListener('click', async () => {
        editingWorkflowTargetAppId = null;
        const titleEl = document.getElementById('editWorkflowModalTitle');
        const subEl = document.getElementById('editWorkflowModalSubtitle');
        const saveBtn = document.getElementById('saveWorkflowBtn');

        if (titleEl) titleEl.textContent = 'Edit Standard Recruitment Workflow';
        if (subEl) subEl.textContent = 'Customize the standard stages for candidate evaluation (default for all applicants).';
        if (saveBtn) saveBtn.textContent = 'Save Standard Workflow';

        try {
            const res = await fetch('/api/recruitment/workflow');
            const data = await res.json();
            editingStagesList = data.stages ? [...data.stages] : [...activeWorkflowStages];
        } catch (e) {
            editingStagesList = [...activeWorkflowStages];
        }
        renderWorkflowStagesEditor();
        if (editWorkflowModal) editWorkflowModal.classList.remove('hidden');
    });
}

if (closeEditWorkflowBtn) closeEditWorkflowBtn.addEventListener('click', () => editWorkflowModal?.classList.add('hidden'));
if (cancelEditWorkflowBtn) cancelEditWorkflowBtn.addEventListener('click', () => editWorkflowModal?.classList.add('hidden'));

if (addWorkflowStageBtn && newStageInput) {
    addWorkflowStageBtn.addEventListener('click', () => {
        const val = newStageInput.value.trim();
        if (!val) return;
        if (editingStagesList.includes(val)) {
            showToast('Stage already exists.', 'warning');
            return;
        }
        editingStagesList.push(val);
        newStageInput.value = '';
        renderWorkflowStagesEditor();
    });
    newStageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addWorkflowStageBtn.click();
        }
    });
}

if (resetWorkflowDefaultsBtn) {
    resetWorkflowDefaultsBtn.addEventListener('click', () => {
        editingStagesList = ["Willingness", "Interview", "Salary Negotiation", "Offer Letter", "Joining Date"];
        renderWorkflowStagesEditor();
        showToast('Reset to standard stages. Click Save to apply.', 'info');
    });
}

if (saveWorkflowBtn) {
    saveWorkflowBtn.addEventListener('click', async () => {
        if (editingStagesList.length === 0) {
            showToast('Workflow must have at least one stage.', 'warning');
            return;
        }
        try {
            let endpoint = '/api/recruitment/workflow';
            if (editingWorkflowTargetAppId) {
                endpoint = `/api/recruitment/candidates/${encodeURIComponent(editingWorkflowTargetAppId)}/workflow`;
            }

            const res = await fetch(endpoint, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stages: editingStagesList })
            });
            const data = await res.json();
            if (data.success) {
                const successMsg = editingWorkflowTargetAppId
                    ? `Workflow for ${editingWorkflowTargetAppId} updated successfully!`
                    : 'Standard recruitment workflow updated!';
                showToast(successMsg, 'success');
                editWorkflowModal?.classList.add('hidden');
                if (!editingWorkflowTargetAppId) {
                    activeWorkflowStages = data.stages || editingStagesList;
                }
                await fetchRecruitmentPipeline();
            } else {
                showToast(`Error: ${data.message || data.detail}`, 'error');
            }
        } catch (err) {
            console.error('Error saving workflow:', err);
            showToast('Failed to save workflow changes.', 'error');
        }
    });
}

// Onboard Candidate to Employee Modal Controllers
const onboardModal = document.getElementById('onboardCandidateModal');
const closeOnboardCandidateBtn = document.getElementById('closeOnboardCandidateBtn');
const cancelOnboardCandidateBtn = document.getElementById('cancelOnboardCandidateBtn');
const onboardForm = document.getElementById('onboardCandidateForm');

function openOnboardCandidateModal(appId, name, email) {
    const appIdInput = document.getElementById('onboardAppId');
    const nameEl = document.getElementById('onboardCandidateName');
    const metaEl = document.getElementById('onboardCandidateMeta');
    const joinDateInput = document.getElementById('onboardJoiningDate');

    if (appIdInput) appIdInput.value = appId;
    if (nameEl) nameEl.textContent = name || appId;
    if (metaEl) metaEl.textContent = `Application ID: ${appId} • Email: ${email || '—'}`;
    if (joinDateInput) joinDateInput.value = new Date().toISOString().split('T')[0];

    if (onboardModal) onboardModal.classList.remove('hidden');
}

if (closeOnboardCandidateBtn) closeOnboardCandidateBtn.addEventListener('click', () => onboardModal?.classList.add('hidden'));
if (cancelOnboardCandidateBtn) cancelOnboardCandidateBtn.addEventListener('click', () => onboardModal?.classList.add('hidden'));

if (onboardForm) {
    onboardForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const appId = document.getElementById('onboardAppId')?.value;
        if (!appId) return;

        const payload = {
            department: document.getElementById('onboardDepartment')?.value || 'Human Resources',
            designation: document.getElementById('onboardDesignation')?.value || 'Executive',
            joining_date: document.getElementById('onboardJoiningDate')?.value || null,
            shift: document.getElementById('onboardShift')?.value || 'General',
            ctc: parseFloat(document.getElementById('onboardCtc')?.value || 0),
            blood_group: document.getElementById('onboardBloodGroup')?.value || ''
        };

        try {
            const res = await fetch(`/api/recruitment/candidates/${encodeURIComponent(appId)}/onboard`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (data.success) {
                showToast(`Candidate onboarded successfully as ${data.data.emp_id}`, 'success');
                onboardModal?.classList.add('hidden');
                await fetchRecruitmentPipeline();
                await fetchEmployeeStats();
            } else {
                showToast(`Error: ${data.message || data.detail}`, 'error');
            }
        } catch (err) {
            console.error('Error onboarding candidate:', err);
            showToast('Failed to complete onboarding.', 'error');
        }
    });
}

// ============================================================================
// 12. MASTER ACCESS & PERMISSIONS CONTROL CENTER CONTROLLERS
// ============================================================================
let cachedUsersPermissions = [];

async function fetchMasterPermissionsMatrix() {
    const tbody = document.getElementById('masterPermissionsTableBody');
    if (!tbody) return;

    try {
        tbody.innerHTML = '<tr><td colspan="12" class="text-center" style="padding:2rem;">Loading access permissions matrix...</td></tr>';
        const res = await fetch('/api/auth/users');
        const data = await res.json();

        if (data.success && data.data) {
            cachedUsersPermissions = data.data;
            renderMasterPermissionsTable(cachedUsersPermissions);
        } else {
            tbody.innerHTML = '<tr><td colspan="12" class="text-center text-red">Failed to load user permissions</td></tr>';
        }
    } catch (err) {
        console.error('Error fetching permissions matrix:', err);
        tbody.innerHTML = '<tr><td colspan="12" class="text-center text-red">Server error connecting to user permissions service</td></tr>';
    }
}

function renderMasterPermissionsTable(users) {
    const tbody = document.getElementById('masterPermissionsTableBody');
    if (!tbody) return;

    if (!users || users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="12" class="text-center">No users registered in system</td></tr>';
        return;
    }

    tbody.innerHTML = users.map(u => {
        const isSuper = u.role === 'developer';
        const isAdmin = u.role === 'admin';
        const p = u.permissions || {};

        const chk = (key, disabled = false) => {
            const checked = p[key] ? 'checked' : '';
            const dis = (isSuper || disabled) ? 'disabled style="opacity:0.6; cursor:not-allowed;"' : '';
            return `<input type="checkbox" data-username="${escapeHtml(u.username)}" data-perm="${key}" ${checked} ${dis} style="width:16px; height:16px; accent-color:var(--blue); cursor:pointer;">`;
        };

        const roleBadge = isSuper
            ? '<span class="badge shortlisted">Developer</span>'
            : (isAdmin ? '<span class="badge" style="background:#1E3A8A; color:#FFFFFF;">Admin</span>' : `<span class="badge badge-gray">${escapeHtml(u.role)}</span>`);

        return `
            <tr id="permRow-${escapeHtml(u.username)}">
                <td>
                    <div style="font-weight:700; color:var(--text-primary); font-size:0.9rem;">${escapeHtml(u.name || u.username)}</div>
                    <code style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(u.username)}</code>
                </td>
                <td>${roleBadge}</td>
                <td class="text-center">${chk('can_view_applications')}</td>
                <td class="text-center">${chk('can_edit_applications')}</td>
                <td class="text-center">${chk('can_view_recruitment')}</td>
                <td class="text-center">${chk('can_edit_recruitment')}</td>
                <td class="text-center">${chk('can_edit_workflow')}</td>
                <td class="text-center">${chk('can_view_employees')}</td>
                <td class="text-center">${chk('can_edit_employees')}</td>
                <td class="text-center">${chk('can_assign_tasks')}</td>
                <td class="text-center">${chk('can_edit_settings', !u.can_create_users && !isAdmin)}</td>
                <td style="text-align:right;">
                    ${!isSuper ? `
                        <button type="button" class="btn btn-blue btn-sm" onclick="saveUserPermissions('${escapeHtml(u.username)}')" style="font-weight:600; font-size:0.78rem;">
                            Save Permissions
                        </button>
                    ` : '<span style="font-size:0.75rem; color:var(--text-muted); font-style:italic;">Full Master Control</span>'}
                </td>
            </tr>
        `;
    }).join('');
}

async function saveUserPermissions(username) {
    const row = document.getElementById(`permRow-${username}`);
    if (!row) return;

    const checkboxes = row.querySelectorAll(`input[data-username="${username}"]`);
    const perms = {};
    checkboxes.forEach(cb => {
        const permKey = cb.dataset.perm;
        if (permKey) {
            perms[permKey] = cb.checked;
        }
    });

    try {
        const res = await fetch(`/api/auth/users/${encodeURIComponent(username)}/permissions`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ permissions: perms })
        });
        const data = await res.json();
        if (data.success) {
            showToast(`Permissions updated for ${username}!`, 'success');
            if (currentUser && currentUser.username.toLowerCase() === username.toLowerCase()) {
                currentUser.permissions = perms;
                applyUserClientPermissions();
            }
        } else {
            showToast(`Error: ${data.message || data.detail}`, 'error');
        }
    } catch (err) {
        console.error('Error saving user permissions:', err);
        showToast('Network error saving permissions', 'error');
    }
}

function applyUserClientPermissions() {
    if (!currentUser) return;
    const p = currentUser.permissions || {};
    const isDevOrAdmin = currentUser.role === 'developer' || currentUser.role === 'admin';

    // 1. Navigation visibility based on permissions
    const navRecruitment = document.getElementById('navRecruitment');
    const navApproved = document.getElementById('navApprovedResumes');
    const navPipeline = document.getElementById('navRecruitmentPipeline');
    const navEmployees = document.getElementById('navEmployees');
    const navTasks = document.getElementById('navTasks');
    const navSettings = document.getElementById('navSettings');
    const navAudit = document.getElementById('navAudit');

    if (navRecruitment) {
        if (!isDevOrAdmin && p.can_view_applications === false) navRecruitment.style.display = 'none';
        else navRecruitment.style.display = 'flex';
    }
    if (navApproved) {
        if (!isDevOrAdmin && p.can_view_approved === false) navApproved.style.display = 'none';
        else navApproved.style.display = 'flex';
    }
    if (navPipeline) {
        if (!isDevOrAdmin && p.can_view_recruitment === false) navPipeline.style.display = 'none';
        else navPipeline.style.display = 'flex';
    }
    if (navEmployees) {
        if (!isDevOrAdmin && p.can_view_employees === false) navEmployees.style.display = 'none';
        else navEmployees.style.display = 'flex';
    }
    if (navTasks) {
        if (!isDevOrAdmin && p.can_view_tasks === false) navTasks.style.display = 'none';
        else navTasks.style.display = 'flex';
    }
    if (navSettings) {
        if (!isDevOrAdmin && p.can_view_settings === false && p.can_edit_settings === false) navSettings.style.display = 'none';
        else navSettings.style.display = 'flex';
    }
    if (navAudit) {
        if (!isDevOrAdmin && p.can_view_audit === false) navAudit.style.display = 'none';
        else navAudit.style.display = 'flex';
    }

    // 2. Action buttons
    const openEditWorkflowModalBtn = document.getElementById('openEditWorkflowModalBtn');
    if (openEditWorkflowModalBtn) {
        if (!isDevOrAdmin && p.can_edit_workflow === false) openEditWorkflowModalBtn.style.display = 'none';
        else openEditWorkflowModalBtn.style.display = 'flex';
    }

    const openCreateTaskModalBtn = document.getElementById('openCreateTaskModalBtn');
    if (openCreateTaskModalBtn) {
        if (!isDevOrAdmin && p.can_assign_tasks === false) openCreateTaskModalBtn.style.display = 'none';
        else openCreateTaskModalBtn.style.display = 'flex';
    }

    const openAddEmployeeModalBtn = document.getElementById('openAddEmployeeModalBtn');
    if (openAddEmployeeModalBtn) {
        if (!isDevOrAdmin && p.can_edit_employees === false) openAddEmployeeModalBtn.style.display = 'none';
        else openAddEmployeeModalBtn.style.display = 'flex';
    }
}

// Wire permissions listeners
const refreshPermsTableBtn = document.getElementById('refreshPermsTableBtn');
if (refreshPermsTableBtn) refreshPermsTableBtn.addEventListener('click', fetchMasterPermissionsMatrix);

const openCreateUserFromPermsBtn = document.getElementById('openCreateUserFromPermsBtn');
if (openCreateUserFromPermsBtn) {
    openCreateUserFromPermsBtn.addEventListener('click', () => {
        if (typeof openCreateModal === 'function') openCreateModal();
    });
}

