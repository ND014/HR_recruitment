"""
Database service layer for candidate applications:
- Active Pipeline: candidates.db
- Approved: approved_candidates.db
- Rejected: rejected_candidates.db

Document Directories:
- uploads/resumes/active/
- uploads/resumes/approved/
- uploads/resumes/rejected/
"""

import os
import re
import json
import shutil
import sqlite3
from datetime import datetime, date, timedelta
from typing import Optional, List, Dict, Any

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Database paths
ACTIVE_DB_PATH = os.path.join(BASE_DIR, "candidates.db")
APPROVED_DB_PATH = os.path.join(BASE_DIR, "approved_candidates.db")
REJECTED_DB_PATH = os.path.join(BASE_DIR, "rejected_candidates.db")

# Upload Document paths
UPLOADS_BASE_DIR = os.path.join(BASE_DIR, "uploads", "resumes")
UPLOADS_DIR = UPLOADS_BASE_DIR
UPLOADS_ACTIVE_DIR = os.path.join(UPLOADS_BASE_DIR, "active")
UPLOADS_APPROVED_DIR = os.path.join(UPLOADS_BASE_DIR, "approved")
UPLOADS_REJECTED_DIR = os.path.join(UPLOADS_BASE_DIR, "rejected")

for d in (UPLOADS_ACTIVE_DIR, UPLOADS_APPROVED_DIR, UPLOADS_REJECTED_DIR):
    os.makedirs(d, exist_ok=True)

# Lifecycle rules
REJECTED_GRACE_DAYS = 10          # 10 days: stays on active view before auto-archiving


def get_db_connection(db_path: str) -> sqlite3.Connection:
    """Connect to SQLite database with Row factory and WAL mode."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    """Initialize active, approved, and rejected candidate database tables."""
    create_table_sql = """
        CREATE TABLE IF NOT EXISTS candidates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            app_id TEXT UNIQUE NOT NULL,
            created_at TEXT NOT NULL,
            status_updated_at TEXT DEFAULT '',
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            dob TEXT NOT NULL,
            age TEXT DEFAULT '',
            location TEXT NOT NULL,
            phone TEXT NOT NULL,
            education TEXT DEFAULT '',
            work_experience TEXT DEFAULT '',
            resume_filename TEXT DEFAULT '',
            resume_path TEXT DEFAULT '',
            status TEXT DEFAULT 'pending'
                CHECK(status IN ('pending', 'shortlisted', 'rejected')),
            admin_notes TEXT DEFAULT '',
            archived_at TEXT DEFAULT ''
        )
    """
    for db_path in (ACTIVE_DB_PATH, APPROVED_DB_PATH, REJECTED_DB_PATH):
        conn = get_db_connection(db_path)
        conn.execute(create_table_sql)
        # Ensure new columns exist if table was created under old schema
        cursor = conn.execute("PRAGMA table_info(candidates)")
        existing_cols = {row["name"] for row in cursor.fetchall()}
        if "status_updated_at" not in existing_cols:
            conn.execute("ALTER TABLE candidates ADD COLUMN status_updated_at TEXT DEFAULT ''")
        if "archived_at" not in existing_cols:
            conn.execute("ALTER TABLE candidates ADD COLUMN archived_at TEXT DEFAULT ''")
        conn.commit()
        conn.close()

    # One-time data cleanup: ensure approved candidates do not duplicate in active DB
    if os.path.exists(APPROVED_DB_PATH) and os.path.exists(ACTIVE_DB_PATH):
        try:
            conn_app = get_db_connection(APPROVED_DB_PATH)
            appr_ids = [r["app_id"] for r in conn_app.execute("SELECT app_id FROM candidates").fetchall()]
            conn_app.close()
            if appr_ids:
                conn_act = get_db_connection(ACTIVE_DB_PATH)
                placeholders = ",".join("?" for _ in appr_ids)
                conn_act.execute(f"DELETE FROM candidates WHERE app_id IN ({placeholders})", appr_ids)
                conn_act.commit()
                conn_act.close()
        except Exception:
            pass


def move_document_file(current_path: str, target_dir: str) -> str:
    """
    Move resume document to target directory and return the updated absolute path.
    Guarantees documents are moved whenever candidate status changes.
    """
    if not current_path or not os.path.exists(current_path):
        return current_path

    filename = os.path.basename(current_path)
    new_path = os.path.join(target_dir, filename)

    if os.path.abspath(current_path) == os.path.abspath(new_path):
        return new_path

    try:
        if os.path.exists(new_path):
            os.remove(new_path)
        shutil.move(current_path, new_path)
        return new_path
    except Exception as e:
        print(f"Error moving resume document '{filename}': {e}")
        return current_path


def calculate_age(dob_date: date) -> int:
    """Calculate age in completed years from Date of Birth."""
    today = date.today()
    return today.year - dob_date.year - (
        (today.month, today.day) < (dob_date.month, dob_date.day)
    )


def format_work_experience(exp_input: Any) -> str:
    """Format work experience with calculated durations."""
    if not exp_input:
        return "Fresher / No prior experience"

    data = exp_input
    if isinstance(exp_input, str):
        try:
            data = json.loads(exp_input)
        except Exception:
            return exp_input.strip()

    if isinstance(data, list):
        if not data:
            return "Fresher / No prior experience"
        lines = []
        for i, item in enumerate(data, start=1):
            if isinstance(item, dict):
                role = item.get("role", "").strip() or "Role not specified"
                company = item.get("company", "").strip() or "Company not specified"
                duration = item.get("duration", "").strip()
                details = item.get("details", "").strip()

                header = f"{i}. {role} at {company}"
                if duration:
                    header += f" ({duration})"
                lines.append(header)

                if details:
                    for d_line in details.split("\n"):
                        clean_d = d_line.strip().lstrip("-•* ")
                        if clean_d:
                            lines.append(f"   • {clean_d}")
            else:
                lines.append(f"{i}. {str(item).strip()}")
        return "\n".join(lines)

    return str(data).strip()


def _get_next_app_id() -> str:
    """
    Generate the sequential application ID in format dd-mm-yy/000x
    where x starts from 1 and increments as a 4-digit number (0001, 0002, ...) for each day.
    """
    today_prefix = datetime.now().strftime("%d-%m-%y")  # e.g., '08-10-26'
    max_seq = 0
    pattern = re.compile(rf"^{re.escape(today_prefix)}/(\d+)$")

    for db_path in (ACTIVE_DB_PATH, APPROVED_DB_PATH, REJECTED_DB_PATH):
        if os.path.exists(db_path):
            conn = get_db_connection(db_path)
            try:
                rows = conn.execute("SELECT app_id FROM candidates").fetchall()
                for r in rows:
                    app_id = r["app_id"] or ""
                    m = pattern.match(app_id)
                    if m:
                        max_seq = max(max_seq, int(m.group(1)))
            finally:
                conn.close()

    return f"{today_prefix}/{max_seq + 1:04d}"


def normalize_phone(phone: str) -> str:
    """Normalize phone number to digits only, taking the last 10 digits for comparison."""
    digits = re.sub(r"\D", "", phone or "")
    if len(digits) > 10:
        return digits[-10:]
    return digits


def find_existing_candidate(phone: str, email: str = "") -> Optional[Dict[str, Any]]:
    """
    Search across all databases (active, approved, rejected) to check
    if an application with the same mobile number (or email) already exists.
    """
    clean_target_phone = normalize_phone(phone)
    clean_target_email = email.strip().lower() if email else ""

    for db_path in (ACTIVE_DB_PATH, APPROVED_DB_PATH, REJECTED_DB_PATH):
        if os.path.exists(db_path):
            conn = get_db_connection(db_path)
            try:
                rows = conn.execute("SELECT app_id, name, email, phone, status, created_at FROM candidates").fetchall()
                for r in rows:
                    c_phone = normalize_phone(r["phone"])
                    c_email = (r["email"] or "").strip().lower()

                    if clean_target_phone and c_phone and c_phone == clean_target_phone:
                        return dict(r)
                    if clean_target_email and c_email and c_email == clean_target_email:
                        return dict(r)
            finally:
                conn.close()
    return None


def save_candidate(
    name: str,
    email: str,
    dob_str: str,
    location: str,
    phone: str,
    education: str,
    work_experience: str,
    resume_bytes: Optional[bytes] = None,
    resume_filename: Optional[str] = None,
) -> Dict[str, Any]:
    """Insert a new candidate application into active database and active resumes folder."""
    clean_phone = normalize_phone(phone)
    clean_email = email.strip().lower() if email else ""

    existing = find_existing_candidate(phone=phone, email=email)
    if existing:
        ex_phone = normalize_phone(existing["phone"])
        ex_email = (existing["email"] or "").strip().lower()

        phone_matched = bool(clean_phone and ex_phone == clean_phone)
        email_matched = bool(clean_email and ex_email == clean_email)

        if phone_matched and email_matched:
            matched_by = "mobile number and email address"
        elif phone_matched:
            matched_by = "mobile number"
        else:
            matched_by = "email address"

        raise ValueError(
            f"Application already submitted! An application with this {matched_by} has already been received (#{existing['app_id']}). Only 1 application per applicant is permitted."
        )
    parsed_dob = None
    clean_dob = dob_str.strip()

    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y"):
        try:
            parsed_dob = datetime.strptime(dob_str.strip(), fmt).date()
            clean_dob = parsed_dob.strftime("%Y-%m-%d")
            break
        except ValueError:
            pass

    age_display = f"{calculate_age(parsed_dob)} years" if parsed_dob else "N/A"
    formatted_exp = format_work_experience(work_experience)

    saved_filename = ""
    saved_path = ""

    if resume_bytes and resume_filename:
        safe_name = re.sub(r"[^A-Za-z0-9_-]", "_", name.strip())
        time_tag = datetime.now().strftime("%Y%m%d_%H%M%S")
        ext = os.path.splitext(resume_filename)[1].lower() or ".pdf"
        target_name = f"{safe_name}_{time_tag}{ext}"
        target_path = os.path.join(UPLOADS_ACTIVE_DIR, target_name)

        with open(target_path, "wb") as f:
            f.write(resume_bytes)

        saved_filename = target_name
        saved_path = target_path

    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    conn = get_db_connection(ACTIVE_DB_PATH)
    try:
        app_id = _get_next_app_id()
        conn.execute(
            """
            INSERT INTO candidates
                (app_id, created_at, status_updated_at, name, email, dob, age, location, phone,
                 education, work_experience, resume_filename, resume_path, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
            """,
            (
                app_id, timestamp, timestamp, name.strip(), email.strip(),
                clean_dob, age_display, location.strip(), phone.strip(),
                education.strip(), formatted_exp,
                saved_filename, saved_path,
            ),
        )
        conn.commit()
    finally:
        conn.close()

    return {
        "id": app_id,
        "timestamp": timestamp,
        "name": name.strip(),
        "email": email.strip(),
        "dob": clean_dob,
        "age": age_display,
        "location": location.strip(),
        "phone_number": phone.strip(),
        "education": education.strip(),
        "work_experience": formatted_exp,
        "resume_filename": saved_filename,
        "resume_path": saved_path,
        "status": "pending",
    }


def parse_timestamp(ts_str: str) -> Optional[datetime]:
    """Parse timestamp string into datetime object."""
    if not ts_str:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(ts_str.strip(), fmt)
        except ValueError:
            pass
    return None


def sweep_lifecycle():
    """
    Automated lifecycle sweeper:
    - Pending applications stay indefinitely in active pipeline until recruitment decision is made.
    - Rejected check: Stays on active view for 10 days. After 10 days -> moved to rejected_candidates.db.
    """
    now = datetime.now()
    now_str = now.strftime("%Y-%m-%d %H:%M:%S")

    conn_active = get_db_connection(ACTIVE_DB_PATH)
    conn_approved = get_db_connection(APPROVED_DB_PATH)
    conn_rejected = get_db_connection(REJECTED_DB_PATH)

    try:
        active_rows = conn_active.execute("SELECT * FROM candidates").fetchall()

        for row in active_rows:
            c = dict(row)
            app_id = c["app_id"]
            status = c["status"]
            created_dt = parse_timestamp(c["created_at"]) or now
            status_upd_dt = parse_timestamp(c["status_updated_at"]) or created_dt

            # ------------------------------------------------------------------
            # Rejected: 10 days grace on active view -> Move to rejected_candidates.db
            # ------------------------------------------------------------------
            if status == "rejected":
                elapsed_sec = (now - status_upd_dt).total_seconds()
                if elapsed_sec >= (REJECTED_GRACE_DAYS * 86400):
                    current_path = c["resume_path"]
                    new_doc_path = move_document_file(current_path, UPLOADS_REJECTED_DIR)

                    conn_rejected.execute(
                        """
                        INSERT OR REPLACE INTO candidates
                            (app_id, created_at, status_updated_at, name, email, dob, age,
                             location, phone, education, work_experience, resume_filename,
                             resume_path, status, admin_notes, archived_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'rejected', ?, ?)
                        """,
                        (
                            app_id, c["created_at"], c["status_updated_at"], c["name"],
                            c["email"], c["dob"], c["age"], c["location"], c["phone"],
                            c["education"], c["work_experience"], c["resume_filename"],
                            new_doc_path, c["admin_notes"], now_str,
                        ),
                    )
                    conn_rejected.commit()

                    conn_active.execute("DELETE FROM candidates WHERE app_id = ?", (app_id,))
                    conn_active.commit()
                    continue

    finally:
        conn_active.close()
        conn_approved.close()
        conn_rejected.close()


def _format_time_metadata(record: Dict[str, Any]) -> Dict[str, Any]:
    """Compute time tags (archive countdown for rejected) for frontend visualization."""
    now = datetime.now()
    created_dt = parse_timestamp(record.get("created_at", "")) or now
    status_dt = parse_timestamp(record.get("status_updated_at", "")) or created_dt
    status = record.get("status", "pending")

    rec = dict(record)
    rec["time_tag"] = ""
    rec["time_badge_class"] = ""

    # Pending applications stay indefinitely without any timer
    if status == "pending":
        rec["time_tag"] = ""
        rec["time_badge_class"] = ""

    elif status == "rejected":
        sec_left = (REJECTED_GRACE_DAYS * 86400) - (now - status_dt).total_seconds()
        if sec_left <= 0:
            rec["time_tag"] = "Archiving now"
            rec["time_badge_class"] = "tag-urgent"
        else:
            hrs_left = int(sec_left // 3600)
            if hrs_left >= 24:
                days = hrs_left // 24
                rec["time_tag"] = f"Archiving in {days}d"
                rec["time_badge_class"] = "tag-warning"
            else:
                rec["time_tag"] = f"Archiving in {max(1, hrs_left)}h"
                rec["time_badge_class"] = "tag-urgent"

    return rec


def get_all_candidates(
    status_filter: Optional[str] = None,
    search: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Retrieve active candidates. Defaults to excluding rejected candidates."""
    sweep_lifecycle()

    conn = get_db_connection(ACTIVE_DB_PATH)
    try:
        query = "SELECT * FROM candidates"
        params: list = []
        conditions: list = []

        if status_filter and status_filter != "all":
            conditions.append("status = ?")
            params.append(status_filter)
        elif not status_filter:
            # By default, do not show rejected applications in the active/pending review pipeline
            conditions.append("status != 'rejected'")

        if search:
            conditions.append(
                "(name LIKE ? OR email LIKE ? OR location LIKE ? OR phone LIKE ?)"
            )
            term = f"%{search}%"
            params.extend([term, term, term, term])

        if conditions:
            query += " WHERE " + " AND ".join(conditions)

        query += " ORDER BY id DESC"
        rows = conn.execute(query, params).fetchall()
        return [_format_time_metadata(dict(r)) for r in rows]
    finally:
        conn.close()


def get_approved_candidates(search: Optional[str] = None) -> List[Dict[str, Any]]:
    """Retrieve all approved candidates."""
    sweep_lifecycle()

    conn = get_db_connection(APPROVED_DB_PATH)
    try:
        query = "SELECT * FROM candidates"
        params: list = []
        if search:
            query += " WHERE (name LIKE ? OR email LIKE ? OR location LIKE ? OR phone LIKE ?)"
            term = f"%{search}%"
            params.extend([term, term, term, term])
        query += " ORDER BY id DESC"
        rows = conn.execute(query, params).fetchall()
        return [_format_time_metadata(dict(r)) for r in rows]
    finally:
        conn.close()


def get_rejected_candidates(search: Optional[str] = None) -> List[Dict[str, Any]]:
    """Retrieve all rejected candidates (both active 10-day grace period and archived)."""
    sweep_lifecycle()

    results: List[Dict[str, Any]] = []

    # 1. Fetch active rejected candidates from ACTIVE_DB_PATH
    if os.path.exists(ACTIVE_DB_PATH):
        conn_act = get_db_connection(ACTIVE_DB_PATH)
        try:
            query = "SELECT * FROM candidates WHERE status = 'rejected'"
            params: list = []
            if search:
                query += " AND (name LIKE ? OR email LIKE ? OR location LIKE ? OR phone LIKE ?)"
                term = f"%{search}%"
                params.extend([term, term, term, term])
            query += " ORDER BY id DESC"
            rows = conn_act.execute(query, params).fetchall()
            for r in rows:
                rec = _format_time_metadata(dict(r))
                rec["is_archived"] = False
                results.append(rec)
        finally:
            conn_act.close()

    # 2. Fetch archived rejected candidates from REJECTED_DB_PATH
    if os.path.exists(REJECTED_DB_PATH):
        conn_rej = get_db_connection(REJECTED_DB_PATH)
        try:
            query = "SELECT * FROM candidates"
            params: list = []
            if search:
                query += " WHERE (name LIKE ? OR email LIKE ? OR location LIKE ? OR phone LIKE ?)"
                term = f"%{search}%"
                params.extend([term, term, term, term])
            query += " ORDER BY id DESC"
            rows = conn_rej.execute(query, params).fetchall()
            for r in rows:
                rec = dict(r)
                rec["time_tag"] = "Archived"
                rec["time_badge_class"] = "tag-normal"
                rec["is_archived"] = True
                results.append(rec)
        finally:
            conn_rej.close()

    return results


def get_candidate(app_id: str) -> Optional[Dict[str, Any]]:
    """Get single candidate by app_id across all databases."""
    sweep_lifecycle()

    for db_path in (ACTIVE_DB_PATH, APPROVED_DB_PATH, REJECTED_DB_PATH):
        if os.path.exists(db_path):
            conn = get_db_connection(db_path)
            try:
                row = conn.execute("SELECT * FROM candidates WHERE app_id = ?", (app_id,)).fetchone()
                if row:
                    return _format_time_metadata(dict(row))
            finally:
                conn.close()
    return None


def update_candidate_status(app_id: str, new_status: str, notes: str = "") -> bool:
    """
    Update candidate status and move candidate & document accordingly across SQL databases and folders:
    - shortlisted -> approved_candidates.db & uploads/resumes/approved/
    - rejected -> candidates.db for 10-day grace -> rejected_candidates.db & uploads/resumes/rejected/
    - pending -> candidates.db & uploads/resumes/active/
    """
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Find where candidate currently lives
    current_record = None
    source_db = None

    for db_path in (ACTIVE_DB_PATH, APPROVED_DB_PATH, REJECTED_DB_PATH):
        if os.path.exists(db_path):
            conn = get_db_connection(db_path)
            row = conn.execute("SELECT * FROM candidates WHERE app_id = ?", (app_id,)).fetchone()
            if row:
                current_record = dict(row)
                source_db = db_path
                conn.close()
                break
            conn.close()

    if not current_record:
        return False

    admin_notes = notes.strip() if notes.strip() else current_record.get("admin_notes", "")
    current_path = current_record.get("resume_path", "")

    if new_status == "shortlisted":
        new_doc_path = move_document_file(current_path, UPLOADS_APPROVED_DIR)

        # Upsert in approved_candidates.db
        conn_appr = get_db_connection(APPROVED_DB_PATH)
        conn_appr.execute(
            """
            INSERT OR REPLACE INTO candidates
                (app_id, created_at, status_updated_at, name, email, dob, age,
                 location, phone, education, work_experience, resume_filename,
                 resume_path, status, admin_notes, archived_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'shortlisted', ?, ?)
            """,
            (
                app_id, current_record["created_at"], now_str, current_record["name"],
                current_record["email"], current_record["dob"], current_record["age"],
                current_record["location"], current_record["phone"], current_record["education"],
                current_record["work_experience"], current_record["resume_filename"],
                new_doc_path, admin_notes, now_str,
            ),
        )
        conn_appr.commit()
        conn_appr.close()

        # Clean from active and rejected DBs
        for cleanup_db in (ACTIVE_DB_PATH, REJECTED_DB_PATH):
            conn_c = get_db_connection(cleanup_db)
            conn_c.execute("DELETE FROM candidates WHERE app_id = ?", (app_id,))
            conn_c.commit()
            conn_c.close()

    elif new_status == "rejected":
        new_doc_path = move_document_file(current_path, UPLOADS_ACTIVE_DIR)

        conn_act = get_db_connection(ACTIVE_DB_PATH)
        conn_act.execute(
            """
            INSERT OR REPLACE INTO candidates
                (app_id, created_at, status_updated_at, name, email, dob, age,
                 location, phone, education, work_experience, resume_filename,
                 resume_path, status, admin_notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'rejected', ?)
            """,
            (
                app_id, current_record["created_at"], now_str, current_record["name"],
                current_record["email"], current_record["dob"], current_record["age"],
                current_record["location"], current_record["phone"], current_record["education"],
                current_record["work_experience"], current_record["resume_filename"],
                new_doc_path, admin_notes,
            ),
        )
        conn_act.commit()
        conn_act.close()

        # Clean from approved DB
        conn_c = get_db_connection(APPROVED_DB_PATH)
        conn_c.execute("DELETE FROM candidates WHERE app_id = ?", (app_id,))
        conn_c.commit()
        conn_c.close()

    else:  # 'pending'
        new_doc_path = move_document_file(current_path, UPLOADS_ACTIVE_DIR)

        conn_act = get_db_connection(ACTIVE_DB_PATH)
        conn_act.execute(
            """
            INSERT OR REPLACE INTO candidates
                (app_id, created_at, status_updated_at, name, email, dob, age,
                 location, phone, education, work_experience, resume_filename,
                 resume_path, status, admin_notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
            """,
            (
                app_id, current_record["created_at"], now_str, current_record["name"],
                current_record["email"], current_record["dob"], current_record["age"],
                current_record["location"], current_record["phone"], current_record["education"],
                current_record["work_experience"], current_record["resume_filename"],
                new_doc_path, admin_notes,
            ),
        )
        conn_act.commit()
        conn_act.close()

        # Clean from approved and rejected DBs
        for cleanup_db in (APPROVED_DB_PATH, REJECTED_DB_PATH):
            conn_c = get_db_connection(cleanup_db)
            conn_c.execute("DELETE FROM candidates WHERE app_id = ?", (app_id,))
            conn_c.commit()
            conn_c.close()

    return True


def get_stats() -> Dict[str, int]:
    """Pipeline summary counts."""
    sweep_lifecycle()

    conn_act = get_db_connection(ACTIVE_DB_PATH)
    conn_appr = get_db_connection(APPROVED_DB_PATH)
    conn_rej = get_db_connection(REJECTED_DB_PATH)

    try:
        pending = conn_act.execute("SELECT COUNT(*) FROM candidates WHERE status='pending'").fetchone()[0]
        recent_rejected = conn_act.execute("SELECT COUNT(*) FROM candidates WHERE status='rejected'").fetchone()[0]

        approved_total = conn_appr.execute("SELECT COUNT(*) FROM candidates").fetchone()[0]
        rejected_archived = conn_rej.execute("SELECT COUNT(*) FROM candidates").fetchone()[0]

        rejected_total = recent_rejected + rejected_archived
        total_intake = pending + approved_total + rejected_total

        return {
            "total": total_intake,
            "pending": pending,
            "shortlisted": approved_total,
            "approved_total": approved_total,
            "rejected_active": recent_rejected,
            "rejected_archived": rejected_archived,
            "rejected_total": rejected_total,
        }
    finally:
        conn_act.close()
        conn_appr.close()
        conn_rej.close()


def find_resume_file(filename: str) -> Optional[str]:
    """Search for a resume file across all document directories."""
    safe_name = os.path.basename(filename)
    candidates_paths = [
        os.path.join(UPLOADS_ACTIVE_DIR, safe_name),
        os.path.join(UPLOADS_APPROVED_DIR, safe_name),
        os.path.join(UPLOADS_REJECTED_DIR, safe_name),
        os.path.join(UPLOADS_BASE_DIR, safe_name),
    ]
    for p in candidates_paths:
        if os.path.exists(p):
            return p
    return None


# Initialize on module load
init_db()
