/**
 * Candidate Application & Document Intake Portal
 * React 18 Implementation
 */

const { useState, useEffect, useRef, useCallback } = React;

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

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

function calculateWorkDuration(startVal, endVal, isCurrent) {
  if (!startVal) return null;
  const [sYear, sMonth] = startVal.split("-").map(Number);
  let eYear, eMonth;

  if (isCurrent) {
    const now = new Date();
    eYear = now.getFullYear();
    eMonth = now.getMonth() + 1;
  } else {
    if (!endVal) return null;
    [eYear, eMonth] = endVal.split("-").map(Number);
  }

  if (eYear < sYear || (eYear === sYear && eMonth < sMonth)) {
    return { error: "End date cannot be earlier than start date" };
  }

  let totalMonths = (eYear - sYear) * 12 + (eMonth - sMonth) + 1;
  if (totalMonths <= 0) totalMonths = 1;

  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;

  const parts = [];
  if (years > 0) parts.push(`${years} yr${years > 1 ? "s" : ""}`);
  if (months > 0) parts.push(`${months} mo${months > 1 ? "s" : ""}`);

  const durationText = parts.length > 0 ? parts.join(" ") : "1 mo";

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const startStr = `${monthNames[sMonth - 1]} ${sYear}`;
  const endStr = isCurrent ? "Present" : `${monthNames[eMonth - 1]} ${eYear}`;

  return {
    durationText,
    fullDisplay: `${startStr} – ${endStr} (${durationText})`,
    startStr,
    endStr,
    totalMonths,
  };
}

const MONTHS = [
  { val: "01", label: "Jan (01)" },
  { val: "02", label: "Feb (02)" },
  { val: "03", label: "Mar (03)" },
  { val: "04", label: "Apr (04)" },
  { val: "05", label: "May (05)" },
  { val: "06", label: "Jun (06)" },
  { val: "07", label: "Jul (07)" },
  { val: "08", label: "Aug (08)" },
  { val: "09", label: "Sep (09)" },
  { val: "10", label: "Oct (10)" },
  { val: "11", label: "Nov (11)" },
  { val: "12", label: "Dec (12)" },
];

const SUBMISSION_STORAGE_KEY = "candidate_application_submission";

function CandidateApplicationApp() {
  // Theme state
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("candidate_form_theme");
    if (saved) return saved;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    localStorage.setItem("candidate_form_theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  // Form Fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [dobDay, setDobDay] = useState("");
  const [dobMonth, setDobMonth] = useState("");
  const [dobYear, setDobYear] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [education, setEducation] = useState("");

  // Experience Fields
  const [isFresher, setIsFresher] = useState(false);
  const [experiences, setExperiences] = useState([
    {
      id: 1,
      role: "",
      company: "",
      startMonth: "",
      startYear: "",
      endMonth: "",
      endYear: "",
      isCurrent: false,
      details: "",
    },
  ]);

  // File Upload
  const [selectedFile, setSelectedFile] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // Status & Error
  const [errorMsg, setErrorMsg] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedRecord, setSubmittedRecord] = useState(null);
  const [isReturningUser, setIsReturningUser] = useState(false);

  const errorRef = useRef(null);

  // Populate Years
  const curYear = new Date().getFullYear();
  const dobYears = [];
  for (let y = curYear - 15; y >= curYear - 75; y--) {
    dobYears.push(y);
  }

  const expYears = [];
  for (let y = curYear; y >= curYear - 35; y--) {
    expYears.push(y);
  }

  // Calculated Age
  const fullDob = dobDay && dobMonth && dobYear ? `${dobYear}-${dobMonth}-${dobDay}` : "";
  const calculatedAge = calculateAge(fullDob);

  // Check existing submission on load
  useEffect(() => {
    try {
      localStorage.removeItem(SUBMISSION_STORAGE_KEY);
    } catch (e) {}

    const checkExisting = () => {
      const raw = sessionStorage.getItem(SUBMISSION_STORAGE_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.id) {
            setSubmittedRecord(parsed);
            setIsReturningUser(true);
            return true;
          }
        } catch (e) {}
      }
      return false;
    };

    checkExisting();

    const handlePageshow = (e) => {
      if (e.persisted) checkExisting();
    };
    const handlePopstate = () => {
      checkExisting();
    };

    window.addEventListener("pageshow", handlePageshow);
    window.addEventListener("popstate", handlePopstate);
    return () => {
      window.removeEventListener("pageshow", handlePageshow);
      window.removeEventListener("popstate", handlePopstate);
    };
  }, []);

  const showError = (msg) => {
    setErrorMsg(msg);
    if (errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  const hideError = () => setErrorMsg("");

  // Experience handlers
  const addExperience = () => {
    setExperiences((prev) => [
      ...prev,
      {
        id: Date.now(),
        role: "",
        company: "",
        startMonth: "",
        startYear: "",
        endMonth: "",
        endYear: "",
        isCurrent: false,
        details: "",
      },
    ]);
  };

  const removeExperience = (id) => {
    setExperiences((prev) => prev.filter((exp) => exp.id !== id));
  };

  const updateExperience = (id, field, value) => {
    setExperiences((prev) =>
      prev.map((exp) => (exp.id === id ? { ...exp, [field]: value } : exp))
    );
  };

  // File handling
  const handleFileSelect = (file) => {
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      showError("Please select an Adobe PDF file (.pdf).");
      return;
    }

    const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
    if (file.size > MAX_FILE_SIZE) {
      showError(
        `The selected file exceeds the 5 MB limit (${formatBytes(file.size)}). Please choose a file smaller than 5 MB.`
      );
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setSelectedFile(file);
    hideError();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const removeFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Submit Handler
  const handleSubmit = async (e) => {
    e.preventDefault();
    hideError();

    if (!fullDob) {
      showError("Please select your complete Date of Birth (Day, Month, and Year).");
      return;
    }

    if (
      !name.trim() ||
      !email.trim() ||
      !phone.trim() ||
      !location.trim() ||
      !education.trim()
    ) {
      showError(
        "Please complete all required fields (Name, Email, Date of Birth, Phone, Location, and Education)."
      );
      return;
    }

    // Validate experiences
    const experienceList = [];
    if (!isFresher) {
      for (const exp of experiences) {
        if (exp.role.trim() || exp.company.trim()) {
          const startDate =
            exp.startYear && exp.startMonth ? `${exp.startYear}-${exp.startMonth}` : "";
          const endDate =
            exp.endYear && exp.endMonth ? `${exp.endYear}-${exp.endMonth}` : "";

          const dur = calculateWorkDuration(startDate, endDate, exp.isCurrent);
          if (dur && dur.error) {
            showError(`Work Experience Error for '${exp.role || exp.company}': ${dur.error}.`);
            return;
          }

          experienceList.push({
            role: exp.role.trim(),
            company: exp.company.trim(),
            start_date: startDate,
            end_date: exp.isCurrent ? "Present" : endDate,
            is_current: exp.isCurrent,
            duration: dur
              ? dur.fullDisplay
              : startDate
              ? `${startDate} – ${exp.isCurrent ? "Present" : endDate}`
              : "",
            duration_text: dur ? dur.durationText : "",
            total_months: dur ? dur.totalMonths : 0,
            details: exp.details.trim(),
          });
        }
      }
    }

    const formData = new FormData();
    formData.append("name", name.trim());
    formData.append("email", email.trim());
    formData.append("dob", fullDob);
    formData.append("location", location.trim());
    formData.append("phone_number", phone.trim());
    formData.append("education", education.trim());
    formData.append("work_experience", JSON.stringify(experienceList));

    if (selectedFile) {
      formData.append("resume", selectedFile);
    }

    setIsSubmitting(true);

    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        body: formData,
      });

      const result = await res.json();

      if (!res.ok || !result.success) {
        throw new Error(result.detail || result.message || "Failed to submit application. Please try again.");
      }

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
        timestamp: rec.timestamp,
      };

      sessionStorage.setItem(SUBMISSION_STORAGE_KEY, JSON.stringify(savedRecord));
      history.pushState({ submitted: true }, "", window.location.href);

      setSubmittedRecord(savedRecord);
      setIsReturningUser(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      showError(err.message || "An error occurred while submitting your application.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApplyAgain = () => {
    sessionStorage.removeItem(SUBMISSION_STORAGE_KEY);
    setSubmittedRecord(null);
    setIsReturningUser(false);
    setName("");
    setEmail("");
    setDobDay("");
    setDobMonth("");
    setDobYear("");
    setPhone("");
    setLocation("");
    setEducation("");
    setIsFresher(false);
    setExperiences([
      {
        id: 1,
        role: "",
        company: "",
        startMonth: "",
        startYear: "",
        endMonth: "",
        endYear: "",
        isCurrent: false,
        details: "",
      },
    ]);
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    hideError();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="page-wrapper">
      <div className="form-container">
        <div className="form-card" id="formCard">
          {/* Header */}
          <header className="card-header">
            <div className="header-top-row">
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <div
                  style={{
                    background: "#ffffff",
                    borderRadius: "6px",
                    padding: "0.25rem 0.6rem",
                    display: "inline-flex",
                    alignItems: "center",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
                  }}
                >
                  <img
                    src="/static/logo.jpg"
                    alt="Milky Mist"
                    style={{ height: "22px", width: "auto", objectFit: "contain", display: "block" }}
                  />
                </div>
                <div className="badge-pill">Careers & Intake</div>
              </div>
              <button
                type="button"
                className="theme-toggle-btn"
                onClick={toggleTheme}
                aria-label="Toggle theme"
                title="Toggle dark/light mode"
              >
                {theme === "dark" ? (
                  <svg
                    className="theme-icon sun-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="5"></circle>
                    <line x1="12" y1="1" x2="12" y2="3"></line>
                    <line x1="12" y1="21" x2="12" y2="23"></line>
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                    <line x1="1" y1="12" x2="3" y2="12"></line>
                    <line x1="21" y1="12" x2="23" y2="12"></line>
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
                  </svg>
                ) : (
                  <svg
                    className="theme-icon moon-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                  </svg>
                )}
              </button>
            </div>
            <h1 className="header-title">Application Form</h1>
            <p className="header-subtitle">
              Please fill in your details and attach your resume. All submissions are reviewed directly by the recruitment team.
            </p>
          </header>

          {/* Error Banner */}
          {errorMsg && (
            <div className="alert alert-error" ref={errorRef} style={{ display: "flex" }}>
              <svg className="alert-icon-svg" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Submitted Screen */}
          {submittedRecord ? (
            <div className="success-screen" style={{ display: "flex" }}>
              <div className="success-icon-wrap">
                <svg className="success-check-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <h2 className="success-title">
                {isReturningUser ? "Application Already Submitted" : "Application Submitted!"}
              </h2>
              <div className="success-badge">Application ID: #{submittedRecord.id}</div>
              <p className="success-message">
                {isReturningUser
                  ? `You have already submitted an application with mobile number ${submittedRecord.phone_number} / email ${submittedRecord.email}. Only 1 application per applicant is permitted.`
                  : `Thank you, ${submittedRecord.name}. Your application has been securely received by our recruitment team.`}
              </p>

              <div className="success-details-card">
                <div className="success-detail-row">
                  <span className="success-detail-label">Full Name</span>
                  <span className="success-detail-val">{submittedRecord.name}</span>
                </div>
                <div className="success-detail-row">
                  <span className="success-detail-label">Email Address</span>
                  <span className="success-detail-val">{submittedRecord.email}</span>
                </div>
                <div className="success-detail-row">
                  <span className="success-detail-label">Age / DOB</span>
                  <span className="success-detail-val">
                    {submittedRecord.age || "—"} ({submittedRecord.dob || "—"})
                  </span>
                </div>
                <div className="success-detail-row">
                  <span className="success-detail-label">Location</span>
                  <span className="success-detail-val">{submittedRecord.location}</span>
                </div>
                <div className="success-detail-row">
                  <span className="success-detail-label">Mobile Number</span>
                  <span className="success-detail-val">{submittedRecord.phone_number}</span>
                </div>
                <div className="success-detail-row">
                  <span className="success-detail-label">Resume Document</span>
                  <span className="success-detail-val">
                    {submittedRecord.resume_filename && submittedRecord.resume_filename !== "None" ? (
                      <span style={{ color: "var(--success)", fontWeight: 600 }}>
                        ✓ Attached ({submittedRecord.resume_filename})
                      </span>
                    ) : (
                      <span style={{ color: "var(--text-light)" }}>Not attached</span>
                    )}
                  </span>
                </div>
                <div className="success-detail-row">
                  <span className="success-detail-label">Review Status</span>
                  <span className="success-detail-val" style={{ color: "var(--accent-blue)" }}>
                    Pending Initial Review
                  </span>
                </div>
                <div
                  style={{
                    marginTop: "1.25rem",
                    paddingTop: "1rem",
                    borderTop: "1px dashed var(--border-color, #e2e8f0)",
                    textAlign: "center",
                  }}
                >
                  <button
                    type="button"
                    onClick={handleApplyAgain}
                    style={{
                      background: "rgba(59, 130, 246, 0.1)",
                      color: "var(--accent-blue, #2563eb)",
                      fontSize: "0.82rem",
                      fontWeight: 500,
                      padding: "0.45rem 1rem",
                      borderRadius: "6px",
                      cursor: "pointer",
                      border: "1px solid rgba(59, 130, 246, 0.3)",
                      transition: "all 0.2s ease",
                    }}
                  >
                    ↺ Apply Again (Testing Mode)
                  </button>
                </div>
              </div>

              <div className="one-app-notice">
                <svg viewBox="0 0 20 20" fill="currentColor" className="notice-icon">
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>
                  Only 1 application per applicant is permitted. If additional details are required, our recruitment team will reach out directly.
                </span>
              </div>
            </div>
          ) : (
            /* Main Form */
            <form className="candidate-form" noValidate onSubmit={handleSubmit}>
              {/* Section 1: Personal Details */}
              <div className="form-section">
                <div className="section-header">
                  <span className="section-number">1</span>
                  <div>
                    <h2 className="section-title">Personal Information</h2>
                    <p className="section-desc">Basic contact and identification details</p>
                  </div>
                </div>

                <div className="field-grid">
                  {/* Full Name */}
                  <div className="field-group">
                    <label htmlFor="fullName">
                      Full Name <span className="req">*</span>
                    </label>
                    <div className="input-wrapper">
                      <input
                        type="text"
                        id="fullName"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Karthik Subramanian"
                        required
                        autoComplete="name"
                      />
                    </div>
                  </div>

                  {/* Email */}
                  <div className="field-group">
                    <label htmlFor="email">
                      Email Address <span className="req">*</span>
                    </label>
                    <div className="input-wrapper">
                      <input
                        type="email"
                        id="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="e.g. karthik.s@gmail.com"
                        required
                        autoComplete="email"
                      />
                    </div>
                  </div>

                  {/* Date of Birth & Live Age */}
                  <div className="field-group">
                    <div className="label-with-action">
                      <label>
                        Date of Birth <span className="req">*</span>
                      </label>
                      {calculatedAge !== null && calculatedAge >= 0 && calculatedAge <= 120 && (
                        <span className="age-pill" style={{ display: "inline-flex" }}>
                          {calculatedAge} years old
                        </span>
                      )}
                    </div>
                    <div className="dob-grid">
                      <select
                        id="dobDay"
                        className="dob-select"
                        aria-label="Day of Birth"
                        value={dobDay}
                        onChange={(e) => setDobDay(e.target.value)}
                      >
                        <option value="" disabled>
                          Day
                        </option>
                        {Array.from({ length: 31 }, (_, i) => {
                          const val = String(i + 1).padStart(2, "0");
                          return (
                            <option key={val} value={val}>
                              {val}
                            </option>
                          );
                        })}
                      </select>

                      <select
                        id="dobMonth"
                        className="dob-select"
                        aria-label="Month of Birth"
                        value={dobMonth}
                        onChange={(e) => setDobMonth(e.target.value)}
                      >
                        <option value="" disabled>
                          Month
                        </option>
                        {MONTHS.map((m) => (
                          <option key={m.val} value={m.val}>
                            {m.label}
                          </option>
                        ))}
                      </select>

                      <select
                        id="dobYear"
                        className="dob-select"
                        aria-label="Year of Birth"
                        value={dobYear}
                        onChange={(e) => setDobYear(e.target.value)}
                      >
                        <option value="" disabled>
                          Year
                        </option>
                        {dobYears.map((y) => (
                          <option key={y} value={String(y)}>
                            {y}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Phone */}
                  <div className="field-group">
                    <label htmlFor="phoneNumber">
                      Phone Number <span className="req">*</span>
                    </label>
                    <div className="input-wrapper">
                      <input
                        type="tel"
                        id="phoneNumber"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="e.g. +91 98401 23456"
                        required
                        autoComplete="tel"
                      />
                    </div>
                  </div>

                  {/* Location */}
                  <div className="field-group col-span-2">
                    <label htmlFor="location">
                      Current Location / City <span className="req">*</span>
                    </label>
                    <div className="input-wrapper">
                      <input
                        type="text"
                        id="location"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        placeholder="e.g. Chennai, Tamil Nadu (or Coimbatore, Madurai)"
                        required
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 2: Education */}
              <div className="form-section">
                <div className="section-header">
                  <span className="section-number">2</span>
                  <div>
                    <h2 className="section-title">Education & Qualifications</h2>
                    <p className="section-desc">Highest degree, institutions, major, and graduation year</p>
                  </div>
                </div>

                <div className="field-group">
                  <label htmlFor="educationText">
                    Education Details <span className="req">*</span>
                  </label>
                  <div className="input-wrapper">
                    <textarea
                      id="educationText"
                      rows="3"
                      value={education}
                      onChange={(e) => setEducation(e.target.value)}
                      placeholder={`e.g. B.E. Computer Science - CEG Anna University, Chennai (2024)\nCGPA: 8.7 / 10, First Class with Distinction`}
                      required
                    />
                  </div>
                  <span className="field-hint">
                    Specify your degree, college or university (e.g. Anna University, PSG Tech, SSN, NIT Trichy), passing year, and CGPA.
                  </span>
                </div>
              </div>

              {/* Section 3: Work Experience */}
              <div className="form-section">
                <div className="section-header">
                  <span className="section-number">3</span>
                  <div className="section-header-content">
                    <div>
                      <h2 className="section-title">Work Experience</h2>
                      <p className="section-desc">Your professional roles, internships, or projects</p>
                    </div>
                    <label className="toggle-fresher" htmlFor="fresherCheckbox">
                      <input
                        type="checkbox"
                        id="fresherCheckbox"
                        checked={isFresher}
                        onChange={(e) => setIsFresher(e.target.checked)}
                      />
                      <span className="toggle-switch"></span>
                      <span className="toggle-label">Fresher / No prior experience</span>
                    </label>
                  </div>
                </div>

                {!isFresher && (
                  <div id="experienceWrapper">
                    <div className="exp-entries-list">
                      {experiences.map((exp, idx) => {
                        const startDate =
                          exp.startYear && exp.startMonth ? `${exp.startYear}-${exp.startMonth}` : "";
                        const endDate =
                          exp.endYear && exp.endMonth ? `${exp.endYear}-${exp.endMonth}` : "";
                        const dur = calculateWorkDuration(startDate, endDate, exp.isCurrent);

                        return (
                          <div className="exp-card" key={exp.id}>
                            <div className="exp-card-header">
                              <span className="exp-card-title">Position #{idx + 1}</span>
                              {experiences.length > 1 && (
                                <button
                                  type="button"
                                  className="btn-remove-exp"
                                  onClick={() => removeExperience(exp.id)}
                                >
                                  ✕ Remove
                                </button>
                              )}
                            </div>
                            <div className="field-grid">
                              <div className="field-group">
                                <label>
                                  Job Title / Role <span className="req">*</span>
                                </label>
                                <input
                                  type="text"
                                  className="exp-role"
                                  placeholder="e.g. Full Stack Developer"
                                  value={exp.role}
                                  onChange={(e) => updateExperience(exp.id, "role", e.target.value)}
                                />
                              </div>
                              <div className="field-group">
                                <label>
                                  Company / Organization <span className="req">*</span>
                                </label>
                                <input
                                  type="text"
                                  className="exp-company"
                                  placeholder="e.g. Zoho Corporation, Chennai"
                                  value={exp.company}
                                  onChange={(e) => updateExperience(exp.id, "company", e.target.value)}
                                />
                              </div>
                              <div className="field-group">
                                <label>
                                  Start Month & Year <span className="req">*</span>
                                </label>
                                <div className="exp-date-grid">
                                  <select
                                    className="exp-start-month exp-select"
                                    value={exp.startMonth}
                                    onChange={(e) => updateExperience(exp.id, "startMonth", e.target.value)}
                                  >
                                    <option value="" disabled>
                                      Month
                                    </option>
                                    {MONTHS.map((m) => (
                                      <option key={m.val} value={m.val}>
                                        {m.val} - {m.label.split(" ")[0]}
                                      </option>
                                    ))}
                                  </select>
                                  <select
                                    className="exp-start-year exp-select"
                                    value={exp.startYear}
                                    onChange={(e) => updateExperience(exp.id, "startYear", e.target.value)}
                                  >
                                    <option value="" disabled>
                                      Year
                                    </option>
                                    {expYears.map((y) => (
                                      <option key={y} value={String(y)}>
                                        {y}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                              <div className="field-group">
                                <div className="label-with-action">
                                  <label>
                                    End Month & Year <span className="req">*</span>
                                  </label>
                                  {dur && (
                                    <span
                                      className={`duration-pill ${
                                        dur.error ? "duration-invalid" : "duration-valid"
                                      }`}
                                      style={{ display: "inline-flex" }}
                                    >
                                      {dur.error ? dur.error : `⏳ ${dur.durationText}`}
                                    </span>
                                  )}
                                </div>
                                <div className="exp-date-grid">
                                  <select
                                    className="exp-end-month exp-select"
                                    disabled={exp.isCurrent}
                                    value={exp.isCurrent ? "" : exp.endMonth}
                                    onChange={(e) => updateExperience(exp.id, "endMonth", e.target.value)}
                                  >
                                    <option value="" disabled>
                                      Month
                                    </option>
                                    {MONTHS.map((m) => (
                                      <option key={m.val} value={m.val}>
                                        {m.val} - {m.label.split(" ")[0]}
                                      </option>
                                    ))}
                                  </select>
                                  <select
                                    className="exp-end-year exp-select"
                                    disabled={exp.isCurrent}
                                    value={exp.isCurrent ? "" : exp.endYear}
                                    onChange={(e) => updateExperience(exp.id, "endYear", e.target.value)}
                                  >
                                    <option value="" disabled>
                                      Year
                                    </option>
                                    {expYears.map((y) => (
                                      <option key={y} value={String(y)}>
                                        {y}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                              <div className="field-group col-span-2">
                                <label className="checkbox-current">
                                  <input
                                    type="checkbox"
                                    checked={exp.isCurrent}
                                    onChange={(e) => updateExperience(exp.id, "isCurrent", e.target.checked)}
                                  />
                                  <span>Currently working in this role (Present)</span>
                                </label>
                              </div>
                              <div className="field-group col-span-2">
                                <label>Key Responsibilities & Highlights</label>
                                <textarea
                                  className="exp-details"
                                  rows="2"
                                  placeholder="e.g. Developed scalable backend services and optimized database queries..."
                                  value={exp.details}
                                  onChange={(e) => updateExperience(exp.id, "details", e.target.value)}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <button type="button" className="btn-add-experience" onClick={addExperience}>
                      <svg className="btn-icon" viewBox="0 0 20 20" fill="currentColor">
                        <path
                          fillRule="evenodd"
                          d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <span>Add Another Position</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Section 4: Resume Upload */}
              <div className="form-section">
                <div className="section-header">
                  <span className="section-number">4</span>
                  <div className="section-header-content">
                    <div>
                      <h2 className="section-title">Resume / CV Attachment</h2>
                      <p className="section-desc">Upload your resume document in PDF format</p>
                    </div>
                    <span className="file-limit-tag">PDF only • Max 5 MB</span>
                  </div>
                </div>

                <div className="field-group">
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept=".pdf,application/pdf"
                    hidden
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        handleFileSelect(e.target.files[0]);
                      }
                    }}
                  />

                  {!selectedFile ? (
                    <div
                      className={`resume-dropzone ${isDragOver ? "dragover" : ""}`}
                      onClick={() => fileInputRef.current && fileInputRef.current.click()}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                    >
                      <div className="dropzone-content">
                        <div className="dropzone-icon-wrap">
                          <svg
                            className="dropzone-icon"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                          >
                            <path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                          </svg>
                        </div>
                        <div className="dropzone-text">
                          <span className="dropzone-action">Click to upload</span> or drag and drop your PDF here
                        </div>
                        <p className="dropzone-sub">Adobe PDF (.pdf) • Maximum file size 5 MB</p>
                      </div>
                    </div>
                  ) : (
                    <div className="file-card" style={{ display: "flex" }}>
                      <div className="file-card-left">
                        <div className="file-type-badge">PDF</div>
                        <div className="file-meta">
                          <span className="file-name">{selectedFile.name}</span>
                          <span className="file-size">{formatBytes(selectedFile.size)}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn-remove-file"
                        onClick={removeFile}
                        title="Remove resume"
                      >
                        <svg viewBox="0 0 20 20" fill="currentColor">
                          <path
                            fillRule="evenodd"
                            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Submit Action */}
              <div className="form-footer">
                <button type="submit" className="btn-submit" disabled={isSubmitting}>
                  <span>{isSubmitting ? "Submitting Application..." : "Submit Application"}</span>
                  {!isSubmitting ? (
                    <svg className="submit-arrow" viewBox="0 0 20 20" fill="currentColor">
                      <path
                        fillRule="evenodd"
                        d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z"
                        clipRule="evenodd"
                      />
                    </svg>
                  ) : (
                    <div className="spinner" style={{ display: "inline-block" }}></div>
                  )}
                </button>
                <p className="privacy-note">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="lock-icon">
                    <path
                      fillRule="evenodd"
                      d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Your personal information is stored securely and processed confidentially for recruitment.
                </p>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// Mount React Root
const rootElement = document.getElementById("root");
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<CandidateApplicationApp />);
}
