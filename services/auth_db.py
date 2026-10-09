"""
Authentication and User Management Service for Milky Mist HR Portal.
Database: users.db (SQLite)
Default users:
- dev123 / 123456 (can_create_users = 1)
- admin123 / 123456 (can_create_users = 1)
"""

import os
import json
import sqlite3
import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List, Tuple

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUTH_DB_PATH = os.path.join(BASE_DIR, "users.db")


def get_auth_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(AUTH_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def hash_password(password: str, salt: Optional[str] = None) -> Tuple[str, str]:
    if not salt:
        salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100000)
    return key.hex(), salt


def verify_password(password: str, salt: str, password_hash: str) -> bool:
    expected_hash, _ = hash_password(password, salt)
    return secrets.compare_digest(expected_hash, password_hash)


def init_auth_db():
    conn = get_auth_connection()
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                name TEXT NOT NULL,
                role TEXT NOT NULL,
                can_create_users INTEGER DEFAULT 0,
                permissions TEXT DEFAULT '',
                created_at TEXT NOT NULL
            )
            """
        )

        # Check and migrate permissions column if missing
        cols = [c[1] for c in conn.execute("PRAGMA table_info(users)").fetchall()]
        if "permissions" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT ''")

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                username TEXT NOT NULL COLLATE NOCASE,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            )
            """
        )
        conn.commit()

        # Seed initial accounts
        default_accounts = [
            ("dev123", "123456", "Developer", "developer", 1),
            ("admin123", "123456", "HR Administrator", "admin", 1),
            ("test123", "123456", "Test User", "staff", 0),
        ]

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        for uname, pwd, full_name, role_name, can_create in default_accounts:
            existing = conn.execute("SELECT id FROM users WHERE username = ?", (uname,)).fetchone()
            if not existing:
                pwd_hash, salt = hash_password(pwd)
                conn.execute(
                    """
                    INSERT INTO users (username, password_hash, salt, name, role, can_create_users, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (uname, pwd_hash, salt, full_name, role_name, can_create, now_str),
                )
            else:
                # Ensure can_create_users permission is set appropriately
                conn.execute(
                    "UPDATE users SET can_create_users = ? WHERE username = ?",
                    (can_create, uname),
                )

        # Tasks & Reminders Tables
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_by TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT DEFAULT '',
                due_date TEXT DEFAULT '',
                priority TEXT DEFAULT 'medium',
                assigned_type TEXT NOT NULL,
                target_usernames TEXT DEFAULT '',
                created_at TEXT NOT NULL
            )
            """
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS task_notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                username TEXT NOT NULL COLLATE NOCASE,
                is_read INTEGER DEFAULT 0,
                is_completed INTEGER DEFAULT 0,
                completed_at TEXT DEFAULT '',
                assigned_at TEXT NOT NULL
            )
            """
        )

        # Employees Directory Table
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS employees (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                emp_id TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                phone TEXT DEFAULT '',
                department TEXT NOT NULL,
                designation TEXT NOT NULL,
                joining_date TEXT DEFAULT '',
                employment_type TEXT DEFAULT 'Permanent',
                status TEXT DEFAULT 'Active',
                location TEXT DEFAULT 'Perundurai Mega Plant (HQ)',
                candidate_app_id TEXT DEFAULT '',
                created_at TEXT NOT NULL
            )
            """
        )

        emp_count = conn.execute("SELECT COUNT(*) as cnt FROM employees").fetchone()["cnt"]
        if emp_count == 0:
            initial_employees = [
                ("MM-EMP-101", "R. Senthil Kumar", "senthil.k@milkymist.com", "+91 98421 11022", "Dairy Processing & Production", "Senior Dairy Technologist", "2023-04-15", "Permanent", "Active", "Perundurai Mega Plant (HQ)"),
                ("MM-EMP-102", "Ananya Raman", "ananya.r@milkymist.com", "+91 98422 22033", "Quality Assurance & Food Safety", "Quality Assurance Lead", "2023-06-10", "Permanent", "Active", "Perundurai Mega Plant (HQ)"),
                ("MM-EMP-103", "Karthik Natarajan", "karthik.n@milkymist.com", "+91 98423 33044", "Supply Chain & Logistics", "Logistics & Fleet Manager", "2023-08-01", "Permanent", "Active", "Perundurai Mega Plant (HQ)"),
                ("MM-EMP-104", "Meera Krishnan", "meera.k@milkymist.com", "+91 98424 44055", "Human Resources", "Senior HR Officer", "2023-11-20", "Permanent", "Active", "Perundurai Mega Plant (HQ)"),
                ("MM-EMP-105", "Vigneshwaran S.", "vignesh.s@milkymist.com", "+91 98425 55066", "Sales & Marketing", "Regional Sales Manager", "2024-01-15", "Permanent", "Active", "Bengaluru Regional Office"),
                ("MM-EMP-106", "Divya Balaji", "divya.b@milkymist.com", "+91 98426 66077", "Information Technology", "Systems & Infrastructure Engineer", "2024-03-01", "Temporary", "Probation", "Perundurai Mega Plant (HQ)"),
                ("MM-EMP-107", "Rajeshwari G.", "rajeshwari.g@milkymist.com", "+91 98427 77088", "Finance & Accounts", "Accounts Executive", "2023-09-12", "Permanent", "On Leave", "Perundurai Mega Plant (HQ)"),
            ]
            now_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            for emp in initial_employees:
                conn.execute(
                    """
                    INSERT INTO employees (emp_id, name, email, phone, department, designation, joining_date, employment_type, status, location, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (*emp, now_ts),
                )

        # Interviews & Scorecards Table
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS interviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                candidate_app_id TEXT NOT NULL,
                candidate_name TEXT NOT NULL,
                round_type TEXT NOT NULL,
                interviewer TEXT NOT NULL,
                scheduled_at TEXT NOT NULL,
                location TEXT NOT NULL,
                status TEXT DEFAULT 'Scheduled',
                rating_technical INTEGER DEFAULT 0,
                rating_safety INTEGER DEFAULT 0,
                rating_experience INTEGER DEFAULT 0,
                rating_culture INTEGER DEFAULT 0,
                recommendation TEXT DEFAULT '',
                notes TEXT DEFAULT '',
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )

        # Shift Roster Table
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS shift_roster (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                emp_id TEXT NOT NULL,
                emp_name TEXT NOT NULL,
                department TEXT NOT NULL,
                shift_name TEXT NOT NULL,
                location TEXT NOT NULL,
                roster_date TEXT NOT NULL,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(emp_id, roster_date)
            )
            """
        )

        # Daily Attendance Table
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS attendance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                emp_id TEXT NOT NULL,
                emp_name TEXT NOT NULL,
                att_date TEXT NOT NULL,
                status TEXT NOT NULL,
                shift_name TEXT DEFAULT 'Shift A (06:00-14:00)',
                check_in_time TEXT DEFAULT '',
                check_out_time TEXT DEFAULT '',
                location TEXT NOT NULL,
                notes TEXT DEFAULT '',
                marked_by TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(emp_id, att_date)
            )
            """
        )

        # System Audit Trail Table
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user TEXT NOT NULL,
                action TEXT NOT NULL,
                target_type TEXT NOT NULL,
                target_id TEXT NOT NULL,
                details TEXT DEFAULT '',
                ip_address TEXT DEFAULT '',
                timestamp TEXT NOT NULL
            )
            """
        )

        # Seed initial audit logs if table is empty
        audit_count = conn.execute("SELECT COUNT(*) as cnt FROM audit_logs").fetchone()["cnt"]
        if audit_count == 0:
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            initial_logs = [
                ("admin123", "SYSTEM_INIT", "system", "SYS-001", "Milky Mist HR System and database initialized", "127.0.0.1", now_str),
                ("dev123", "SECURITY_VERIFY", "auth", "AUTH-01", "Session encryption and token handlers verified", "127.0.0.1", now_str),
                ("admin123", "WORKFORCE_SYNC", "employee", "SYNC-HQ", "Workforce synced with Perundurai Mega Plant registry", "127.0.0.1", now_str),
            ]
            for log in initial_logs:
                conn.execute(
                    """
                    INSERT INTO audit_logs (user, action, target_type, target_id, details, ip_address, timestamp)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    log,
                )

        # Seed sample interviews if empty
        interview_count = conn.execute("SELECT COUNT(*) as cnt FROM interviews").fetchone()["cnt"]
        if interview_count == 0:
            today_str = datetime.now().strftime("%Y-%m-%d")
            tomorrow_str = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
            sample_interviews = [
                ("APP-1001", "Kavitha Sundaram", "Plant Technical Round", "R. Senthil Kumar", f"{today_str}T16:00", "Perundurai Mega Plant (HQ)", "Scheduled", 0, 0, 0, 0, "", "Focus on automated cheese processing line operations.", "admin123", now_str),
                ("APP-1002", "Praveen Varma", "Food Safety & HACCP", "Ananya Raman", f"{tomorrow_str}T11:30", "Perundurai Mega Plant (HQ)", "Completed", 5, 4, 4, 5, "Strong Hire", "Solid knowledge of cold chain preservation and ISO/FSSAI dairy standards.", "admin123", now_str),
            ]
            for iv in sample_interviews:
                conn.execute(
                    """
                    INSERT INTO interviews (candidate_app_id, candidate_name, round_type, interviewer, scheduled_at, location, status, rating_technical, rating_safety, rating_experience, rating_culture, recommendation, notes, created_by, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    iv,
                )

        # Seed sample attendance for today if empty
        today_date = datetime.now().strftime("%Y-%m-%d")
        att_cnt = conn.execute("SELECT COUNT(*) as cnt FROM attendance WHERE att_date = ?", (today_date,)).fetchone()["cnt"]
        if att_cnt == 0:
            emp_rows = conn.execute("SELECT emp_id, name, location FROM employees LIMIT 7").fetchall()
            sample_statuses = [
                ("Present", "Shift A (06:00-14:00)", "05:55 AM", "On time at Perundurai Processing Bay"),
                ("Present", "Shift A (06:00-14:00)", "06:02 AM", "QA laboratory monitoring active"),
                ("Present", "Shift B (14:00-22:00)", "01:50 PM", "Cold chain reefer fleet staging"),
                ("Present", "General Shift (09:00-17:30)", "08:50 AM", "HR & staffing desk"),
                ("Present", "General Shift (09:00-17:30)", "09:05 AM", "Bengaluru Regional Hub sales ops"),
                ("Late", "Shift A (06:00-14:00)", "06:22 AM", "Late 22m - transit delay"),
                ("On Leave", "General Shift (09:00-17:30)", "—", "Approved medical leave"),
            ]
            now_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            for idx, emp in enumerate(emp_rows):
                stat, s_name, chk_in, notes = sample_statuses[idx % len(sample_statuses)]
                conn.execute(
                    """
                    INSERT OR IGNORE INTO attendance (emp_id, emp_name, att_date, status, shift_name, check_in_time, location, notes, marked_by, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (emp["emp_id"], emp["name"], today_date, stat, s_name, chk_in, emp["location"], notes, "admin123", now_ts),
                )

        # System Settings & Configuration Table
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS system_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                category TEXT NOT NULL,
                label TEXT NOT NULL,
                description TEXT DEFAULT '',
                data_type TEXT DEFAULT 'string',
                updated_at TEXT NOT NULL,
                updated_by TEXT DEFAULT 'system'
            )
            """
        )

        settings_count = conn.execute("SELECT COUNT(*) as cnt FROM system_settings").fetchone()["cnt"]
        if settings_count == 0:
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            default_settings = [
                # 1. Site Identity & Branding
                ("site_title", "Milky Mist HR Portal", "site_branding", "Portal Site Title", "Main web application title displayed in header and browser tab", "string"),
                ("site_subtitle", "Candidate Intelligence, Workforce & Plant HR Control", "site_branding", "Portal Subtitle / Tagline", "Descriptive subtitle shown beneath the primary dashboard heading", "string"),
                ("site_env_tag", "INTERNAL", "site_branding", "Environment Tag", "System operating environment badge (INTERNAL, PRODUCTION, STAGING, or DEVELOPMENT)", "string"),
                ("portal_admin_email", "admin@milkymist.local", "site_branding", "Technical Admin Contact", "System administrator email for portal error escalations and password resets", "string"),
                ("maintenance_mode", "false", "site_branding", "Site Maintenance Mode", "When enabled, displays an alert banner across portals warning of scheduled downtime", "boolean"),
                ("maintenance_message", "Scheduled routine system maintenance in progress. Data is fully preserved and candidate submissions are queued.", "site_branding", "Maintenance Banner Text", "Broadcast notification banner shown across all portal pages during maintenance", "string"),

                # 2. Appearance, Themes & Layout
                ("site_theme_accent", "blue", "appearance", "Primary Accent Theme", "Color palette for buttons, active tabs, and highlights (blue, navy, emerald, purple, slate)", "string"),
                ("sidebar_default_mode", "collapsed", "appearance", "Default Sidebar State", "Initial sidebar state upon page load (collapsed mini-rail vs permanently pinned open)", "string"),
                ("show_collapsed_badges", "true", "appearance", "Collapsed Rail Badges", "Show floating numerical notification count badges on icons in mini-rail mode", "boolean"),
                ("dense_table_mode_default", "true", "appearance", "Dense Table View Default", "Render single-line compact table rows with horizontal scrolling across workforce modules", "boolean"),
                ("ui_zoom_scale", "100%", "appearance", "Interface Density Scale", "Font scaling and element density (90% Compact, 100% Standard, 110% Comfortable)", "string"),

                # 3. Candidate Intake Portal (:8000)
                ("public_portal_active", "true", "candidate_portal", "Public Candidate Portal Active", "Allow external job seekers to access port 8000 and submit job applications", "boolean"),
                ("portal_announcement", "Milky Mist Careers — Submit your resume to be evaluated for operations, QA, logistics, and corporate roles.", "candidate_portal", "Careers Portal Announcement", "Welcome banner text displayed on the candidate resume upload portal", "string"),
                ("max_resume_mb", "10", "candidate_portal", "Max Resume Upload Size (MB)", "Maximum allowable file size in megabytes for candidate resume uploads", "number"),
                ("allowed_file_types", "PDF, DOCX", "candidate_portal", "Permitted File Formats", "Comma-separated list of allowed resume file formats accepted by the extractor", "string"),
                ("auto_parse_resume", "true", "candidate_portal", "AI Resume Extractor", "Automatically parse and populate education, work experience, and contact fields on upload", "boolean"),
                ("candidate_success_msg", "Thank you for applying to Milky Mist Dairy! Your application has been logged and forwarded to HR.", "candidate_portal", "Candidate Success Confirmation", "Custom thank-you message presented to applicant after successful resume submission", "string"),

                # 4. Security, Sessions & Access Control
                ("session_timeout_hours", "8", "security_auth", "Admin Session Lifetime (Hours)", "Inactivity timeout in hours before administrative login sessions automatically expire", "number"),
                ("allow_staff_create_users", "false", "security_auth", "Staff User Provisioning", "Allow standard staff users (non-admins) to create new system login credentials", "boolean"),
                ("min_password_length", "6", "security_auth", "Minimum Password Length", "Minimum number of characters required for user account passwords", "number"),
                ("enforce_audit_logging", "true", "security_auth", "Mandatory Audit Trail", "Log all candidate status changes, employee edits, and logins to immutable audit table", "boolean"),
                ("audit_retention_days", "365", "security_auth", "Audit Log Retention (Days)", "Number of days audit trail entries are preserved before archiving", "number"),
                ("remember_me_enabled", "true", "security_auth", "Persistent Browser Sessions", "Allow users to stay logged in across browser window restarts", "boolean"),

                # 5. Notifications, Task Popups & Audio
                ("task_reminder_interval_mins", "60", "notifications_ui", "Task Re-Prompt Interval (mins)", "How often incomplete assigned tasks prompt user with on-screen modal alerts", "number"),
                ("task_popup_on_login", "true", "notifications_ui", "Task Alert on Login", "Immediately display uncompleted tasks upon user login", "boolean"),
                ("desktop_notifications_enabled", "true", "notifications_ui", "Browser Desktop Alerts", "Trigger browser notification banners for urgent reminders when tab is in background", "boolean"),
                ("sound_effects_enabled", "true", "notifications_ui", "System Audio Chimes", "Play audible confirmation chimes on approvals, task completions, and alerts", "boolean"),
                ("notification_poll_interval_sec", "15", "notifications_ui", "Live Polling Interval (Sec)", "Background telemetry polling frequency in seconds to check for new tasks and approvals", "number"),
            ]
            for key, val, cat, lbl, desc, dtype in default_settings:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO system_settings (key, value, category, label, description, data_type, updated_at, updated_by)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (key, val, cat, lbl, desc, dtype, now_str, "system"),
                )

        # Payroll Records Table
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS payroll_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                emp_id TEXT NOT NULL,
                emp_name TEXT NOT NULL,
                department TEXT NOT NULL,
                designation TEXT NOT NULL,
                location TEXT NOT NULL,
                month_year TEXT NOT NULL,
                basic_salary REAL NOT NULL,
                hra REAL NOT NULL,
                conveyance REAL NOT NULL,
                plant_allowance REAL NOT NULL,
                shift_allowance REAL DEFAULT 0,
                gross_salary REAL NOT NULL,
                pf_deduction REAL NOT NULL,
                esi_deduction REAL NOT NULL,
                lop_days REAL DEFAULT 0,
                lop_deduction REAL DEFAULT 0,
                net_salary REAL NOT NULL,
                working_days INTEGER DEFAULT 30,
                present_days INTEGER DEFAULT 30,
                payment_status TEXT DEFAULT 'Processed',
                bank_account TEXT DEFAULT 'HDFC-8829102941',
                pf_uan TEXT DEFAULT 'UAN-1009281726',
                generated_at TEXT NOT NULL,
                UNIQUE(emp_id, month_year)
            )
            """
        )

        # Offer Letters Table
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS offer_letters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                offer_ref TEXT UNIQUE NOT NULL,
                candidate_app_id TEXT NOT NULL,
                candidate_name TEXT NOT NULL,
                candidate_email TEXT NOT NULL,
                candidate_phone TEXT DEFAULT '',
                designation TEXT NOT NULL,
                department TEXT NOT NULL,
                plant_location TEXT NOT NULL,
                joining_date TEXT NOT NULL,
                ctc_annual REAL NOT NULL,
                monthly_gross REAL NOT NULL,
                basic_monthly REAL NOT NULL,
                hra_monthly REAL NOT NULL,
                plant_allowance_monthly REAL NOT NULL,
                pf_monthly REAL NOT NULL,
                net_monthly REAL NOT NULL,
                employment_type TEXT DEFAULT 'Permanent',
                offer_status TEXT DEFAULT 'Issued',
                notes TEXT DEFAULT '',
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )

        # Seed sample payroll if empty
        pr_count = conn.execute("SELECT COUNT(*) as cnt FROM payroll_records").fetchone()["cnt"]
        if pr_count == 0:
            now_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            emp_rows = conn.execute("SELECT emp_id, name, department, designation, location FROM employees").fetchall()
            base_salaries = {
                "Lead": 65000,
                "Manager": 75000,
                "Engineer": 48000,
                "Technician": 32000,
                "Officer": 42000,
                "Executive": 38000,
                "Operator": 28000,
            }

            for emp in emp_rows:
                sal_base = 35000
                for title, amt in base_salaries.items():
                    if title.lower() in emp["designation"].lower():
                        sal_base = amt
                        break

                basic = round(sal_base * 0.50, 2)
                hra = round(sal_base * 0.25, 2)
                conveyance = 3000.0
                plant_allowance = 5000.0 if "perundurai" in emp["location"].lower() else 3500.0
                shift_allowance = 2400.0 if "Processing" in emp["department"] else 0.0
                gross = round(basic + hra + conveyance + plant_allowance + shift_allowance, 2)
                pf = round(basic * 0.12, 2)
                esi = round(gross * 0.0075, 2) if gross <= 21000 else 0.0
                lop_days = 1.0 if emp["emp_id"] == "MM-EMP-102" else 0.0
                daily_rate = round(gross / 30.0, 2)
                lop_deduction = round(lop_days * daily_rate, 2)
                net = round(gross - (pf + esi + lop_deduction), 2)

                bank_acc = f"HDFC-0492{emp['emp_id'].replace('MM-EMP-', '8839')}"
                pf_num = f"UAN-100{emp['emp_id'].replace('MM-EMP-', '94827')}"

                conn.execute(
                    """
                    INSERT OR IGNORE INTO payroll_records (
                        emp_id, emp_name, department, designation, location, month_year,
                        basic_salary, hra, conveyance, plant_allowance, shift_allowance,
                        gross_salary, pf_deduction, esi_deduction, lop_days, lop_deduction,
                        net_salary, working_days, present_days, payment_status,
                        bank_account, pf_uan, generated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        emp["emp_id"], emp["name"], emp["department"], emp["designation"], emp["location"], "2026-10",
                        basic, hra, conveyance, plant_allowance, shift_allowance,
                        gross, pf, esi, lop_days, lop_deduction,
                        net, 30, int(30 - lop_days), "Processed",
                        bank_acc, pf_num, now_ts
                    )
                )

        # Seed sample offer letter if empty
        offer_count = conn.execute("SELECT COUNT(*) as cnt FROM offer_letters").fetchone()["cnt"]
        if offer_count == 0:
            now_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            conn.execute(
                """
                INSERT OR IGNORE INTO offer_letters (
                    offer_ref, candidate_app_id, candidate_name, candidate_email, candidate_phone,
                    designation, department, plant_location, joining_date,
                    ctc_annual, monthly_gross, basic_monthly, hra_monthly, plant_allowance_monthly,
                    pf_monthly, net_monthly, employment_type, offer_status, notes, created_by, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "MM/HR/OFFER/2026/0104", "APP-1002", "Praveen Varma", "praveen.varma@example.com", "+91 98401 23456",
                    "Senior Food Safety & HACCP Specialist", "QA & Food Safety", "Perundurai Mega Plant (HQ)",
                    "2026-11-01", 660000.0, 55000.0, 27500.0, 13750.0, 7500.0, 3300.0, 48200.0,
                    "Permanent", "Issued", "Selected based on stellar HACCP food safety audit score (5-star).", "admin123", now_ts
                )
            )

        # ----------------------------------------------------------------------
        # Leave & Time-Off Management Tables
        # ----------------------------------------------------------------------
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS leave_balances (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                emp_id TEXT NOT NULL,
                emp_name TEXT NOT NULL,
                department TEXT NOT NULL,
                year INTEGER NOT NULL,
                cl_quota REAL DEFAULT 12.0,
                cl_used REAL DEFAULT 0.0,
                sl_quota REAL DEFAULT 10.0,
                sl_used REAL DEFAULT 0.0,
                el_quota REAL DEFAULT 15.0,
                el_used REAL DEFAULT 0.0,
                comp_off REAL DEFAULT 0.0,
                updated_at TEXT,
                UNIQUE(emp_id, year)
            )
            """
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS leave_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                leave_id TEXT UNIQUE NOT NULL,
                emp_id TEXT NOT NULL,
                emp_name TEXT NOT NULL,
                department TEXT NOT NULL,
                leave_type TEXT NOT NULL,
                start_date TEXT NOT NULL,
                end_date TEXT NOT NULL,
                days_count REAL NOT NULL,
                reason TEXT NOT NULL,
                handover_to TEXT DEFAULT '',
                status TEXT DEFAULT 'Pending',
                admin_notes TEXT DEFAULT '',
                approved_by TEXT DEFAULT '',
                approved_at TEXT DEFAULT '',
                created_at TEXT NOT NULL
            )
            """
        )

        # Seed leave balances for staff if empty
        lb_count = conn.execute("SELECT COUNT(*) as cnt FROM leave_balances").fetchone()["cnt"]
        if lb_count == 0:
            now_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            emp_rows = conn.execute("SELECT emp_id, name, department FROM employees").fetchall()
            for emp in emp_rows:
                # Slightly varied used leaves for realistic telemetry
                cl_u = 1.0 if emp["emp_id"] == "MM-EMP-103" else (0.5 if emp["emp_id"] == "MM-EMP-101" else 0.0)
                sl_u = 1.0 if emp["emp_id"] == "MM-EMP-104" else 0.0
                el_u = 2.0 if emp["emp_id"] == "MM-EMP-102" else 0.0
                conn.execute(
                    """
                    INSERT OR IGNORE INTO leave_balances (
                        emp_id, emp_name, department, year, cl_quota, cl_used, sl_quota, sl_used, el_quota, el_used, comp_off, updated_at
                    ) VALUES (?, ?, ?, ?, 12.0, ?, 10.0, ?, 15.0, ?, 0.0, ?)
                    """,
                    (emp["emp_id"], emp["name"], emp["department"], 2026, cl_u, sl_u, el_u, now_ts)
                )

        # Seed sample leave requests if empty
        lr_count = conn.execute("SELECT COUNT(*) as cnt FROM leave_requests").fetchone()["cnt"]
        if lr_count == 0:
            now_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            today_str = datetime.now().strftime("%Y-%m-%d")
            tomorrow_str = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
            
            sample_leaves = [
                (
                    "LV-2026-0101", "MM-EMP-103", "Priya Swaminathan", "QA & Food Safety",
                    "Casual Leave (CL)", today_str, today_str, 1.0,
                    "Personal family event in Coimbatore", "Ananya Raman", "Approved",
                    "Approved by Plant Quality Lead.", "admin123", now_ts, now_ts
                ),
                (
                    "LV-2026-0102", "MM-EMP-105", "K. Karthik", "Engineering & Automation",
                    "Sick Leave (SL)", tomorrow_str, (datetime.now() + timedelta(days=2)).strftime("%Y-%m-%d"), 2.0,
                    "High viral fever & rest recommended by doctor", "M. Rajesh", "Pending",
                    "", "", "", now_ts
                ),
                (
                    "LV-2026-0103", "MM-EMP-102", "Ananya Raman", "QA & Food Safety",
                    "Earned Leave (EL)", (datetime.now() + timedelta(days=5)).strftime("%Y-%m-%d"), (datetime.now() + timedelta(days=7)).strftime("%Y-%m-%d"), 3.0,
                    "Annual leave for temple festival and travel", "Priya Swaminathan", "Pending",
                    "", "", "", now_ts
                ),
            ]
            for lv in sample_leaves:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO leave_requests (
                        leave_id, emp_id, emp_name, department, leave_type, start_date, end_date,
                        days_count, reason, handover_to, status, admin_notes, approved_by, approved_at, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    lv
                )

        # Active Candidate Recruitment Pipeline Table
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS candidate_pipeline (
                app_id TEXT PRIMARY KEY,
                recruitment_status TEXT DEFAULT 'on_hold',
                completed_stages TEXT DEFAULT '[]',
                onboarded_emp_id TEXT DEFAULT '',
                onboarded_at TEXT DEFAULT '',
                updated_at TEXT,
                updated_by TEXT,
                custom_stages TEXT DEFAULT NULL
            )
            """
        )

        try:
            cols = [col[1] for col in conn.execute("PRAGMA table_info(candidate_pipeline)").fetchall()]
            if "custom_stages" not in cols:
                conn.execute("ALTER TABLE candidate_pipeline ADD COLUMN custom_stages TEXT DEFAULT NULL")
            if "target_role" not in cols:
                conn.execute("ALTER TABLE candidate_pipeline ADD COLUMN target_role TEXT DEFAULT ''")
            if "department" not in cols:
                conn.execute("ALTER TABLE candidate_pipeline ADD COLUMN department TEXT DEFAULT ''")
            if "assigned_recruiter" not in cols:
                conn.execute("ALTER TABLE candidate_pipeline ADD COLUMN assigned_recruiter TEXT DEFAULT ''")
            if "recruitment_started_at" not in cols:
                conn.execute("ALTER TABLE candidate_pipeline ADD COLUMN recruitment_started_at TEXT DEFAULT ''")
            if "recruitment_notes" not in cols:
                conn.execute("ALTER TABLE candidate_pipeline ADD COLUMN recruitment_notes TEXT DEFAULT ''")
        except Exception:
            pass

        conn.commit()
    finally:
        conn.close()


def get_default_role_permissions(role: str) -> Dict[str, bool]:
    """Default permission matrix based on role."""
    r = (role or "staff").lower()
    if r in ("developer", "admin"):
        return {
            "can_view_applications": True,
            "can_edit_applications": True,
            "can_view_approved": True,
            "can_edit_approved": True,
            "can_view_recruitment": True,
            "can_edit_recruitment": True,
            "can_edit_workflow": True,
            "can_view_employees": True,
            "can_edit_employees": True,
            "can_view_tasks": True,
            "can_assign_tasks": True,
            "can_view_settings": True,
            "can_edit_settings": True,
            "can_manage_users": True,
            "can_view_audit": True,
        }
    elif r == "recruiter":
        return {
            "can_view_applications": True,
            "can_edit_applications": True,
            "can_view_approved": True,
            "can_edit_approved": True,
            "can_view_recruitment": True,
            "can_edit_recruitment": True,
            "can_edit_workflow": False,
            "can_view_employees": True,
            "can_edit_employees": False,
            "can_view_tasks": True,
            "can_assign_tasks": True,
            "can_view_settings": False,
            "can_edit_settings": False,
            "can_manage_users": False,
            "can_view_audit": False,
        }
    elif r == "viewer":
        return {
            "can_view_applications": True,
            "can_edit_applications": False,
            "can_view_approved": True,
            "can_edit_approved": False,
            "can_view_recruitment": True,
            "can_edit_recruitment": False,
            "can_edit_workflow": False,
            "can_view_employees": True,
            "can_edit_employees": False,
            "can_view_tasks": True,
            "can_assign_tasks": False,
            "can_view_settings": False,
            "can_edit_settings": False,
            "can_manage_users": False,
            "can_view_audit": False,
        }
    else:  # "staff" or general
        return {
            "can_view_applications": True,
            "can_edit_applications": False,
            "can_view_approved": True,
            "can_edit_approved": False,
            "can_view_recruitment": True,
            "can_edit_recruitment": False,
            "can_edit_workflow": False,
            "can_view_employees": True,
            "can_edit_employees": False,
            "can_view_tasks": True,
            "can_assign_tasks": False,
            "can_view_settings": False,
            "can_edit_settings": False,
            "can_manage_users": False,
            "can_view_audit": False,
        }


def parse_user_permissions(raw_perm: Optional[str], role: str) -> Dict[str, bool]:
    """Combines defaults for role with user-specific permissions override."""
    perms = get_default_role_permissions(role)
    if raw_perm and raw_perm.strip():
        try:
            custom = json.loads(raw_perm)
            if isinstance(custom, dict):
                perms.update(custom)
        except Exception:
            pass
    return perms


def authenticate_user(username: str, password: str) -> Optional[Dict[str, Any]]:
    init_auth_db()
    conn = get_auth_connection()
    try:
        row = conn.execute(
            "SELECT id, username, password_hash, salt, name, role, can_create_users, permissions FROM users WHERE username = ?",
            (username.strip(),),
        ).fetchone()

        if not row:
            return None

        if not verify_password(password, row["salt"], row["password_hash"]):
            return None

        role = row["role"]
        perms = parse_user_permissions(row["permissions"], role)

        return {
            "id": row["id"],
            "username": row["username"],
            "name": row["name"],
            "role": role,
            "can_create_users": bool(row["can_create_users"]),
            "permissions": perms,
        }
    finally:
        conn.close()


def create_session(username: str, duration_hours: int = 72) -> str:
    conn = get_auth_connection()
    try:
        token = secrets.token_urlsafe(32)
        now = datetime.now()
        expires = now + timedelta(hours=duration_hours)

        conn.execute(
            "INSERT INTO sessions (token, username, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (token, username, now.strftime("%Y-%m-%d %H:%M:%S"), expires.strftime("%Y-%m-%d %H:%M:%S")),
        )
        conn.commit()
        return token
    finally:
        conn.close()


def get_user_by_session(token: str) -> Optional[Dict[str, Any]]:
    if not token:
        return None

    conn = get_auth_connection()
    try:
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        row = conn.execute(
            """
            SELECT u.id, u.username, u.name, u.role, u.can_create_users, u.permissions
            FROM sessions s
            JOIN users u ON LOWER(s.username) = LOWER(u.username)
            WHERE s.token = ? AND s.expires_at > ?
            """,
            (token, now_str),
        ).fetchone()

        if not row:
            return None

        role = row["role"]
        perms = parse_user_permissions(row["permissions"], role)

        return {
            "id": row["id"],
            "username": row["username"],
            "name": row["name"],
            "role": role,
            "can_create_users": bool(row["can_create_users"]),
            "permissions": perms,
        }
    finally:
        conn.close()


def delete_session(token: str) -> bool:
    if not token:
        return False
    conn = get_auth_connection()
    try:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        conn.commit()
        return True
    finally:
        conn.close()


def create_new_user(
    requester_username: str,
    new_username: str,
    new_password: str,
    full_name: str,
    role: str = "staff",
    permissions: Optional[Dict[str, bool]] = None,
) -> Dict[str, Any]:
    """
    Creates a new user.
    Strictly restricted: Only dev123 and admin123 (or can_create_users=1) are allowed.
    All newly created users have can_create_users = 0.
    """
    clean_requester = requester_username.strip().lower()
    clean_username = new_username.strip().lower()
    clean_name = full_name.strip()
    clean_role = role.strip() or "staff"

    # Authorization check
    conn = get_auth_connection()
    try:
        auth_row = conn.execute(
            "SELECT username, role, can_create_users FROM users WHERE username = ?",
            (clean_requester,),
        ).fetchone()

        if not auth_row or not auth_row["can_create_users"]:
            raise PermissionError("Access denied. Only dev123 and admin accounts have permission to create new users.")

        requester_role = auth_row["role"]

        if not clean_username or len(clean_username) < 3:
            raise ValueError("Username must be at least 3 characters.")

        if not new_password or len(new_password) < 4:
            raise ValueError("Password must be at least 4 characters.")

        if not clean_name:
            clean_name = clean_username.title()

        clean_role = clean_role.lower()
        if clean_role == "developer":
            raise PermissionError("Developer accounts cannot be created via the portal.")

        if clean_role == "admin":
            if requester_role != "developer":
                raise PermissionError("Access denied. Only developers can create admin accounts. Admins can only create user accounts.")
            can_create = 1
        else:
            can_create = 0

        # Check existing username
        existing = conn.execute("SELECT id FROM users WHERE username = ?", (clean_username,)).fetchone()
        if existing:
            raise ValueError(f"Username '{clean_username}' already exists. Please choose a different username.")

        pwd_hash, salt = hash_password(new_password)
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        perm_json = json.dumps(permissions or get_default_role_permissions(clean_role))

        cursor = conn.execute(
            """
            INSERT INTO users (username, password_hash, salt, name, role, can_create_users, permissions, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (clean_username, pwd_hash, salt, clean_name, clean_role, can_create, perm_json, now_str),
        )
        conn.commit()
        new_id = cursor.lastrowid

        return {
            "id": new_id,
            "username": clean_username,
            "name": clean_name,
            "role": clean_role,
            "can_create_users": bool(can_create),
            "permissions": json.loads(perm_json),
            "created_at": now_str,
        }
    finally:
        conn.close()


def update_user_permissions(target_username: str, permissions: Dict[str, bool], modifier_username: str) -> bool:
    """Master Control: Update a user's granular permissions matrix."""
    conn = get_auth_connection()
    try:
        clean_target = target_username.strip().lower()
        clean_mod = modifier_username.strip().lower()

        # Check modifier authority
        mod_row = conn.execute("SELECT role, can_create_users FROM users WHERE username = ?", (clean_mod,)).fetchone()
        if not mod_row or not mod_row["can_create_users"]:
            raise PermissionError("Access denied. Only authorized HR Admins can alter user permissions.")

        # Check target user
        target_row = conn.execute("SELECT id, role FROM users WHERE username = ?", (clean_target,)).fetchone()
        if not target_row:
            raise ValueError(f"User '{target_username}' not found.")

        # Only developer can modify developer permissions
        if target_row["role"] == "developer" and mod_row["role"] != "developer":
            raise PermissionError("Cannot modify developer permissions.")

        perm_str = json.dumps(permissions)
        conn.execute("UPDATE users SET permissions = ? WHERE username = ?", (perm_str, clean_target))
        conn.commit()

        log_audit_event(
            clean_mod,
            "UPDATE_PERMISSIONS",
            "user",
            clean_target,
            f"Updated permissions matrix for user {clean_target}"
        )
        return True
    finally:
        conn.close()


def list_all_users() -> List[Dict[str, Any]]:
    conn = get_auth_connection()
    try:
        rows = conn.execute(
            "SELECT id, username, name, role, can_create_users, permissions, created_at FROM users ORDER BY id ASC"
        ).fetchall()
        return [
            {
                "id": r["id"],
                "username": r["username"],
                "name": r["name"],
                "role": r["role"],
                "can_create_users": bool(r["can_create_users"]),
                "permissions": parse_user_permissions(r["permissions"], r["role"]),
                "created_at": r["created_at"],
            }
            for r in rows
        ]
    finally:
        conn.close()


def create_task_and_assign(
    creator_username: str,
    title: str,
    description: str = "",
    due_date: str = "",
    priority: str = "medium",
    assigned_type: str = "single",
    target_usernames: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Creates a new task/reminder and distributes assignments/notifications to target users:
    - 'single': 1 specific user
    - 'multiple': list of specified users
    - 'everyone': all registered users
    """
    if not title.strip():
        raise ValueError("Task title is required.")

    valid_priorities = ("low", "medium", "high", "urgent")
    priority = priority.lower() if priority.lower() in valid_priorities else "medium"

    clean_creator = creator_username.strip().lower()
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    conn = get_auth_connection()
    try:
        # Check creator role
        creator_row = conn.execute("SELECT role, can_create_users FROM users WHERE username = ?", (clean_creator,)).fetchone()
        if not creator_row or not creator_row["can_create_users"]:
            raise PermissionError("Access denied. Only authorized admins and developers can assign tasks.")

        creator_role = creator_row["role"]

        # Determine recipient list
        recipients = []
        if assigned_type == "everyone":
            if creator_role == "developer":
                user_rows = conn.execute("SELECT username FROM users").fetchall()
            else:
                # Admin (or others) cannot assign tasks to developers
                user_rows = conn.execute("SELECT username FROM users WHERE role != 'developer'").fetchall()
            recipients = [r["username"] for r in user_rows]
        else:
            if target_usernames:
                for u in target_usernames:
                    clean_u = u.strip().lower()
                    if not clean_u:
                        continue
                    # Admin cannot assign tasks to developers
                    target_row = conn.execute("SELECT role FROM users WHERE username = ?", (clean_u,)).fetchone()
                    if target_row and target_row["role"] == "developer" and creator_role != "developer":
                        raise PermissionError(f"Admins cannot assign tasks to developers ({clean_u}).")
                    if clean_u not in recipients:
                        recipients.append(clean_u)

        if not recipients:
            raise ValueError("At least one assignee must be specified.")

        target_str = ",".join(recipients)

        cursor = conn.execute(
            """
            INSERT INTO tasks (created_by, title, description, due_date, priority, assigned_type, target_usernames, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (clean_creator, title.strip(), description.strip(), due_date.strip(), priority, assigned_type, target_str, now_str),
        )
        task_id = cursor.lastrowid

        # Insert notification / assignment for each recipient
        for username in recipients:
            conn.execute(
                """
                INSERT INTO task_notifications (task_id, username, is_read, is_completed, assigned_at)
                VALUES (?, ?, 0, 0, ?)
                """,
                (task_id, username, now_str),
            )

        conn.commit()

        return {
            "id": task_id,
            "created_by": clean_creator,
            "title": title.strip(),
            "description": description.strip(),
            "due_date": due_date.strip(),
            "priority": priority,
            "assigned_type": assigned_type,
            "recipients": recipients,
            "created_at": now_str,
        }
    finally:
        conn.close()


def update_task(
    task_id: int,
    updater_username: str,
    title: str,
    description: str = "",
    due_date: str = "",
    priority: str = "medium",
    assigned_type: str = "single",
    target_usernames: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Updates an existing task and synchronizes assignee notifications.
    Admins cannot assign tasks to developers.
    """
    if not title.strip():
        raise ValueError("Task title is required.")

    valid_priorities = ("low", "medium", "high", "urgent")
    priority = priority.lower() if priority.lower() in valid_priorities else "medium"

    clean_updater = updater_username.strip().lower()
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    conn = get_auth_connection()
    try:
        task_row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not task_row:
            raise ValueError(f"Task #{task_id} not found.")

        updater_row = conn.execute("SELECT role, can_create_users FROM users WHERE username = ?", (clean_updater,)).fetchone()
        if not updater_row or not updater_row["can_create_users"]:
            raise PermissionError("Access denied. Only authorized admins and developers can edit tasks.")

        updater_role = updater_row["role"]

        # Determine recipient list
        recipients = []
        if assigned_type == "everyone":
            if updater_role == "developer":
                user_rows = conn.execute("SELECT username FROM users").fetchall()
            else:
                user_rows = conn.execute("SELECT username FROM users WHERE role != 'developer'").fetchall()
            recipients = [r["username"] for r in user_rows]
        else:
            if target_usernames:
                for u in target_usernames:
                    clean_u = u.strip().lower()
                    if not clean_u:
                        continue
                    target_row = conn.execute("SELECT role FROM users WHERE username = ?", (clean_u,)).fetchone()
                    if target_row and target_row["role"] == "developer" and updater_role != "developer":
                        raise PermissionError(f"Admins cannot assign tasks to developers ({clean_u}).")
                    if clean_u not in recipients:
                        recipients.append(clean_u)

        if not recipients:
            raise ValueError("At least one assignee must be specified.")

        target_str = ",".join(recipients)

        # Update task master record
        conn.execute(
            """
            UPDATE tasks 
            SET title = ?, description = ?, due_date = ?, priority = ?, assigned_type = ?, target_usernames = ?
            WHERE id = ?
            """,
            (title.strip(), description.strip(), due_date.strip(), priority, assigned_type, target_str, task_id),
        )

        # Sync task_notifications
        existing_assignees = conn.execute(
            "SELECT username FROM task_notifications WHERE task_id = ?",
            (task_id,),
        ).fetchall()
        existing_usernames = set(r["username"].lower() for r in existing_assignees)
        new_usernames = set(r.lower() for r in recipients)

        # Delete removed assignees
        to_remove = existing_usernames - new_usernames
        for u in to_remove:
            conn.execute("DELETE FROM task_notifications WHERE task_id = ? AND LOWER(username) = ?", (task_id, u))

        # Add newly added assignees
        to_add = new_usernames - existing_usernames
        for u in to_add:
            conn.execute(
                """
                INSERT INTO task_notifications (task_id, username, is_read, is_completed, assigned_at)
                VALUES (?, ?, 0, 0, ?)
                """,
                (task_id, u, now_str),
            )

        # Reset is_read to 0 for all recipients so they are alerted of the updated task
        conn.execute("UPDATE task_notifications SET is_read = 0 WHERE task_id = ?", (task_id,))

        conn.commit()

        return {
            "id": task_id,
            "title": title.strip(),
            "description": description.strip(),
            "due_date": due_date.strip(),
            "priority": priority,
            "assigned_type": assigned_type,
            "recipients": recipients,
        }
    finally:
        conn.close()


def get_task_by_id(task_id: int) -> Optional[Dict[str, Any]]:
    conn = get_auth_connection()
    try:
        tr = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not tr:
            return None
        t = dict(tr)
        assign_rows = conn.execute(
            """
            SELECT tn.username, tn.is_read, tn.is_completed, tn.completed_at, u.name
            FROM task_notifications tn
            LEFT JOIN users u ON LOWER(tn.username) = LOWER(u.username)
            WHERE tn.task_id = ?
            """,
            (task_id,),
        ).fetchall()
        t["assignees"] = [
            {
                "username": a["username"],
                "name": a["name"] or a["username"],
                "is_read": bool(a["is_read"]),
                "is_completed": bool(a["is_completed"]),
                "completed_at": a["completed_at"],
            }
            for a in assign_rows
        ]
        return t
    finally:
        conn.close()


def get_user_notifications(username: str) -> Dict[str, Any]:
    """
    Returns tasks assigned to the specific user, including unread and completion status.
    """
    clean_username = username.strip().lower()
    conn = get_auth_connection()
    try:
        query = """
            SELECT 
                tn.id as notification_id,
                tn.task_id,
                tn.is_read,
                tn.is_completed,
                tn.completed_at,
                tn.assigned_at,
                t.title,
                t.description,
                t.due_date,
                t.priority,
                t.assigned_type,
                t.created_by,
                t.created_at
            FROM task_notifications tn
            JOIN tasks t ON tn.task_id = t.id
            WHERE LOWER(tn.username) = ?
            ORDER BY tn.id DESC
        """
        rows = conn.execute(query, (clean_username,)).fetchall()

        items = []
        unread_count = 0
        pending_count = 0

        for r in rows:
            item = dict(r)
            item["is_read"] = bool(item["is_read"])
            item["is_completed"] = bool(item["is_completed"])
            if not item["is_read"]:
                unread_count += 1
            if not item["is_completed"]:
                pending_count += 1
            items.append(item)

        return {
            "unread_count": unread_count,
            "pending_count": pending_count,
            "total_count": len(items),
            "notifications": items,
        }
    finally:
        conn.close()


def mark_notification_read(notification_id: int, username: str) -> bool:
    clean_username = username.strip().lower()
    conn = get_auth_connection()
    try:
        conn.execute(
            "UPDATE task_notifications SET is_read = 1 WHERE id = ? AND LOWER(username) = ?",
            (notification_id, clean_username),
        )
        conn.commit()
        return True
    finally:
        conn.close()


def mark_all_notifications_read(username: str) -> bool:
    clean_username = username.strip().lower()
    conn = get_auth_connection()
    try:
        conn.execute(
            "UPDATE task_notifications SET is_read = 1 WHERE LOWER(username) = ?",
            (clean_username,),
        )
        conn.commit()
        return True
    finally:
        conn.close()


def toggle_task_completion(task_id: int, username: str, is_completed: bool) -> bool:
    clean_username = username.strip().lower()
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S") if is_completed else ""
    conn = get_auth_connection()
    try:
        conn.execute(
            """
            UPDATE task_notifications 
            SET is_completed = ?, completed_at = ?, is_read = 1
            WHERE task_id = ? AND LOWER(username) = ?
            """,
            (1 if is_completed else 0, now_str, task_id, clean_username),
        )
        conn.commit()
        return True
    finally:
        conn.close()


def get_admin_all_tasks() -> List[Dict[str, Any]]:
    """
    Retrieves all tasks created, along with assignee breakdowns and completion status.
    """
    conn = get_auth_connection()
    try:
        task_rows = conn.execute("SELECT * FROM tasks ORDER BY id DESC").fetchall()
        tasks = []

        for tr in task_rows:
            t = dict(tr)
            # Fetch assignments for this task
            assign_rows = conn.execute(
                """
                SELECT tn.username, tn.is_read, tn.is_completed, tn.completed_at, u.name
                FROM task_notifications tn
                LEFT JOIN users u ON LOWER(tn.username) = LOWER(u.username)
                WHERE tn.task_id = ?
                """,
                (t["id"],),
            ).fetchall()

            assignees = [
                {
                    "username": a["username"],
                    "name": a["name"] or a["username"],
                    "is_read": bool(a["is_read"]),
                    "is_completed": bool(a["is_completed"]),
                    "completed_at": a["completed_at"],
                }
                for a in assign_rows
            ]

            completed_count = sum(1 for a in assignees if a["is_completed"])
            t["assignees"] = assignees
            t["assignees_count"] = len(assignees)
            t["completed_count"] = completed_count
            tasks.append(t)

        return tasks
    finally:
        conn.close()


def delete_task(task_id: int, username: str) -> bool:
    conn = get_auth_connection()
    try:
        conn.execute("DELETE FROM task_notifications WHERE task_id = ?", (task_id,))
        conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        conn.commit()
        return True
    finally:
        conn.close()


# ==========================================================================
# Employee Directory Management
# ==========================================================================
def get_all_employees(
    department: Optional[str] = None,
    status: Optional[str] = None,
    employment_type: Optional[str] = None,
    search: Optional[str] = None,
) -> List[Dict[str, Any]]:
    conn = get_auth_connection()
    try:
        query = "SELECT * FROM employees WHERE 1=1"
        params = []
        if department and department.strip() and department.lower() != "all":
            query += " AND LOWER(department) = ?"
            params.append(department.strip().lower())
        if status and status.strip() and status.lower() != "all":
            query += " AND LOWER(status) = ?"
            params.append(status.strip().lower())
        if employment_type and employment_type.strip() and employment_type.lower() != "all":
            query += " AND LOWER(employment_type) = ?"
            params.append(employment_type.strip().lower())
        if search and search.strip():
            s = f"%{search.strip().lower()}%"
            query += " AND (LOWER(name) LIKE ? OR LOWER(emp_id) LIKE ? OR LOWER(email) LIKE ? OR LOWER(designation) LIKE ? OR LOWER(location) LIKE ?)"
            params.extend([s, s, s, s, s])

        query += " ORDER BY id DESC"
        rows = conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_employee_stats() -> Dict[str, Any]:
    conn = get_auth_connection()
    try:
        total = conn.execute("SELECT COUNT(*) as c FROM employees").fetchone()["c"]
        active = conn.execute("SELECT COUNT(*) as c FROM employees WHERE status = 'Active'").fetchone()["c"]
        probation = conn.execute("SELECT COUNT(*) as c FROM employees WHERE status = 'Probation'").fetchone()["c"]
        on_leave = conn.execute("SELECT COUNT(*) as c FROM employees WHERE status = 'On Leave'").fetchone()["c"]
        depts = conn.execute("SELECT COUNT(DISTINCT department) as c FROM employees").fetchone()["c"]
        return {
            "total": total,
            "active": active,
            "probation": probation,
            "on_leave": on_leave,
            "departments": depts,
        }
    finally:
        conn.close()


def get_employee(emp_id_or_id: str) -> Optional[Dict[str, Any]]:
    conn = get_auth_connection()
    try:
        row = conn.execute(
            "SELECT * FROM employees WHERE emp_id = ? OR id = ?",
            (emp_id_or_id, emp_id_or_id)
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def create_employee(
    name: str,
    email: str,
    phone: str = "",
    department: str = "Dairy Processing & Production",
    designation: str = "Staff",
    joining_date: str = "",
    employment_type: str = "Permanent",
    status: str = "Active",
    location: str = "Perundurai Mega Plant (HQ)",
    candidate_app_id: str = "",
) -> Dict[str, Any]:
    conn = get_auth_connection()
    try:
        clean_email = email.strip().lower()
        existing = conn.execute("SELECT id FROM employees WHERE LOWER(email) = ?", (clean_email,)).fetchone()
        if existing:
            raise ValueError(f"An employee with email '{email}' already exists.")

        max_row = conn.execute("SELECT MAX(id) as max_id FROM employees").fetchone()
        next_num = 100 + (max_row["max_id"] or 0) + 1
        emp_id = f"MM-EMP-{next_num}"
        now_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        conn.execute(
            """
            INSERT INTO employees (emp_id, name, email, phone, department, designation, joining_date, employment_type, status, location, candidate_app_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (emp_id, name.strip(), clean_email, phone.strip(), department.strip(), designation.strip(), joining_date.strip(), employment_type.strip(), status.strip(), location.strip(), candidate_app_id.strip(), now_ts)
        )
        conn.commit()
        return get_employee(emp_id)
    finally:
        conn.close()


def update_employee(
    emp_id: str,
    name: str,
    email: str,
    phone: str = "",
    department: str = "",
    designation: str = "",
    joining_date: str = "",
    employment_type: str = "Permanent",
    status: str = "Active",
    location: str = "Perundurai Mega Plant (HQ)",
) -> Dict[str, Any]:
    conn = get_auth_connection()
    try:
        row = conn.execute("SELECT * FROM employees WHERE emp_id = ? OR id = ?", (emp_id, emp_id)).fetchone()
        if not row:
            raise ValueError(f"Employee {emp_id} not found.")

        clean_email = email.strip().lower()
        if clean_email != row["email"].lower():
            dup = conn.execute("SELECT id FROM employees WHERE LOWER(email) = ? AND id != ?", (clean_email, row["id"])).fetchone()
            if dup:
                raise ValueError(f"Email '{email}' is already in use by another employee.")

        conn.execute(
            """
            UPDATE employees
            SET name = ?, email = ?, phone = ?, department = ?, designation = ?, joining_date = ?, employment_type = ?, status = ?, location = ?
            WHERE id = ?
            """,
            (name.strip(), clean_email, phone.strip(), department.strip(), designation.strip(), joining_date.strip(), employment_type.strip(), status.strip(), location.strip(), row["id"])
        )
        conn.commit()
        return get_employee(row["emp_id"])
    finally:
        conn.close()


def delete_employee(emp_id: str) -> bool:
    conn = get_auth_connection()
    try:
        conn.execute("DELETE FROM employees WHERE emp_id = ? OR id = ?", (emp_id, emp_id))
        conn.commit()
        return True
    finally:
        conn.close()


def get_analytics_overview() -> Dict[str, Any]:
    """Retrieve comprehensive workforce, location, and task execution analytics."""
    conn = get_auth_connection()
    try:
        # Workforce stats
        total_emp = conn.execute("SELECT COUNT(*) as c FROM employees").fetchone()["c"]
        active_emp = conn.execute("SELECT COUNT(*) as c FROM employees WHERE status = 'Active'").fetchone()["c"]
        probation_emp = conn.execute("SELECT COUNT(*) as c FROM employees WHERE status = 'Probation'").fetchone()["c"]
        on_leave_emp = conn.execute("SELECT COUNT(*) as c FROM employees WHERE status = 'On Leave'").fetchone()["c"]
        onboarded_cnt = conn.execute("SELECT COUNT(*) as c FROM employees WHERE candidate_app_id != ''").fetchone()["c"]

        # Locations (Strictly Perundurai Mega Plant (HQ) and Bengaluru Regional Office)
        loc_rows = conn.execute("SELECT location, COUNT(*) as c FROM employees GROUP BY location ORDER BY c DESC").fetchall()
        locations = {
            "Perundurai Mega Plant (HQ)": 0,
            "Bengaluru Regional Office": 0,
        }
        for r in loc_rows:
            loc = r["location"]
            if "bengaluru" in loc.lower() or "blr" in loc.lower() or "bangalore" in loc.lower():
                locations["Bengaluru Regional Office"] += r["c"]
            else:
                locations["Perundurai Mega Plant (HQ)"] += r["c"]

        # Departments
        dept_rows = conn.execute("SELECT department, COUNT(*) as c FROM employees GROUP BY department ORDER BY c DESC").fetchall()
        departments = [{"name": r["department"], "count": r["c"]} for r in dept_rows]

        # Employment Types
        type_rows = conn.execute("SELECT employment_type, COUNT(*) as c FROM employees GROUP BY employment_type").fetchall()
        employment_types = {r["employment_type"]: r["c"] for r in type_rows}

        # Tasks stats
        total_tasks = conn.execute("SELECT COUNT(*) as c FROM tasks").fetchone()["c"]
        total_assignments = conn.execute("SELECT COUNT(*) as c FROM task_notifications").fetchone()["c"]
        completed_assignments = conn.execute("SELECT COUNT(*) as c FROM task_notifications WHERE is_completed = 1").fetchone()["c"]
        pending_assignments = total_assignments - completed_assignments
        completion_rate = round((completed_assignments / total_assignments * 100), 1) if total_assignments > 0 else 100.0

        prio_rows = conn.execute("SELECT priority, COUNT(*) as c FROM tasks GROUP BY priority").fetchall()
        priorities = {"urgent": 0, "high": 0, "medium": 0, "low": 0}
        for r in prio_rows:
            p = r["priority"].lower()
            if p in priorities:
                priorities[p] = r["c"]

        return {
            "workforce": {
                "total": total_emp,
                "active": active_emp,
                "probation": probation_emp,
                "on_leave": on_leave_emp,
                "onboarded_from_pipeline": onboarded_cnt,
                "locations": locations,
                "departments": departments,
                "employment_types": employment_types,
            },
            "tasks": {
                "total_tasks": total_tasks,
                "total_assignments": total_assignments,
                "completed": completed_assignments,
                "pending": pending_assignments,
                "completion_rate": completion_rate,
                "priorities": priorities,
            }
        }
    finally:
        conn.close()


# ==============================================================================
# Audit Trail Helper Functions
# ==============================================================================

def log_audit_event(user: str, action: str, target_type: str, target_id: str, details: str = "", ip_address: str = ""):
    conn = get_auth_connection()
    try:
        now_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        conn.execute(
            """
            INSERT INTO audit_logs (user, action, target_type, target_id, details, ip_address, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (user or "system", action, target_type, target_id, details, ip_address or "127.0.0.1", now_ts),
        )
        conn.commit()
    except Exception as e:
        print(f"[Audit Log Error] {e}")
    finally:
        conn.close()


def get_audit_logs(limit: int = 150, action: Optional[str] = None, search: Optional[str] = None) -> List[Dict[str, Any]]:
    conn = get_auth_connection()
    try:
        query = "SELECT * FROM audit_logs WHERE 1=1"
        params: List[Any] = []
        if action:
            query += " AND action = ?"
            params.append(action)
        if search:
            query += " AND (user LIKE ? OR details LIKE ? OR target_id LIKE ?)"
            s = f"%{search}%"
            params.extend([s, s, s])
        query += " ORDER BY id DESC LIMIT ?"
        params.append(limit)

        rows = conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# ==============================================================================
# Interview & Candidate Scorecard Helper Functions
# ==============================================================================

def list_interviews(candidate_app_id: Optional[str] = None, status: Optional[str] = None) -> List[Dict[str, Any]]:
    conn = get_auth_connection()
    try:
        query = "SELECT * FROM interviews WHERE 1=1"
        params: List[Any] = []
        if candidate_app_id:
            query += " AND candidate_app_id = ?"
            params.append(candidate_app_id)
        if status:
            query += " AND status = ?"
            params.append(status)
        query += " ORDER BY scheduled_at ASC, id DESC"
        rows = conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_interview(interview_id: int) -> Optional[Dict[str, Any]]:
    conn = get_auth_connection()
    try:
        row = conn.execute("SELECT * FROM interviews WHERE id = ?", (interview_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def create_interview(
    candidate_app_id: str,
    candidate_name: str,
    round_type: str,
    interviewer: str,
    scheduled_at: str,
    location: str,
    notes: str,
    created_by: str,
) -> Dict[str, Any]:
    conn = get_auth_connection()
    try:
        now_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cur = conn.execute(
            """
            INSERT INTO interviews (candidate_app_id, candidate_name, round_type, interviewer, scheduled_at, location, status, notes, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'Scheduled', ?, ?, ?)
            """,
            (candidate_app_id, candidate_name, round_type, interviewer, scheduled_at, location, notes, created_by, now_ts),
        )
        conn.commit()
        iv_id = cur.lastrowid
        log_audit_event(created_by, "SCHEDULE_INTERVIEW", "interview", f"INT-{iv_id}", f"Scheduled {round_type} with {candidate_name} ({candidate_app_id})")
        return {"id": iv_id, "candidate_app_id": candidate_app_id, "status": "Scheduled"}
    finally:
        conn.close()


def submit_scorecard(
    interview_id: int,
    rating_technical: int,
    rating_safety: int,
    rating_experience: int,
    rating_culture: int,
    recommendation: str,
    notes: str,
    user: str,
) -> bool:
    conn = get_auth_connection()
    try:
        conn.execute(
            """
            UPDATE interviews
            SET status = 'Completed',
                rating_technical = ?,
                rating_safety = ?,
                rating_experience = ?,
                rating_culture = ?,
                recommendation = ?,
                notes = ?
            WHERE id = ?
            """,
            (rating_technical, rating_safety, rating_experience, rating_culture, recommendation, notes, interview_id),
        )
        conn.commit()
        log_audit_event(user, "SUBMIT_SCORECARD", "interview", f"INT-{interview_id}", f"Submitted scorecard for interview {interview_id}: {recommendation}")
        return True
    finally:
        conn.close()


def update_interview_status(interview_id: int, status: str, user: str) -> bool:
    conn = get_auth_connection()
    try:
        conn.execute("UPDATE interviews SET status = ? WHERE id = ?", (status, interview_id))
        conn.commit()
        log_audit_event(user, "UPDATE_INTERVIEW_STATUS", "interview", f"INT-{interview_id}", f"Interview status changed to {status}")
        return True
    finally:
        conn.close()


# ==============================================================================
# Attendance & Shift Roster Helper Functions
# ==============================================================================

def get_daily_attendance(att_date: Optional[str] = None, department: Optional[str] = None) -> List[Dict[str, Any]]:
    conn = get_auth_connection()
    try:
        target_date = att_date or datetime.now().strftime("%Y-%m-%d")
        
        # Ensure all active employees have a record for target_date
        emp_rows = conn.execute("SELECT emp_id, name, department, location FROM employees WHERE status != 'Inactive'").fetchall()
        now_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        for emp in emp_rows:
            conn.execute(
                """
                INSERT OR IGNORE INTO attendance (emp_id, emp_name, att_date, status, shift_name, check_in_time, location, notes, marked_by, updated_at)
                VALUES (?, ?, ?, 'Present', 'Shift A (06:00-14:00)', '06:00 AM', ?, '', 'system', ?)
                """,
                (emp["emp_id"], emp["name"], target_date, emp["location"], now_ts),
            )
        conn.commit()

        query = """
            SELECT a.*, e.department, e.designation, e.employment_type
            FROM attendance a
            JOIN employees e ON a.emp_id = e.emp_id
            WHERE a.att_date = ?
        """
        params: List[Any] = [target_date]
        if department:
            query += " AND e.department = ?"
            params.append(department)
        query += " ORDER BY a.status = 'Present' DESC, e.name ASC"

        rows = conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def mark_attendance(
    emp_id: str,
    att_date: str,
    status: str,
    shift_name: str = "Shift A (06:00-14:00)",
    check_in_time: str = "",
    notes: str = "",
    marked_by: str = "admin",
) -> bool:
    conn = get_auth_connection()
    try:
        emp = conn.execute("SELECT name, location FROM employees WHERE emp_id = ?", (emp_id,)).fetchone()
        emp_name = emp["name"] if emp else emp_id
        emp_loc = emp["location"] if emp else "Perundurai Mega Plant (HQ)"
        now_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        conn.execute(
            """
            INSERT INTO attendance (emp_id, emp_name, att_date, status, shift_name, check_in_time, location, notes, marked_by, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(emp_id, att_date) DO UPDATE SET
                status = excluded.status,
                shift_name = excluded.shift_name,
                check_in_time = excluded.check_in_time,
                notes = excluded.notes,
                marked_by = excluded.marked_by,
                updated_at = excluded.updated_at
            """,
            (emp_id, emp_name, att_date, status, shift_name, check_in_time, emp_loc, notes, marked_by, now_ts),
        )
        conn.commit()
        log_audit_event(marked_by, "MARK_ATTENDANCE", "attendance", emp_id, f"Marked {emp_name} ({emp_id}) as {status} for {att_date} ({shift_name})")
        return True
    finally:
        conn.close()


def get_attendance_stats(att_date: Optional[str] = None) -> Dict[str, Any]:
    conn = get_auth_connection()
    try:
        target_date = att_date or datetime.now().strftime("%Y-%m-%d")
        total_staff = conn.execute("SELECT COUNT(*) as c FROM employees WHERE status != 'Inactive'").fetchone()["c"]
        att_rows = conn.execute("SELECT status, COUNT(*) as c FROM attendance WHERE att_date = ? GROUP BY status", (target_date,)).fetchall()
        
        stats = {"total": total_staff, "present": 0, "late": 0, "on_leave": 0, "absent": 0, "half_day": 0}
        for r in att_rows:
            st = (r["status"] or "").lower().replace(" ", "_")
            if st in stats:
                stats[st] = r["c"]

        attended = stats["present"] + stats["late"] + stats["half_day"]
        stats["rate"] = round((attended / total_staff * 100), 1) if total_staff > 0 else 100.0
        stats["date"] = target_date
        return stats
    finally:
        conn.close()


def get_shift_roster(roster_date: Optional[str] = None) -> List[Dict[str, Any]]:
    conn = get_auth_connection()
    try:
        target_date = roster_date or datetime.now().strftime("%Y-%m-%d")
        rows = conn.execute("SELECT * FROM shift_roster WHERE roster_date = ? ORDER BY shift_name ASC, emp_name ASC", (target_date,)).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def assign_shift_roster(emp_id: str, roster_date: str, shift_name: str, user: str) -> bool:
    conn = get_auth_connection()
    try:
        emp = conn.execute("SELECT name, department, location FROM employees WHERE emp_id = ?", (emp_id,)).fetchone()
        if not emp:
            return False
        now_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        conn.execute(
            """
            INSERT INTO shift_roster (emp_id, emp_name, department, shift_name, location, roster_date, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(emp_id, roster_date) DO UPDATE SET
                shift_name = excluded.shift_name,
                created_by = excluded.created_by,
                created_at = excluded.created_at
            """,
            (emp_id, emp["name"], emp["department"], shift_name, emp["location"], roster_date, user, now_ts),
        )
        conn.commit()
        log_audit_event(user, "ASSIGN_ROSTER", "roster", emp_id, f"Assigned {emp['name']} to {shift_name} for {roster_date}")
        return True
    finally:
        conn.close()


def get_all_settings() -> List[Dict[str, Any]]:
    """Retrieve all configuration settings ordered by category."""
    conn = get_auth_connection()
    try:
        rows = conn.execute("SELECT * FROM system_settings ORDER BY category, key").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_settings_dict() -> Dict[str, Any]:
    """Retrieve key-value dictionary of settings with typed values."""
    conn = get_auth_connection()
    try:
        rows = conn.execute("SELECT key, value, data_type FROM system_settings").fetchall()
        res = {}
        for r in rows:
            val = r["value"]
            if r["data_type"] == "boolean":
                val = val.lower() in ("true", "1", "yes")
            elif r["data_type"] == "number":
                try:
                    val = float(val) if "." in val else int(val)
                except ValueError:
                    pass
            res[r["key"]] = val
        return res
    finally:
        conn.close()


def update_settings(updates: Dict[str, Any], user: str) -> bool:
    """Update multiple system settings and log audit event."""
    conn = get_auth_connection()
    try:
        now_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        for key, val in updates.items():
            str_val = str(val).lower() if isinstance(val, bool) else str(val)
            conn.execute(
                """
                INSERT INTO system_settings (key, value, category, label, description, data_type, updated_at, updated_by)
                VALUES (?, ?, 'custom', ?, '', 'string', ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at,
                    updated_by = excluded.updated_by
                """,
                (key, str_val, key.replace("_", " ").title(), now_ts, user)
            )
        conn.commit()
        log_audit_event(user, "UPDATE_SETTINGS", "settings", "SYSTEM_CONFIG", f"Updated {len(updates)} site configuration settings")
        return True
    finally:
        conn.close()


def reset_settings_to_defaults(user: str) -> bool:
    """Reset all settings to initial enterprise defaults."""
    conn = get_auth_connection()
    try:
        conn.execute("DELETE FROM system_settings")
        conn.commit()
        init_auth_db()
        log_audit_event(user, "RESET_SETTINGS", "settings", "SYSTEM_CONFIG", "Reset system configuration to Milky Mist enterprise defaults")
        return True
    finally:
        conn.close()


# ==============================================================================
# Payroll & Salary Slip Management Functions
# ==============================================================================

def get_payroll_records(month_year: Optional[str] = None, department: Optional[str] = None) -> List[Dict[str, Any]]:
    """Retrieve monthly payroll records filtered by month and department."""
    conn = get_auth_connection()
    try:
        target_month = month_year or datetime.now().strftime("%Y-%m")
        query = "SELECT * FROM payroll_records WHERE month_year = ?"
        params = [target_month]
        if department:
            query += " AND department = ?"
            params.append(department)
        query += " ORDER BY emp_id ASC"
        rows = conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_payroll_stats(month_year: Optional[str] = None) -> Dict[str, Any]:
    """Calculate aggregate payroll payout and deductions for a given month."""
    conn = get_auth_connection()
    try:
        target_month = month_year or datetime.now().strftime("%Y-%m")
        row = conn.execute(
            """
            SELECT 
                COUNT(*) as total_staff,
                COALESCE(SUM(net_salary), 0) as total_disbursed,
                COALESCE(SUM(lop_deduction), 0) as total_lop_deductions,
                COALESCE(SUM(plant_allowance + shift_allowance), 0) as total_allowances,
                COALESCE(SUM(pf_deduction + esi_deduction), 0) as total_statutory_deductions
            FROM payroll_records 
            WHERE month_year = ?
            """,
            (target_month,),
        ).fetchone()

        res = dict(row) if row else {
            "total_staff": 0, "total_disbursed": 0, "total_lop_deductions": 0,
            "total_allowances": 0, "total_statutory_deductions": 0
        }
        res["month_year"] = target_month
        return res
    finally:
        conn.close()


def generate_monthly_payroll(month_year: str, user: str) -> Dict[str, Any]:
    """
    Automate monthly payroll calculation driven by actual employee attendance records:
    - Calculates Loss of Pay (LOP) for absent days
    - Adds Night Shift C allowances (₹200 per night shift worked)
    - Computes PF (12%) and ESI (0.75%) deductions
    """
    conn = get_auth_connection()
    try:
        now_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        employees = conn.execute("SELECT emp_id, name, department, designation, location FROM employees WHERE status != 'Inactive'").fetchall()

        base_salaries = {
            "Lead": 65000,
            "Manager": 75000,
            "Engineer": 48000,
            "Technician": 32000,
            "Officer": 42000,
            "Executive": 38000,
            "Operator": 28000,
        }

        generated_count = 0
        total_payout = 0.0

        for emp in employees:
            sal_base = 35000
            for title, amt in base_salaries.items():
                if title.lower() in emp["designation"].lower():
                    sal_base = amt
                    break

            # Calculate actual attendance metrics for this month
            # Format: 'YYYY-MM%'
            att_rows = conn.execute(
                "SELECT status, shift_name FROM attendance WHERE emp_id = ? AND att_date LIKE ?",
                (emp["emp_id"], f"{month_year}%"),
            ).fetchall()

            absent_count = sum(1 for a in att_rows if (a["status"] or "").lower() == "absent")
            night_shift_count = sum(1 for a in att_rows if "shift c" in (a["shift_name"] or "").lower() and (a["status"] or "").lower() in ("present", "late"))

            basic = round(sal_base * 0.50, 2)
            hra = round(sal_base * 0.25, 2)
            conveyance = 3000.0
            plant_allowance = 5000.0 if "perundurai" in emp["location"].lower() else 3500.0
            shift_allowance = round(night_shift_count * 200.0, 2)
            if "Processing" in emp["department"] and shift_allowance == 0:
                shift_allowance = 2400.0  # standard minimum plant floor rotation allowance

            gross = round(basic + hra + conveyance + plant_allowance + shift_allowance, 2)
            pf = round(basic * 0.12, 2)
            esi = round(gross * 0.0075, 2) if gross <= 21000 else 0.0
            lop_days = float(absent_count)
            daily_rate = round(gross / 30.0, 2)
            lop_deduction = round(lop_days * daily_rate, 2)
            net = round(gross - (pf + esi + lop_deduction), 2)
            present_days = max(0, 30 - int(lop_days))

            bank_acc = f"HDFC-0492{emp['emp_id'].replace('MM-EMP-', '8839')}"
            pf_num = f"UAN-100{emp['emp_id'].replace('MM-EMP-', '94827')}"

            conn.execute(
                """
                INSERT INTO payroll_records (
                    emp_id, emp_name, department, designation, location, month_year,
                    basic_salary, hra, conveyance, plant_allowance, shift_allowance,
                    gross_salary, pf_deduction, esi_deduction, lop_days, lop_deduction,
                    net_salary, working_days, present_days, payment_status,
                    bank_account, pf_uan, generated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(emp_id, month_year) DO UPDATE SET
                    emp_name = excluded.emp_name,
                    department = excluded.department,
                    designation = excluded.designation,
                    location = excluded.location,
                    basic_salary = excluded.basic_salary,
                    hra = excluded.hra,
                    conveyance = excluded.conveyance,
                    plant_allowance = excluded.plant_allowance,
                    shift_allowance = excluded.shift_allowance,
                    gross_salary = excluded.gross_salary,
                    pf_deduction = excluded.pf_deduction,
                    esi_deduction = excluded.esi_deduction,
                    lop_days = excluded.lop_days,
                    lop_deduction = excluded.lop_deduction,
                    net_salary = excluded.net_salary,
                    present_days = excluded.present_days,
                    generated_at = excluded.generated_at
                """,
                (
                    emp["emp_id"], emp["name"], emp["department"], emp["designation"], emp["location"], month_year,
                    basic, hra, conveyance, plant_allowance, shift_allowance,
                    gross, pf, esi, lop_days, lop_deduction,
                    net, 30, present_days, "Processed",
                    bank_acc, pf_num, now_ts
                ),
            )
            generated_count += 1
            total_payout += net

        conn.commit()
        log_audit_event(user, "GENERATE_PAYROLL", "payroll", f"PAYROLL-{month_year}", f"Generated monthly payroll ledger for {generated_count} staff (Total Payout: ₹{total_payout:,.2f})")
        return {"success": True, "count": generated_count, "month_year": month_year, "total_payout": total_payout}
    finally:
        conn.close()


def get_payslip(emp_id: str, month_year: str) -> Optional[Dict[str, Any]]:
    """Get single employee payslip detail for modal view and printing."""
    conn = get_auth_connection()
    try:
        row = conn.execute(
            "SELECT * FROM payroll_records WHERE emp_id = ? AND month_year = ?",
            (emp_id, month_year),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


# ==============================================================================
# Offer Letter & Appointment Generator Functions
# ==============================================================================

def get_offer_letters(search: Optional[str] = None) -> List[Dict[str, Any]]:
    """Retrieve all issued offer letters."""
    conn = get_auth_connection()
    try:
        query = "SELECT * FROM offer_letters"
        params = []
        if search:
            query += " WHERE candidate_name LIKE ? OR candidate_app_id LIKE ? OR designation LIKE ? OR offer_ref LIKE ?"
            s = f"%{search.strip()}%"
            params.extend([s, s, s, s])
        query += " ORDER BY id DESC"
        rows = conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_offer_letter(identifier: str) -> Optional[Dict[str, Any]]:
    """Retrieve offer letter by candidate_app_id or offer_ref."""
    conn = get_auth_connection()
    try:
        row = conn.execute(
            "SELECT * FROM offer_letters WHERE candidate_app_id = ? OR offer_ref = ?",
            (identifier, identifier),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def create_offer_letter(data: Dict[str, Any], user: str) -> Dict[str, Any]:
    """Create official Milky Mist offer letter with automated CTC component breakdown."""
    conn = get_auth_connection()
    try:
        now_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        candidate_app_id = data.get("candidate_app_id", "APP-UNKNOWN")
        candidate_name = data.get("candidate_name", "Candidate")
        candidate_email = data.get("candidate_email", "")
        candidate_phone = data.get("candidate_phone", "")
        designation = data.get("designation", "Dairy Specialist")
        department = data.get("department", "Dairy Processing & Production")
        plant_location = data.get("plant_location", "Perundurai Mega Plant (HQ)")
        joining_date = data.get("joining_date", (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d"))
        ctc_annual = float(data.get("ctc_annual", 480000.0))

        # Monthly breakdown
        monthly_gross = round(ctc_annual / 12.0, 2)
        basic_monthly = round(monthly_gross * 0.50, 2)
        hra_monthly = round(monthly_gross * 0.25, 2)
        plant_allowance_monthly = round(monthly_gross * 0.15, 2)
        pf_monthly = round(basic_monthly * 0.12, 2)
        net_monthly = round(monthly_gross - pf_monthly, 2)
        employment_type = data.get("employment_type", "Permanent")
        notes = data.get("notes", "")

        # Generate unique reference
        count = conn.execute("SELECT COUNT(*) as c FROM offer_letters").fetchone()["c"] + 101
        offer_ref = f"MM/HR/OFFER/2026/{String_pad if 'String_pad' in dir() else str(count).zfill(4)}"

        conn.execute(
            """
            INSERT INTO offer_letters (
                offer_ref, candidate_app_id, candidate_name, candidate_email, candidate_phone,
                designation, department, plant_location, joining_date,
                ctc_annual, monthly_gross, basic_monthly, hra_monthly, plant_allowance_monthly,
                pf_monthly, net_monthly, employment_type, offer_status, notes, created_by, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                offer_ref, candidate_app_id, candidate_name, candidate_email, candidate_phone,
                designation, department, plant_location, joining_date,
                ctc_annual, monthly_gross, basic_monthly, hra_monthly, plant_allowance_monthly,
                pf_monthly, net_monthly, employment_type, "Issued", notes, user, now_ts
            ),
        )
        conn.commit()

        # Update candidate status notes in candidate db if candidate exists
        log_audit_event(user, "GENERATE_OFFER_LETTER", "offer_letter", candidate_app_id, f"Generated offer letter {offer_ref} for {candidate_name} ({designation}, CTC: ₹{ctc_annual:,.0f})")

        return {
            "offer_ref": offer_ref,
            "candidate_app_id": candidate_app_id,
            "candidate_name": candidate_name,
            "designation": designation,
            "department": department,
            "plant_location": plant_location,
            "joining_date": joining_date,
            "ctc_annual": ctc_annual,
            "monthly_gross": monthly_gross,
            "basic_monthly": basic_monthly,
            "hra_monthly": hra_monthly,
            "plant_allowance_monthly": plant_allowance_monthly,
            "pf_monthly": pf_monthly,
            "net_monthly": net_monthly,
            "employment_type": employment_type,
            "offer_status": "Issued",
            "created_at": now_ts,
        }
    finally:
        conn.close()


def update_offer_status(offer_id: int, status: str, user: str) -> bool:
    """Update status of an issued offer letter (Issued, Accepted, Declined)."""
    conn = get_auth_connection()
    try:
        conn.execute("UPDATE offer_letters SET offer_status = ? WHERE id = ?", (status, offer_id))
        conn.commit()
        log_audit_event(user, "UPDATE_OFFER_STATUS", "offer_letter", str(offer_id), f"Updated offer letter status to {status}")
        return True
    finally:
        conn.close()


def get_candidate_offer_status(candidate_app_id: str) -> Optional[Dict[str, Any]]:
    """Check if candidate already has an issued official offer letter."""
    conn = get_auth_connection()
    try:
        row = conn.execute(
            "SELECT * FROM offer_letters WHERE candidate_app_id = ? ORDER BY id DESC LIMIT 1",
            (candidate_app_id,)
        ).fetchone()
        if not row:
            return None
        return dict(row)
    finally:
        conn.close()


# ==============================================================================
# Leave & Time-Off Management Functions
# ==============================================================================

def get_leave_balances(emp_id: Optional[str] = None, year: int = 2026) -> List[Dict[str, Any]]:
    """Retrieve staff leave balances and remaining quotas."""
    conn = get_auth_connection()
    try:
        query = "SELECT * FROM leave_balances WHERE year = ?"
        params = [year]
        if emp_id:
            query += " AND emp_id = ?"
            params.append(emp_id)
        query += " ORDER BY emp_id ASC"

        rows = conn.execute(query, tuple(params)).fetchall()
        results = []
        for r in rows:
            d = dict(r)
            d["cl_left"] = max(0.0, d["cl_quota"] - d["cl_used"])
            d["sl_left"] = max(0.0, d["sl_quota"] - d["sl_used"])
            d["el_left"] = max(0.0, d["el_quota"] - d["el_used"])
            d["total_quota"] = d["cl_quota"] + d["sl_quota"] + d["el_quota"] + d["comp_off"]
            d["total_used"] = d["cl_used"] + d["sl_used"] + d["el_used"]
            d["total_left"] = d["cl_left"] + d["sl_left"] + d["el_left"] + d["comp_off"]
            results.append(d)
        return results
    finally:
        conn.close()


def get_leave_requests(
    status: Optional[str] = None,
    emp_id: Optional[str] = None,
    search: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Retrieve leave requests with optional filters."""
    conn = get_auth_connection()
    try:
        query = "SELECT * FROM leave_requests WHERE 1=1"
        params = []

        if status and status.lower() != "all":
            query += " AND LOWER(status) = LOWER(?)"
            params.append(status)

        if emp_id:
            query += " AND emp_id = ?"
            params.append(emp_id)

        if search:
            s = f"%{search.strip().lower()}%"
            query += " AND (LOWER(emp_name) LIKE ? OR LOWER(emp_id) LIKE ? OR LOWER(leave_id) LIKE ? OR LOWER(department) LIKE ?)"
            params.extend([s, s, s, s])

        query += " ORDER BY id DESC"
        rows = conn.execute(query, tuple(params)).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_leave_stats(year: int = 2026) -> Dict[str, Any]:
    """Calculate leave telemetry metrics: pending, approved, and staff on leave today."""
    conn = get_auth_connection()
    try:
        today_str = datetime.now().strftime("%Y-%m-%d")

        total = conn.execute("SELECT COUNT(*) as cnt FROM leave_requests").fetchone()["cnt"]
        pending = conn.execute("SELECT COUNT(*) as cnt FROM leave_requests WHERE status = 'Pending'").fetchone()["cnt"]
        approved = conn.execute("SELECT COUNT(*) as cnt FROM leave_requests WHERE status = 'Approved'").fetchone()["cnt"]

        # Staff on leave today (Approved leaves where today is between start_date and end_date)
        on_leave_today = conn.execute(
            """
            SELECT COUNT(DISTINCT emp_id) as cnt FROM leave_requests
            WHERE status = 'Approved' AND ? BETWEEN start_date AND end_date
            """,
            (today_str,)
        ).fetchone()["cnt"]

        # Sum of approved days
        days_row = conn.execute(
            "SELECT COALESCE(SUM(days_count), 0.0) as total_days FROM leave_requests WHERE status = 'Approved'"
        ).fetchone()
        total_days = days_row["total_days"] if days_row else 0.0

        return {
            "total_requests": total,
            "pending_count": pending,
            "approved_count": approved,
            "on_leave_today": on_leave_today,
            "total_days_approved": total_days,
            "today": today_str
        }
    finally:
        conn.close()


def create_leave_request(
    emp_id: str,
    leave_type: str,
    start_date: str,
    end_date: str,
    days_count: float,
    reason: str,
    handover_to: str,
    requested_by: str
) -> Dict[str, Any]:
    """Submit a formal employee leave request."""
    conn = get_auth_connection()
    try:
        # Find employee
        emp = conn.execute("SELECT emp_id, name, department FROM employees WHERE emp_id = ?", (emp_id,)).fetchone()
        if not emp:
            raise ValueError(f"Employee {emp_id} not found in directory.")

        now_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        count_row = conn.execute("SELECT COUNT(*) as cnt FROM leave_requests").fetchone()
        next_num = (count_row["cnt"] if count_row else 0) + 101
        leave_id = f"LV-2026-{next_num:04d}"

        conn.execute(
            """
            INSERT INTO leave_requests (
                leave_id, emp_id, emp_name, department, leave_type,
                start_date, end_date, days_count, reason, handover_to,
                status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?)
            """,
            (
                leave_id, emp["emp_id"], emp["name"], emp["department"], leave_type,
                start_date, end_date, days_count, reason, handover_to, now_ts
            )
        )
        conn.commit()
        log_audit_event(requested_by, "APPLY_LEAVE", "leave_request", leave_id, f"Submitted {leave_type} ({days_count} days) for {emp['name']}")
        return {
            "success": True,
            "leave_id": leave_id,
            "emp_name": emp["name"],
            "days_count": days_count,
            "status": "Pending"
        }
    finally:
        conn.close()


def update_leave_status(
    leave_id: str,
    status: str,
    admin_notes: str,
    action_user: str
) -> Dict[str, Any]:
    """Approve or Reject a formal employee leave request."""
    conn = get_auth_connection()
    try:
        req = conn.execute("SELECT * FROM leave_requests WHERE leave_id = ?", (leave_id,)).fetchone()
        if not req:
            raise ValueError(f"Leave request {leave_id} not found.")

        now_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        new_status = "Approved" if status.lower() == "approved" else "Rejected"

        conn.execute(
            """
            UPDATE leave_requests
            SET status = ?, admin_notes = ?, approved_by = ?, approved_at = ?
            WHERE leave_id = ?
            """,
            (new_status, admin_notes, action_user, now_ts, leave_id)
        )

        if new_status == "Approved":
            # 1. Deduct leave quota from leave_balances
            lt = req["leave_type"].lower()
            days = float(req["days_count"])
            emp_id = req["emp_id"]

            if "casual" in lt or "cl" in lt:
                conn.execute("UPDATE leave_balances SET cl_used = cl_used + ?, updated_at = ? WHERE emp_id = ? AND year = 2026", (days, now_ts, emp_id))
            elif "sick" in lt or "sl" in lt:
                conn.execute("UPDATE leave_balances SET sl_used = sl_used + ?, updated_at = ? WHERE emp_id = ? AND year = 2026", (days, now_ts, emp_id))
            elif "earned" in lt or "el" in lt:
                conn.execute("UPDATE leave_balances SET el_used = el_used + ?, updated_at = ? WHERE emp_id = ? AND year = 2026", (days, now_ts, emp_id))

            # 2. Sync to attendance table: mark days as 'leave'
            try:
                s_dt = datetime.strptime(req["start_date"], "%Y-%m-%d")
                e_dt = datetime.strptime(req["end_date"], "%Y-%m-%d")
                curr = s_dt
                while curr <= e_dt:
                    d_str = curr.strftime("%Y-%m-%d")
                    # Check if attendance row exists
                    existing = conn.execute("SELECT id FROM attendance WHERE emp_id = ? AND att_date = ?", (emp_id, d_str)).fetchone()
                    leave_note = f"Approved {req['leave_type']} ({leave_id})"
                    if existing:
                        conn.execute("UPDATE attendance SET status = 'leave', notes = ?, marked_by = ? WHERE id = ?", (leave_note, action_user, existing["id"]))
                    else:
                        conn.execute(
                            """
                            INSERT INTO attendance (emp_id, emp_name, att_date, status, shift_name, check_in_time, location, notes, marked_by, created_at)
                            VALUES (?, ?, ?, 'leave', 'General Shift', '--', 'Perundurai Mega Plant (HQ)', ?, ?, ?)
                            """,
                            (emp_id, req["emp_name"], d_str, leave_note, action_user, now_ts)
                        )
                    curr += timedelta(days=1)
            except Exception as e:
                print(f"Error syncing attendance for leave {leave_id}: {e}")

        conn.commit()
        log_audit_event(action_user, f"LEAVE_{new_status.upper()}", "leave_request", leave_id, f"{new_status} leave for {req['emp_name']} ({req['days_count']}d)")
        return {"success": True, "leave_id": leave_id, "status": new_status}
    finally:
        conn.close()


# ==============================================================================
# Recruitment Pipeline, Stage Checklists & Workflow Management
# ==============================================================================

DEFAULT_RECRUITMENT_STAGES = [
    "Willingness",
    "Interview",
    "Salary Negotiation",
    "Offer Letter",
    "Joining Date"
]


def get_recruitment_workflow_stages() -> List[str]:
    """Retrieve the active recruitment workflow stages list."""
    conn = get_auth_connection()
    try:
        row = conn.execute("SELECT value FROM system_settings WHERE key = 'recruitment_workflow_stages'").fetchone()
        if row and row["value"]:
            try:
                stages = json.loads(row["value"])
                if isinstance(stages, list) and len(stages) > 0:
                    return [str(s).strip() for s in stages if str(s).strip()]
            except Exception:
                pass
        return list(DEFAULT_RECRUITMENT_STAGES)
    finally:
        conn.close()


def save_recruitment_workflow_stages(stages: List[str], user: str = "admin123") -> List[str]:
    """Save updated recruitment workflow stages and log audit event."""
    clean_stages = [str(s).strip() for s in stages if str(s).strip()]
    if not clean_stages:
        clean_stages = list(DEFAULT_RECRUITMENT_STAGES)

    now_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn = get_auth_connection()
    try:
        conn.execute(
            """
            INSERT INTO system_settings (key, value, category, label, description, data_type, updated_at, updated_by)
            VALUES ('recruitment_workflow_stages', ?, 'recruitment', 'Recruitment Workflow Stages', 'Active recruitment pipeline stages list', 'json', ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at,
                updated_by = excluded.updated_by
            """,
            (json.dumps(clean_stages), now_ts, user)
        )
        conn.commit()
        log_audit_event(user, "UPDATE_WORKFLOW", "settings", "RECRUITMENT_WORKFLOW", f"Updated recruitment workflow stages ({len(clean_stages)} stages: {', '.join(clean_stages)})")
        return clean_stages
    finally:
        conn.close()


def get_candidate_pipeline_dict() -> Dict[str, Dict[str, Any]]:
    """Retrieve mapping of candidate application IDs to pipeline records."""
    conn = get_auth_connection()
    try:
        rows = conn.execute("SELECT * FROM candidate_pipeline").fetchall()
        res = {}
        for r in rows:
            row_dict = dict(r)
            try:
                row_dict["completed_stages"] = json.loads(row_dict.get("completed_stages") or "[]")
            except Exception:
                row_dict["completed_stages"] = []
            try:
                c_st = row_dict.get("custom_stages")
                row_dict["custom_stages"] = json.loads(c_st) if c_st else None
            except Exception:
                row_dict["custom_stages"] = None
            res[row_dict["app_id"]] = row_dict
        return res
    finally:
        conn.close()


def get_candidate_workflow_stages(app_id: str) -> List[str]:
    """Retrieve stages for a candidate (custom if set, otherwise global default)."""
    conn = get_auth_connection()
    try:
        row = conn.execute("SELECT custom_stages FROM candidate_pipeline WHERE app_id = ?", (app_id,)).fetchone()
        if row and row["custom_stages"]:
            try:
                custom = json.loads(row["custom_stages"])
                if isinstance(custom, list) and len(custom) > 0:
                    return [str(s).strip() for s in custom if str(s).strip()]
            except Exception:
                pass
        return get_recruitment_workflow_stages()
    finally:
        conn.close()


def save_candidate_custom_workflow(app_id: str, stages: Optional[List[str]], user: str = "admin123") -> List[str]:
    """
    Save or reset custom workflow stages for an individual candidate.
    If stages is None or empty, candidate resets to standard global workflow.
    """
    conn = get_auth_connection()
    try:
        row = conn.execute("SELECT * FROM candidate_pipeline WHERE app_id = ?", (app_id,)).fetchone()
        if not row:
            raise ValueError(f"Candidate {app_id} not found in pipeline.")

        completed_stages = []
        try:
            completed_stages = json.loads(row["completed_stages"] or "[]")
        except Exception:
            completed_stages = []

        rec_status = row["recruitment_status"] or "on_hold"

        clean_stages = [str(s).strip() for s in (stages or []) if str(s).strip()]
        custom_stages_val = json.dumps(clean_stages) if clean_stages else None
        active_stages = clean_stages if clean_stages else get_recruitment_workflow_stages()

        # Prune completed stages that are no longer part of candidate's stages
        pruned_completed = [s for s in completed_stages if s in active_stages]

        now_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        conn.execute(
            """
            UPDATE candidate_pipeline
            SET custom_stages = ?, completed_stages = ?, updated_at = ?, updated_by = ?
            WHERE app_id = ?
            """,
            (custom_stages_val, json.dumps(pruned_completed), now_ts, user, app_id)
        )
        conn.commit()

        desc = f"Set custom workflow ({len(active_stages)} stages: {', '.join(active_stages)})" if custom_stages_val else "Reset workflow to standard defaults"
        log_audit_event(user, "UPDATE_CANDIDATE_WORKFLOW", "candidate", app_id, f"{desc} for candidate {app_id}")
        return active_stages
    finally:
        conn.close()


def update_candidate_pipeline_stage(app_id: str, stage_name: str, completed: bool, user: str = "admin123") -> Dict[str, Any]:
    """Check or uncheck a workflow stage for an approved candidate in the recruitment pipeline."""
    clean_stage = str(stage_name).strip()
    conn = get_auth_connection()
    try:
        row = conn.execute("SELECT * FROM candidate_pipeline WHERE app_id = ?", (app_id,)).fetchone()
        stages_list = []
        rec_status = "on_hold"
        onboarded_emp_id = ""
        onboarded_at = ""

        if row:
            rec_status = row["recruitment_status"] or "on_hold"
            onboarded_emp_id = row["onboarded_emp_id"] or ""
            onboarded_at = row["onboarded_at"] or ""
            try:
                stages_list = json.loads(row["completed_stages"] or "[]")
            except Exception:
                stages_list = []

        all_stages = get_candidate_workflow_stages(app_id)
        if clean_stage not in all_stages:
            raise ValueError(f"Stage '{clean_stage}' is not a valid workflow stage for candidate {app_id}.")

        stage_idx = all_stages.index(clean_stage)

        if completed:
            # Enforce sequential completion: all prior stages must already be completed
            for prev_idx in range(stage_idx):
                prior_stage = all_stages[prev_idx]
                if prior_stage not in stages_list:
                    raise ValueError(f"Cannot complete '{clean_stage}' before completing prior stage '{prior_stage}'.")
            if clean_stage not in stages_list:
                stages_list.append(clean_stage)
            if rec_status == "on_hold":
                rec_status = "in_progress"
        else:
            # Unchecking a stage: remove it AND cascade remove any subsequent stages
            if clean_stage in stages_list:
                stages_list.remove(clean_stage)
            for next_idx in range(stage_idx + 1, len(all_stages)):
                subsequent_stage = all_stages[next_idx]
                if subsequent_stage in stages_list:
                    stages_list.remove(subsequent_stage)
            if rec_status == "ready_to_onboard":
                rec_status = "in_progress"

        completed_count = sum(1 for s in all_stages if s in stages_list)
        total_stages = len(all_stages)

        if completed_count == total_stages and total_stages > 0 and rec_status not in ("onboarded", "ready_to_onboard"):
            rec_status = "ready_to_onboard"

        now_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        conn.execute(
            """
            INSERT INTO candidate_pipeline (app_id, recruitment_status, completed_stages, onboarded_emp_id, onboarded_at, updated_at, updated_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(app_id) DO UPDATE SET
                recruitment_status = excluded.recruitment_status,
                completed_stages = excluded.completed_stages,
                updated_at = excluded.updated_at,
                updated_by = excluded.updated_by
            """,
            (app_id, rec_status, json.dumps(stages_list), onboarded_emp_id, onboarded_at, now_ts, user)
        )
        conn.commit()

        action_str = "Checked" if completed else "Unchecked"
        log_audit_event(user, "PIPELINE_STAGE_UPDATE", "candidate", app_id, f"{action_str} stage '{clean_stage}' for candidate {app_id}")

        progress_pct = round((completed_count / total_stages) * 100) if total_stages > 0 else 0
        return {
            "app_id": app_id,
            "stage": clean_stage,
            "completed": completed,
            "recruitment_status": rec_status,
            "completed_stages": stages_list,
            "completed_count": completed_count,
            "total_stages": total_stages,
            "progress_percent": progress_pct
        }
    finally:
        conn.close()


def update_candidate_pipeline_status(app_id: str, new_status: str, user: str = "admin123") -> bool:
    """Manually update a candidate's recruitment status (e.g. 'on_hold', 'in_progress', 'ready_to_onboard', 'onboarded', 'rejected', 'dropped')."""
    valid_statuses = ("on_hold", "in_progress", "ready_to_onboard", "onboarded", "dropped", "rejected")
    if new_status not in valid_statuses:
        raise ValueError(f"Invalid recruitment status: {new_status}")

    # If rejected, move candidate out of pipeline into Rejected Applications
    if new_status == "rejected":
        from services.db import update_candidate_status
        update_candidate_status(app_id, "rejected", notes=f"Rejected from Recruitment Pipeline by {user}")
        conn = get_auth_connection()
        try:
            conn.execute("DELETE FROM candidate_pipeline WHERE app_id = ?", (app_id,))
            conn.commit()
            log_audit_event(user, "PIPELINE_CANDIDATE_REJECTED", "candidate", app_id, f"Candidate {app_id} rejected and moved to Rejected Applications")
            return True
        finally:
            conn.close()

    now_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn = get_auth_connection()
    try:
        conn.execute(
            """
            INSERT INTO candidate_pipeline (app_id, recruitment_status, completed_stages, updated_at, updated_by)
            VALUES (?, ?, '[]', ?, ?)
            ON CONFLICT(app_id) DO UPDATE SET
                recruitment_status = excluded.recruitment_status,
                updated_at = excluded.updated_at,
                updated_by = excluded.updated_by
            """,
            (app_id, new_status, now_ts, user)
        )
        conn.commit()
        log_audit_event(user, "PIPELINE_STATUS_UPDATE", "candidate", app_id, f"Changed recruitment status of {app_id} to '{new_status}'")
        return True
    finally:
        conn.close()


def onboard_candidate_pipeline(app_id: str, employee_data: Dict[str, Any], user: str = "admin123") -> Dict[str, Any]:
    """Promote an approved candidate in the recruitment pipeline to a fully onboarded employee."""
    # 1. Create official employee record
    name = employee_data.get("name", "").strip()
    email = employee_data.get("email", "").strip()
    phone = employee_data.get("phone", "").strip()
    department = employee_data.get("department", "Dairy Processing & Production").strip()
    designation = employee_data.get("designation", "Operations Staff").strip()
    joining_date = employee_data.get("joining_date", datetime.now().strftime("%Y-%m-%d")).strip()
    employment_type = employee_data.get("employment_type", "Permanent").strip()
    location = employee_data.get("location", "Perundurai Mega Plant (HQ)").strip()

    emp = create_employee(
        name=name,
        email=email,
        phone=phone,
        department=department,
        designation=designation,
        joining_date=joining_date,
        employment_type=employment_type,
        status="Active",
        location=location,
        candidate_app_id=app_id
    )

    # 2. Update pipeline status to 'onboarded' and ensure all active stages are checked
    all_stages = get_recruitment_workflow_stages()
    now_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn = get_auth_connection()
    try:
        conn.execute(
            """
            INSERT INTO candidate_pipeline (app_id, recruitment_status, completed_stages, onboarded_emp_id, onboarded_at, updated_at, updated_by)
            VALUES (?, 'onboarded', ?, ?, ?, ?, ?)
            ON CONFLICT(app_id) DO UPDATE SET
                recruitment_status = 'onboarded',
                completed_stages = excluded.completed_stages,
                onboarded_emp_id = excluded.onboarded_emp_id,
                onboarded_at = excluded.onboarded_at,
                updated_at = excluded.updated_at,
                updated_by = excluded.updated_by
            """,
            (app_id, json.dumps(all_stages), emp["emp_id"], now_ts, now_ts, user)
        )
        conn.commit()
        log_audit_event(user, "ONBOARD_EMPLOYEE", "employee", emp["emp_id"], f"Onboarded candidate {app_id} ({emp['name']}) as official employee {emp['emp_id']}")
        return {
            "success": True,
            "employee": emp,
            "candidate_app_id": app_id,
            "message": f"Successfully onboarded {emp['name']} as {emp['emp_id']}!"
        }
    finally:
        conn.close()


def enroll_candidate_in_recruitment(
    app_id: str,
    user: str = "admin123",
    target_role: str = "",
    department: str = "",
    assigned_recruiter: str = "",
    initial_status: str = "in_progress",
    notes: str = ""
) -> Dict[str, Any]:
    """Enroll an approved candidate from Approved Resumes into the active recruitment pipeline with designated role and recruiter."""
    from services.db import get_approved_candidates
    approved_list = get_approved_candidates()
    matched = next((c for c in approved_list if c["app_id"] == app_id), None)
    if not matched:
        raise ValueError(f"Candidate {app_id} not found in approved candidates.")

    now_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    rec_status = initial_status if initial_status in ("in_progress", "on_hold") else "in_progress"
    recruiter = (assigned_recruiter or "").strip() or user
    role = (target_role or "").strip()
    if not role:
        # Fallback to candidate education/specialization or role title
        role = "Target Position Pending"
    dept = (department or "").strip() or "General"

    conn = get_auth_connection()
    try:
        conn.execute(
            """
            INSERT INTO candidate_pipeline (
                app_id, recruitment_status, completed_stages, target_role, department, assigned_recruiter,
                recruitment_started_at, recruitment_notes, updated_at, updated_by
            )
            VALUES (?, ?, '[]', ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(app_id) DO UPDATE SET
                recruitment_status = excluded.recruitment_status,
                target_role = CASE WHEN excluded.target_role != '' THEN excluded.target_role ELSE candidate_pipeline.target_role END,
                department = CASE WHEN excluded.department != '' THEN excluded.department ELSE candidate_pipeline.department END,
                assigned_recruiter = CASE WHEN excluded.assigned_recruiter != '' THEN excluded.assigned_recruiter ELSE candidate_pipeline.assigned_recruiter END,
                recruitment_started_at = CASE WHEN candidate_pipeline.recruitment_started_at IS NULL OR candidate_pipeline.recruitment_started_at = '' THEN excluded.recruitment_started_at ELSE candidate_pipeline.recruitment_started_at END,
                recruitment_notes = CASE WHEN excluded.recruitment_notes != '' THEN excluded.recruitment_notes ELSE candidate_pipeline.recruitment_notes END,
                updated_at = excluded.updated_at,
                updated_by = excluded.updated_by
            """,
            (app_id, rec_status, role, dept, recruiter, now_ts, notes or "", now_ts, user)
        )
        conn.commit()
        log_audit_event(
            user,
            "START_RECRUITMENT",
            "candidate",
            app_id,
            f"Started recruitment for approved candidate {app_id} ({matched.get('name', '')}) -> Role: '{role}', Dept: '{dept}', Recruiter: '{recruiter}'"
        )
        return {
            "app_id": app_id,
            "recruitment_status": rec_status,
            "name": matched.get("name", ""),
            "target_role": role,
            "department": dept,
            "assigned_recruiter": recruiter,
            "recruitment_started_at": now_ts
        }
    finally:
        conn.close()


def withdraw_candidate_from_recruitment(app_id: str, user: str = "admin123") -> bool:
    """Withdraw a candidate from active recruitment pipeline back into the Approved Resumes talent pool."""
    from services.db import get_approved_candidates
    conn = get_auth_connection()
    try:
        row = conn.execute("SELECT * FROM candidate_pipeline WHERE app_id = ?", (app_id,)).fetchone()
        if not row:
            return False
        r_dict = dict(row)
        if r_dict.get("recruitment_status") == "onboarded":
            raise ValueError(f"Cannot withdraw candidate {app_id} because they have already been onboarded as an employee.")
        conn.execute("DELETE FROM candidate_pipeline WHERE app_id = ?", (app_id,))
        conn.commit()
        log_audit_event(user, "WITHDRAW_RECRUITMENT", "candidate", app_id, f"Withdrew candidate {app_id} from recruitment pipeline back to Approved Talent Pool")
        return True
    finally:
        conn.close()


def get_pipeline_candidates_with_stages(search: Optional[str] = None, status_filter: Optional[str] = None) -> Dict[str, Any]:
    """Retrieve all approved candidates enrolled in recruitment pipeline merged with their progress and stages."""
    from services.db import get_approved_candidates

    approved_list = get_approved_candidates(search=search)
    pipeline_map = get_candidate_pipeline_dict()
    all_stages = get_recruitment_workflow_stages()
    total_stages = len(all_stages)

    enriched_candidates = []
    counts = {
        "total": 0,
        "on_hold": 0,
        "in_progress": 0,
        "ready_to_onboard": 0,
        "onboarded": 0,
        "dropped": 0
    }

    for c in approved_list:
        app_id = c["app_id"]
        # Only candidates who have been passed to the active recruitment pipeline!
        if app_id not in pipeline_map:
            continue

        pipe = pipeline_map[app_id]
        rec_status = pipe.get("recruitment_status") or "on_hold"
        completed_stages = pipe.get("completed_stages") or []

        # Candidate's active workflow stages (custom if configured, otherwise standard global stages)
        c_stages = pipe.get("custom_stages") or all_stages
        c_total_stages = len(c_stages)

        # Count active workflow stages completed for this candidate
        completed_count = sum(1 for s in c_stages if s in completed_stages)
        progress_pct = round((completed_count / c_total_stages) * 100) if c_total_stages > 0 else 0

        # Build interactive checklist objects
        stages_checklist = [
            {"name": s, "completed": (s in completed_stages)}
            for s in c_stages
        ]

        counts["total"] += 1
        if rec_status in counts:
            counts[rec_status] += 1

        # Check filter
        if status_filter and status_filter.lower() != "all" and rec_status.lower() != status_filter.lower():
            continue

        c_copy = dict(c)
        c_copy["recruitment_status"] = rec_status
        c_copy["stages"] = c_stages
        c_copy["custom_stages"] = pipe.get("custom_stages")
        c_copy["has_custom_workflow"] = bool(pipe.get("custom_stages"))
        c_copy["completed_stages"] = completed_stages
        c_copy["completed_count"] = completed_count
        c_copy["total_stages"] = c_total_stages
        c_copy["progress_percent"] = progress_pct
        c_copy["progress_pct"] = progress_pct
        c_copy["stages_checklist"] = stages_checklist
        c_copy["onboarded_emp_id"] = pipe.get("onboarded_emp_id") or ""
        c_copy["onboarded_at"] = pipe.get("onboarded_at") or ""
        c_copy["target_role"] = pipe.get("target_role") or ""
        c_copy["department"] = pipe.get("department") or ""
        c_copy["assigned_recruiter"] = pipe.get("assigned_recruiter") or ""
        c_copy["recruitment_started_at"] = pipe.get("recruitment_started_at") or ""
        c_copy["recruitment_notes"] = pipe.get("recruitment_notes") or ""
        enriched_candidates.append(c_copy)

    return {
        "candidates": enriched_candidates,
        "stages": all_stages,
        "counts": counts
    }


# Initialize database on module import
init_auth_db()





