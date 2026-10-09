/**
 * Candidate Application & Document Intake Portal
 * Client-side Controller
 */

document.addEventListener("DOMContentLoaded", () => {
  // Form Elements
  const form = document.getElementById("candidateForm");
  const fullNameInput = document.getElementById("fullName");
  const emailInput = document.getElementById("email");
  const dobInput = document.getElementById("dob");
  const dobDay = document.getElementById("dobDay");
  const dobMonth = document.getElementById("dobMonth");
  const dobYear = document.getElementById("dobYear");
  const ageBadge = document.getElementById("ageBadge");
  const phoneInput = document.getElementById("phoneNumber");
  const locationInput = document.getElementById("location");
  const educationTextInput = document.getElementById("educationText");

  // Experience Elements
  const fresherCheckbox = document.getElementById("fresherCheckbox");
  const experienceWrapper = document.getElementById("experienceWrapper");
  const experienceContainer = document.getElementById("experienceContainer");
  const addExperienceBtn = document.getElementById("addExperienceBtn");

  // File Upload Elements
  const dropZone = document.getElementById("dropZone");
  const resumeInput = document.getElementById("resumeInput");
  const fileStatusBar = document.getElementById("fileStatusBar");
  const fileName = document.getElementById("fileName");
  const fileSize = document.getElementById("fileSize");
  const removeFileBtn = document.getElementById("removeFileBtn");

  // Submit & State Elements
  const submitBtn = document.getElementById("submitBtn");
  const submitBtnText = document.getElementById("submitBtnText");
  const submitArrow = document.getElementById("submitArrow");
  const submitSpinner = document.getElementById("submitSpinner");
  
  const errorBanner = document.getElementById("errorBanner");
  const errorMessageText = document.getElementById("errorMessageText");
  
  const successBanner = document.getElementById("successBanner");
  const successTitle = document.getElementById("successTitle");
  const successAppIdBadge = document.getElementById("successAppIdBadge");
  const successMessage = document.getElementById("successMessage");
  const successDetailsCard = document.getElementById("successDetailsCard");
  const themeToggleBtn = document.getElementById("themeToggleBtn");

  let selectedResumeFile = null;

  // ----------------------------------------------------
  // 0. Theme Toggle (Dark / Light)
  // ----------------------------------------------------
  function getPreferredTheme() {
    const saved = localStorage.getItem("candidate_form_theme");
    if (saved) return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme(theme) {
    if (theme === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    localStorage.setItem("candidate_form_theme", theme);
  }

  // Apply on load
  applyTheme(getPreferredTheme());

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
      const next = current === "dark" ? "light" : "dark";
      applyTheme(next);
    });
  }

  // ----------------------------------------------------
  // 1. Easy Date of Birth & Live Age Calculation
  // ----------------------------------------------------
  function populateDobDropdowns() {
    if (dobDay) {
      dobDay.innerHTML = '<option value="" disabled selected>Day</option>';
      for (let d = 1; d <= 31; d++) {
        const val = String(d).padStart(2, '0');
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = val;
        dobDay.appendChild(opt);
      }
    }

    if (dobYear) {
      const curYear = new Date().getFullYear();
      dobYear.innerHTML = '<option value="" disabled selected>Year</option>';
      for (let y = curYear - 15; y >= curYear - 75; y--) {
        const opt = document.createElement("option");
        opt.value = String(y);
        opt.textContent = String(y);
        dobYear.appendChild(opt);
      }
    }
  }

  populateDobDropdowns();

  function calculateAge(dobValue) {
    if (!dobValue) return null;
    const dob = new Date(dobValue);
    if (isNaN(dob.getTime())) return null;

    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    const dayDiff = today.getDate() - dob.getDate();

    if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
      age--;
    }
    return age;
  }

  function updateDobAndAge() {
    const d = dobDay ? dobDay.value : "";
    const m = dobMonth ? dobMonth.value : "";
    const y = dobYear ? dobYear.value : "";

    if (d && m && y) {
      const formatted = `${y}-${m}-${d}`;
      dobInput.value = formatted;
      const age = calculateAge(formatted);
      if (age !== null && age >= 0 && age <= 120) {
        ageBadge.textContent = `${age} years old`;
        ageBadge.style.display = "inline-flex";
      } else {
        ageBadge.style.display = "none";
      }
    } else {
      dobInput.value = "";
      ageBadge.style.display = "none";
    }
  }

  if (dobDay) dobDay.addEventListener("change", updateDobAndAge);
  if (dobMonth) dobMonth.addEventListener("change", updateDobAndAge);
  if (dobYear) dobYear.addEventListener("change", updateDobAndAge);

  // ----------------------------------------------------
  // 2. Work Experience Dynamic Positions & Duration Calculation
  // ----------------------------------------------------
  let expCounter = 0;

  function calculateWorkDuration(startVal, endVal, isCurrent) {
    if (!startVal) return null;
    const [sYear, sMonth] = startVal.split("-").map(Number);
    let eYear, eMonth;

    if (isCurrent) {
      const now = new Date();
      eYear = now.getFullYear();
      eMonth = now.getMonth() + 1; // 1-indexed
    } else {
      if (!endVal) return null;
      [eYear, eMonth] = endVal.split("-").map(Number);
    }

    if (eYear < sYear || (eYear === sYear && eMonth < sMonth)) {
      return { error: "End date cannot be earlier than start date" };
    }

    // Total months count (inclusive of starting and ending months)
    let totalMonths = (eYear - sYear) * 12 + (eMonth - sMonth) + 1;
    if (totalMonths <= 0) totalMonths = 1;

    const years = Math.floor(totalMonths / 12);
    const months = totalMonths % 12;

    const parts = [];
    if (years > 0) parts.push(`${years} yr${years > 1 ? 's' : ''}`);
    if (months > 0) parts.push(`${months} mo${months > 1 ? 's' : ''}`);

    const durationText = parts.length > 0 ? parts.join(" ") : "1 mo";

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const startStr = `${monthNames[sMonth - 1]} ${sYear}`;
    const endStr = isCurrent ? "Present" : `${monthNames[eMonth - 1]} ${eYear}`;

    return {
      durationText,
      fullDisplay: `${startStr} – ${endStr} (${durationText})`,
      startStr,
      endStr,
      totalMonths
    };
  }

  const monthOptionsHtml = `
    <option value="" disabled selected>Month</option>
    <option value="01">Jan</option>
    <option value="02">Feb</option>
    <option value="03">Mar</option>
    <option value="04">Apr</option>
    <option value="05">May</option>
    <option value="06">Jun</option>
    <option value="07">Jul</option>
    <option value="08">Aug</option>
    <option value="09">Sep</option>
    <option value="10">Oct</option>
    <option value="11">Nov</option>
    <option value="12">Dec</option>
  `;

  function getExpYearOptionsHtml() {
    const curYear = new Date().getFullYear();
    let opts = '<option value="" disabled selected>Year</option>';
    for (let y = curYear; y >= curYear - 35; y--) {
      opts += `<option value="${y}">${y}</option>`;
    }
    return opts;
  }

  function createExperienceCard(data = {}) {
    expCounter++;
    const card = document.createElement("div");
    card.className = "exp-card";
    card.dataset.index = expCounter;

    card.innerHTML = `
      <div class="exp-card-header">
        <span class="exp-card-title">Position #${expCounter}</span>
        <button type="button" class="btn-remove-exp" style="display: none;">✕ Remove</button>
      </div>
      <div class="field-grid">
        <div class="field-group">
          <label>Job Title / Role <span class="req">*</span></label>
          <input type="text" class="exp-role" placeholder="e.g. Full Stack Developer" value="${escapeHtml(data.role || '')}" />
        </div>
        <div class="field-group">
          <label>Company / Organization <span class="req">*</span></label>
          <input type="text" class="exp-company" placeholder="e.g. Zoho Corporation, Chennai" value="${escapeHtml(data.company || '')}" />
        </div>
        <div class="field-group">
          <label>Start Month & Year <span class="req">*</span></label>
          <div class="exp-date-grid">
            <select class="exp-start-month exp-select">${monthOptionsHtml}</select>
            <select class="exp-start-year exp-select">${getExpYearOptionsHtml()}</select>
          </div>
          <input type="hidden" class="exp-start-date" value="${escapeHtml(data.start_date || '')}" />
        </div>
        <div class="field-group">
          <div class="label-with-action">
            <label>End Month & Year <span class="req">*</span></label>
            <span class="duration-pill" style="display: none;"></span>
          </div>
          <div class="exp-date-grid">
            <select class="exp-end-month exp-select">${monthOptionsHtml}</select>
            <select class="exp-end-year exp-select">${getExpYearOptionsHtml()}</select>
          </div>
          <input type="hidden" class="exp-end-date" value="${escapeHtml(data.end_date || '')}" />
        </div>
        <div class="field-group col-span-2">
          <label class="checkbox-current">
            <input type="checkbox" class="exp-is-current" ${data.is_current ? 'checked' : ''} />
            <span>Currently working in this role (Present)</span>
          </label>
        </div>
        <div class="field-group col-span-2">
          <label>Key Responsibilities & Highlights</label>
          <textarea class="exp-details" rows="2" placeholder="e.g. Developed scalable backend services and optimized database queries...">${escapeHtml(data.details || '')}</textarea>
        </div>
      </div>
    `;

    const startMonth = card.querySelector(".exp-start-month");
    const startYear = card.querySelector(".exp-start-year");
    const startInput = card.querySelector(".exp-start-date");

    const endMonth = card.querySelector(".exp-end-month");
    const endYear = card.querySelector(".exp-end-year");
    const endInput = card.querySelector(".exp-end-date");

    const currentCheckbox = card.querySelector(".exp-is-current");
    const durationPill = card.querySelector(".duration-pill");

    function updateCardDuration() {
      const isCurrent = currentCheckbox.checked;
      if (isCurrent) {
        endMonth.disabled = true;
        endYear.disabled = true;
        endMonth.value = "";
        endYear.value = "";
        endInput.value = "";
      } else {
        endMonth.disabled = false;
        endYear.disabled = false;
        if (endMonth.value && endYear.value) {
          endInput.value = `${endYear.value}-${endMonth.value}`;
        } else {
          endInput.value = "";
        }
      }

      if (startMonth.value && startYear.value) {
        startInput.value = `${startYear.value}-${startMonth.value}`;
      } else {
        startInput.value = "";
      }

      const res = calculateWorkDuration(startInput.value, endInput.value, isCurrent);
      if (!res) {
        durationPill.style.display = "none";
        return;
      }

      if (res.error) {
        durationPill.textContent = res.error;
        durationPill.className = "duration-pill duration-invalid";
        durationPill.style.display = "inline-flex";
      } else {
        durationPill.textContent = `⏳ ${res.durationText}`;
        durationPill.className = "duration-pill duration-valid";
        durationPill.style.display = "inline-flex";
      }
    }

    startMonth.addEventListener("change", updateCardDuration);
    startYear.addEventListener("change", updateCardDuration);
    endMonth.addEventListener("change", updateCardDuration);
    endYear.addEventListener("change", updateCardDuration);
    currentCheckbox.addEventListener("change", updateCardDuration);

    if (data.start_date && data.start_date.includes("-")) {
      const [sy, sm] = data.start_date.split("-");
      startYear.value = sy;
      startMonth.value = sm.padStart(2, '0');
    }
    if (data.end_date && data.end_date.includes("-")) {
      const [ey, em] = data.end_date.split("-");
      endYear.value = ey;
      endMonth.value = em.padStart(2, '0');
    }

    // Initial check if editing
    if (data.start_date) {
      updateCardDuration();
    }

    const removeBtn = card.querySelector(".btn-remove-exp");
    removeBtn.addEventListener("click", () => {
      const allCards = experienceContainer.querySelectorAll(".exp-card");
      if (allCards.length > 1) {
        card.remove();
        updateExpCardHeaders();
      }
    });

    return card;
  }

  function updateExpCardHeaders() {
    const allCards = experienceContainer.querySelectorAll(".exp-card");
    allCards.forEach((c, idx) => {
      const title = c.querySelector(".exp-card-title");
      const removeBtn = c.querySelector(".btn-remove-exp");
      if (title) title.textContent = `Position #${idx + 1}`;
      if (removeBtn) {
        removeBtn.style.display = allCards.length > 1 ? "inline-block" : "none";
      }
    });
  }

  addExperienceBtn.addEventListener("click", () => {
    const card = createExperienceCard();
    experienceContainer.appendChild(card);
    updateExpCardHeaders();
    card.querySelector(".exp-role")?.focus();
  });

  // Render initial 1 position
  experienceContainer.appendChild(createExperienceCard());
  updateExpCardHeaders();

  // Fresher toggle
  fresherCheckbox.addEventListener("change", (e) => {
    if (e.target.checked) {
      experienceWrapper.style.display = "none";
    } else {
      experienceWrapper.style.display = "block";
    }
  });

  // ----------------------------------------------------
  // 3. Resume PDF Attachment Handling
  // ----------------------------------------------------
  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  }

  function handleFile(file) {
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      showError("Please select an Adobe PDF file (.pdf).");
      return;
    }

    const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
    if (file.size > MAX_FILE_SIZE) {
      showError(`The selected file exceeds the 5 MB limit (${formatBytes(file.size)}). Please choose a file smaller than 5 MB.`);
      resumeInput.value = "";
      selectedResumeFile = null;
      return;
    }

    selectedResumeFile = file;
    fileName.textContent = file.name;
    fileSize.textContent = formatBytes(file.size);
    fileStatusBar.style.display = "flex";
    dropZone.style.display = "none";
    hideError();
  }

  dropZone.addEventListener("click", () => resumeInput.click());

  resumeInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  });

  ["dragenter", "dragover"].forEach(evt => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach(evt => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.remove("dragover");
    });
  });

  dropZone.addEventListener("drop", (e) => {
    if (e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  removeFileBtn.addEventListener("click", () => {
    selectedResumeFile = null;
    resumeInput.value = "";
    fileStatusBar.style.display = "none";
    dropZone.style.display = "block";
  });

  // ----------------------------------------------------
  // 4. Alert Helpers
  // ----------------------------------------------------
  function showError(msg) {
    errorMessageText.textContent = msg;
    errorBanner.style.display = "flex";
    errorBanner.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function hideError() {
    errorMessageText.textContent = "";
    errorBanner.style.display = "none";
  }

  const SUBMISSION_STORAGE_KEY = "candidate_application_submission";

  // Clean up any stale localStorage lock so reopening tab allows applying
  try {
    localStorage.removeItem(SUBMISSION_STORAGE_KEY);
  } catch (e) {}

  function showSubmittedScreen(rec, isReturning = false) {
    if (!rec) return;
    form.style.display = "none";
    successBanner.style.display = "flex";

    if (isReturning) {
      successTitle.textContent = "Application Already Submitted";
      successMessage.textContent = `You have already submitted an application with mobile number ${escapeHtml(rec.phone_number || '')} / email ${escapeHtml(rec.email || '')}. Only 1 application per applicant is permitted.`;
    } else {
      successTitle.textContent = "Application Submitted!";
      successMessage.textContent = `Thank you, ${escapeHtml(rec.name || '')}. Your application has been securely received by our recruitment team.`;
    }

    successAppIdBadge.textContent = `Application ID: #${escapeHtml(rec.id || '')}`;

    const resumeStatus = rec.resume_filename && rec.resume_filename !== "None"
      ? `<span style="color:var(--success); font-weight:600;">✓ Attached (${escapeHtml(rec.resume_filename)})</span>`
      : `<span style="color:var(--text-light);">Not attached</span>`;

    successDetailsCard.innerHTML = `
      <div class="success-detail-row">
        <span class="success-detail-label">Full Name</span>
        <span class="success-detail-val">${escapeHtml(rec.name || '')}</span>
      </div>
      <div class="success-detail-row">
        <span class="success-detail-label">Email Address</span>
        <span class="success-detail-val">${escapeHtml(rec.email || '')}</span>
      </div>
      <div class="success-detail-row">
        <span class="success-detail-label">Age / DOB</span>
        <span class="success-detail-val">${escapeHtml(rec.age || '—')} (${escapeHtml(rec.dob || '—')})</span>
      </div>
      <div class="success-detail-row">
        <span class="success-detail-label">Location</span>
        <span class="success-detail-val">${escapeHtml(rec.location || '')}</span>
      </div>
      <div class="success-detail-row">
        <span class="success-detail-label">Mobile Number</span>
        <span class="success-detail-val">${escapeHtml(rec.phone_number || '')}</span>
      </div>
      <div class="success-detail-row">
        <span class="success-detail-label">Resume Document</span>
        <span class="success-detail-val">${resumeStatus}</span>
      </div>
      <div class="success-detail-row">
        <span class="success-detail-label">Review Status</span>
        <span class="success-detail-val" style="color:var(--accent-blue);">Pending Initial Review</span>
      </div>
      <div style="margin-top: 1.25rem; padding-top: 1rem; border-top: 1px dashed var(--border-color, #e2e8f0); text-align: center;">
        <button type="button" id="applyAgainTestBtn" style="background: rgba(59, 130, 246, 0.1); color: var(--accent-blue, #2563eb); font-size: 0.82rem; font-weight: 500; padding: 0.45rem 1rem; border-radius: 6px; cursor: pointer; border: 1px solid rgba(59, 130, 246, 0.3); transition: all 0.2s ease;">
          ↺ Apply Again (Testing Mode)
        </button>
      </div>
    `;

    const applyAgainBtn = document.getElementById("applyAgainTestBtn");
    if (applyAgainBtn) {
      applyAgainBtn.addEventListener("click", () => {
        sessionStorage.removeItem(SUBMISSION_STORAGE_KEY);
        form.reset();
        selectedResumeFile = null;
        if (fileStatusBar) fileStatusBar.style.display = "none";
        if (dropZone) dropZone.style.display = "block";
        form.style.display = "block";
        successBanner.style.display = "none";
        hideError();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function checkExistingSubmission() {
    const raw = sessionStorage.getItem(SUBMISSION_STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.id) {
          showSubmittedScreen(parsed, true);
          return true;
        }
      } catch (e) {
        console.error("Error reading saved submission state:", e);
      }
    }
    return false;
  }

  // Intercept back-arrow / history traversal in this tab
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) {
      checkExistingSubmission();
    }
  });

  window.addEventListener("popstate", () => {
    checkExistingSubmission();
  });

  // ----------------------------------------------------
  // 5. Form Submission (POST /api/submit)
  // ----------------------------------------------------
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideError();

    // Check if user already submitted on this browser
    if (checkExistingSubmission()) {
      return;
    }

    const name = fullNameInput.value.trim();
    const email = emailInput.value.trim();
    const dob = dobInput.value.trim();
    const phone = phoneInput.value.trim();
    const location = locationInput.value.trim();
    const education = educationTextInput.value.trim();

    if (!dob) {
      showError("Please select your complete Date of Birth (Day, Month, and Year).");
      if (dobDay) dobDay.focus();
      return;
    }

    if (!name || !email || !phone || !location || !education) {
      showError("Please complete all required fields (Name, Email, Date of Birth, Phone, Location, and Education).");
      return;
    }

    // Collect Work Experience entries
    const experienceList = [];
    if (!fresherCheckbox.checked) {
      const expCards = experienceContainer.querySelectorAll(".exp-card");
      for (const card of expCards) {
        const role = card.querySelector(".exp-role")?.value.trim() || "";
        const company = card.querySelector(".exp-company")?.value.trim() || "";
        const startDate = card.querySelector(".exp-start-date")?.value.trim() || "";
        const endDate = card.querySelector(".exp-end-date")?.value.trim() || "";
        const isCurrent = card.querySelector(".exp-is-current")?.checked || false;
        const details = card.querySelector(".exp-details")?.value.trim() || "";

        if (role || company) {
          const dur = calculateWorkDuration(startDate, endDate, isCurrent);
          if (dur && dur.error) {
            showError(`Work Experience Error for '${role || company}': ${dur.error}.`);
            return;
          }

          experienceList.push({
            role: role,
            company: company,
            start_date: startDate,
            end_date: isCurrent ? "Present" : endDate,
            is_current: isCurrent,
            duration: dur ? dur.fullDisplay : (startDate ? `${startDate} – ${isCurrent ? 'Present' : endDate}` : ""),
            duration_text: dur ? dur.durationText : "",
            total_months: dur ? dur.totalMonths : 0,
            details: details
          });
        }
      }
    }

    const formData = new FormData();
    formData.append("name", name);
    formData.append("email", email);
    formData.append("dob", dob);
    formData.append("location", location);
    formData.append("phone_number", phone);
    formData.append("education", education);
    formData.append("work_experience", JSON.stringify(experienceList));

    if (selectedResumeFile) {
      formData.append("resume", selectedResumeFile);
    }

    // Button loading state
    submitBtn.disabled = true;
    submitBtnText.textContent = "Submitting Application...";
    if (submitArrow) submitArrow.style.display = "none";
    submitSpinner.style.display = "inline-block";

    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        body: formData
      });

      const result = await res.json();

      if (!res.ok || !result.success) {
        throw new Error(result.detail || result.message || "Failed to submit application. Please try again.");
      }

      // Success screen presentation & local storage persistence
      const rec = result.data;
      const savedRecord = {
        id: rec.id,
        name: rec.name,
        email: rec.email,
        age: rec.age,
        dob: rec.dob,
        location: rec.location,
        phone_number: rec.phone_number,
        resume_filename: rec.resume_filename,
        timestamp: rec.timestamp
      };
      sessionStorage.setItem(SUBMISSION_STORAGE_KEY, JSON.stringify(savedRecord));

      // Push history state so back button stays on submitted screen
      history.pushState({ submitted: true }, "", window.location.href);

      showSubmittedScreen(savedRecord, false);

    } catch (err) {
      showError(err.message || "An error occurred while submitting your application.");
    } finally {
      submitBtn.disabled = false;
      submitBtnText.textContent = "Submit Application";
      if (submitArrow) submitArrow.style.display = "inline-block";
      submitSpinner.style.display = "none";
    }
  });

  function escapeHtml(text) {
    if (!text) return "";
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
});
