"""
Admin Dashboard — Candidate Review & Pipeline Management.
Supports Multi-Database Workflow:
- Active Pipeline (Pending, Rejected within 10 days)
- Approved Database (approved_candidates.db)
- Rejected Archive Database (rejected_candidates.db)
Run on port 8001: uvicorn admin_app:app --host 0.0.0.0 --port 8001 --reload
"""

import os
import csv
import io
from datetime import datetime
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from services.db import (
    get_all_candidates,
    get_approved_candidates,
    get_rejected_candidates,
    get_candidate,
    update_candidate_status,
    get_stats,
    find_resume_file,
)
from services.auth_db import (
    authenticate_user,
    create_session,
    get_user_by_session,
    delete_session,
    create_new_user,
    list_all_users,
    create_task_and_assign,
    get_user_notifications,
    mark_notification_read,
    mark_all_notifications_read,
    toggle_task_completion,
    get_admin_all_tasks,
    delete_task,
    update_task,
    get_task_by_id,
    get_all_employees,
    get_employee_stats,
    get_employee,
    create_employee,
    update_employee,
    delete_employee,
    get_analytics_overview,
    log_audit_event,
    get_audit_logs,
    list_interviews,
    get_interview,
    create_interview,
    submit_scorecard,
    update_interview_status,
    get_daily_attendance,
    mark_attendance,
    get_attendance_stats,
    get_shift_roster,
    assign_shift_roster,
    get_all_settings,
    get_settings_dict,
    update_settings,
    reset_settings_to_defaults,
    AUTH_DB_PATH,
    get_payroll_records,
    get_payroll_stats,
    generate_monthly_payroll,
    get_payslip,
    get_offer_letters,
    get_offer_letter,
    create_offer_letter,
    update_offer_status,
    get_candidate_offer_status,
    get_leave_balances,
    get_leave_requests,
    get_leave_stats,
    create_leave_request,
    update_leave_status,
    get_recruitment_workflow_stages,
    save_recruitment_workflow_stages,
    get_candidate_workflow_stages,
    save_candidate_custom_workflow,
    get_pipeline_candidates_with_stages,
    update_candidate_pipeline_stage,
    update_candidate_pipeline_status,
    onboard_candidate_pipeline,
    enroll_candidate_in_recruitment,
    withdraw_candidate_from_recruitment,
    get_candidate_pipeline_dict,
    update_user_permissions,
    get_default_role_permissions,
)

import re
from urllib.parse import unquote

app = FastAPI(title="Milky Mist — Internal HR Portal")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SLASHED_ID_REGEX = re.compile(r"(\d{2}-\d{2}-\d{2})(?:/|%2[fF])(\d{4})")

def normalize_app_id(app_id: str) -> str:
    """Normalize application IDs containing date forward slashes (e.g. 08-10-26/0001)."""
    if not app_id:
        return ""
    decoded = unquote(app_id)
    return decoded.replace("__SLASH__", "/")

@app.middleware("http")
async def handle_slashed_app_ids(request: Request, call_next):
    """
    Rewrite URL path when an application ID contains a forward slash (dd-mm-yy/000x),
    so Starlette router matches routes like /api/candidates/{app_id} seamlessly without splitting path segments.
    """
    scope = request.scope
    path = scope.get("path", "")
    if SLASHED_ID_REGEX.search(path):
        new_path = SLASHED_ID_REGEX.sub(r"\1__SLASH__\2", path)
        scope["path"] = new_path
        scope["raw_path"] = new_path.encode("latin-1")
    return await call_next(request)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_ADMIN_DIR = os.path.join(BASE_DIR, "static_admin")
os.makedirs(STATIC_ADMIN_DIR, exist_ok=True)

app.mount("/static", StaticFiles(directory=STATIC_ADMIN_DIR), name="static")


def get_current_user(request: Request) -> Optional[dict]:
    token = request.cookies.get("mm_session_token")
    if not token:
        auth_hdr = request.headers.get("Authorization", "")
        if auth_hdr.startswith("Bearer "):
            token = auth_hdr.split(" ")[1]
    return get_user_by_session(token) if token else None


# ── Pages ────────────────────────────────────────────────────────────────────

@app.get("/login")
async def serve_login(request: Request):
    user = get_current_user(request)
    if user:
        return RedirectResponse(url="/")
    login_path = os.path.join(STATIC_ADMIN_DIR, "login.html")
    if os.path.exists(login_path):
        return FileResponse(login_path)
    return {"error": "Login page not found."}


@app.get("/")
async def serve_admin(request: Request):
    user = get_current_user(request)
    if not user:
        return RedirectResponse(url="/login")
    index_path = os.path.join(STATIC_ADMIN_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(
            index_path,
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0"
            }
        )
    return {"error": "Admin dashboard UI not found."}


# ── Auth Endpoints ───────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


class CreateUserRequest(BaseModel):
    username: str
    password: str
    name: Optional[str] = ""
    role: Optional[str] = "staff"
    permissions: Optional[Dict[str, bool]] = None


class UpdateUserPermissionsRequest(BaseModel):
    permissions: Dict[str, bool]


@app.post("/api/auth/login")
async def api_login(body: LoginRequest, response: Response):
    user = authenticate_user(body.username, body.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password.")
    token = create_session(user["username"])
    response.set_cookie(
        key="mm_session_token",
        value=token,
        max_age=86400 * 3,
        httponly=True,
        samesite="lax",
    )
    return {"success": True, "data": {"user": user, "token": token}}


@app.post("/api/auth/logout")
async def api_logout(request: Request, response: Response):
    token = request.cookies.get("mm_session_token")
    if token:
        delete_session(token)
    response.delete_cookie("mm_session_token")
    return {"success": True, "message": "Signed out successfully."}


@app.get("/api/auth/me")
async def api_me(request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    return {"success": True, "data": user}


@app.get("/api/auth/users")
async def api_get_users(request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    return {"success": True, "data": list_all_users()}


@app.post("/api/auth/users")
async def api_create_user(body: CreateUserRequest, request: Request):
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    if not user.get("can_create_users"):
        raise HTTPException(
            status_code=403,
            detail="Permission denied. Only dev123 and admin accounts have permission to create users."
        )
    if user.get("role") != "developer" and (body.role or "").lower() in ("admin", "developer"):
        raise HTTPException(
            status_code=403,
            detail="Permission denied. Only developer accounts can create admin accounts. Admins can only create user accounts."
        )
    try:
        new_u = create_new_user(
            requester_username=user["username"],
            new_username=body.username,
            new_password=body.password,
            full_name=body.name or body.username.title(),
            role=body.role or "staff",
            permissions=body.permissions,
        )
        return {"success": True, "data": new_u, "message": f"User '{new_u['username']}' created successfully."}
    except (ValueError, PermissionError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/api/auth/users/{target_username}/permissions")
async def api_update_user_permissions(target_username: str, body: UpdateUserPermissionsRequest, request: Request):
    """Admin Master Control: Dynamically update viewing and editing permissions for any user account."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    if not user.get("can_create_users"):
        raise HTTPException(status_code=403, detail="Permission denied. Only administrators can configure user permissions.")

    try:
        success = update_user_permissions(target_username, body.permissions, user["username"])
        return {
            "success": success,
            "message": f"Access permissions updated for user '{target_username}'.",
            "permissions": body.permissions,
        }
    except (ValueError, PermissionError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Tasks, Reminders & Notifications ─────────────────────────────────────────

class CreateTaskRequest(BaseModel):
    title: str
    description: Optional[str] = ""
    due_date: Optional[str] = ""
    priority: Optional[str] = "medium"
    assigned_type: str = "single"  # "single", "multiple", "everyone"
    target_usernames: Optional[List[str]] = []


@app.post("/api/tasks")
async def api_create_task(body: CreateTaskRequest, request: Request):
    """Admin / Developer sets a reminder or assigns a task to a user, multiple users, or everyone."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    if not user.get("can_create_users"):
        raise HTTPException(
            status_code=403,
            detail="Permission denied. Only dev123 and admin accounts can assign work and set reminders."
        )
    try:
        task = create_task_and_assign(
            creator_username=user["username"],
            title=body.title,
            description=body.description or "",
            due_date=body.due_date or "",
            priority=body.priority or "medium",
            assigned_type=body.assigned_type,
            target_usernames=body.target_usernames or [],
        )
        return {"success": True, "data": task, "message": "Task and reminders assigned successfully."}
    except PermissionError as pe:
        raise HTTPException(status_code=403, detail=str(pe))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/tasks/all")
async def api_get_all_tasks(request: Request):
    """View all created tasks and completion breakdowns (admin/dev view)."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    if not user.get("can_create_users"):
        raise HTTPException(status_code=403, detail="Permission denied.")
    tasks = get_admin_all_tasks()
    return {"success": True, "data": tasks, "count": len(tasks)}


@app.get("/api/tasks/{task_id}")
async def api_get_single_task(task_id: int, request: Request):
    """Get single task details including assignments (admin/dev only)."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    if not user.get("can_create_users"):
        raise HTTPException(status_code=403, detail="Permission denied.")
    task = get_task_by_id(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    return {"success": True, "data": task}


@app.put("/api/tasks/{task_id}")
async def api_update_task(task_id: int, body: CreateTaskRequest, request: Request):
    """Admin / Developer edits an existing assigned task."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    if not user.get("can_create_users"):
        raise HTTPException(
            status_code=403,
            detail="Permission denied. Only dev123 and admin accounts can edit tasks."
        )
    try:
        updated = update_task(
            task_id=task_id,
            updater_username=user["username"],
            title=body.title,
            description=body.description or "",
            due_date=body.due_date or "",
            priority=body.priority or "medium",
            assigned_type=body.assigned_type,
            target_usernames=body.target_usernames or [],
        )
        return {"success": True, "data": updated, "message": "Task updated successfully."}
    except PermissionError as pe:
        raise HTTPException(status_code=403, detail=str(pe))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"success": True, "data": tasks, "count": len(tasks)}


@app.delete("/api/tasks/{task_id}")
async def api_delete_task(task_id: int, request: Request):
    """Delete a task and its notifications (admin/dev only)."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    if not user.get("can_create_users"):
        raise HTTPException(status_code=403, detail="Permission denied.")
    delete_task(task_id, user["username"])
    return {"success": True, "message": "Task removed."}


@app.get("/api/notifications")
async def api_get_notifications(request: Request):
    """Get assigned tasks and notifications for the logged in user."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    data = get_user_notifications(user["username"])
    return {"success": True, "data": data}


@app.post("/api/notifications/{notification_id}/read")
async def api_mark_notification_read(notification_id: int, request: Request):
    """Mark a notification as read."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    mark_notification_read(notification_id, user["username"])
    return {"success": True, "message": "Marked as read."}


@app.post("/api/notifications/read-all")
async def api_mark_all_read(request: Request):
    """Mark all notifications for current user as read."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    mark_all_notifications_read(user["username"])
    return {"success": True, "message": "All notifications marked as read."}


class TaskToggleCompleteRequest(BaseModel):
    is_completed: bool


@app.post("/api/tasks/{task_id}/toggle-complete")
async def api_toggle_complete(task_id: int, body: TaskToggleCompleteRequest, request: Request):
    """Toggle completion status for the current user's assigned task."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    toggle_task_completion(task_id, user["username"], body.is_completed)
    return {"success": True, "message": "Task completion status updated."}


# ── API ──────────────────────────────────────────────────────────────────────

@app.get("/api/stats")
async def api_stats():
    """Pipeline summary counts across active pipeline, approved archive, and rejected archive."""
    stats = get_stats()
    try:
        pipeline_map = get_candidate_pipeline_dict()
        approved_list = get_approved_candidates()
        awaiting = sum(1 for c in approved_list if c["app_id"] not in pipeline_map)
        in_pipeline = len(pipeline_map)
        stats["approved_awaiting"] = awaiting
        stats["approved_total"] = awaiting  # Badge for approved resumes reflects only awaiting candidates
        stats["in_recruitment_pipeline"] = in_pipeline
    except Exception:
        pass
    return {"success": True, "data": stats}


@app.get("/api/candidates")
async def api_candidates(
    status: Optional[str] = None,
    search: Optional[str] = None,
):
    """
    List active candidates in candidates.db:
    - Pending
    - Shortlisted
    - Rejected (within 10-day grace window)
    """
    candidates = get_all_candidates(status_filter=status, search=search)
    return {"success": True, "data": candidates, "count": len(candidates)}


@app.get("/api/approved")
async def api_approved_candidates(
    search: Optional[str] = None,
    pipeline_status: Optional[str] = None,
    include_all: bool = False
):
    """List approved candidates. By default, candidates moved to recruitment are removed."""
    candidates = get_approved_candidates(search=search)
    pipeline_map = get_candidate_pipeline_dict()
    all_stages = get_recruitment_workflow_stages()
    total_stages = len(all_stages)

    total_pool = len(candidates)
    in_pipeline_count = sum(1 for c in candidates if c["app_id"] in pipeline_map)
    awaiting_count = total_pool - in_pipeline_count
    onboarded_count = sum(1 for c in candidates if pipeline_map.get(c["app_id"], {}).get("recruitment_status") == "onboarded")

    enriched = []
    for c in candidates:
        app_id = c["app_id"]
        in_pipeline = app_id in pipeline_map
        pipe = pipeline_map.get(app_id, {})
        rec_status = pipe.get("recruitment_status", "") if in_pipeline else ""
        completed_stages = pipe.get("completed_stages", []) if in_pipeline else []
        completed_count = sum(1 for s in all_stages if s in completed_stages)
        progress_pct = round((completed_count / total_stages) * 100) if total_stages > 0 else 0

        # By default, once a candidate is moved to recruitment, remove them from approved
        if not include_all:
            if not pipeline_status:
                if in_pipeline:
                    continue
            else:
                ps_lower = pipeline_status.lower()
                if ps_lower in ("not_enrolled", "awaiting") and in_pipeline:
                    continue
                elif ps_lower == "in_pipeline" and (not in_pipeline or rec_status == "onboarded"):
                    continue
                elif ps_lower == "onboarded" and rec_status != "onboarded":
                    continue

        c_copy = dict(c)
        c_copy["in_pipeline"] = in_pipeline
        c_copy["recruitment_status"] = rec_status
        c_copy["completed_stages"] = completed_stages
        c_copy["completed_count"] = completed_count
        c_copy["total_stages"] = total_stages
        c_copy["progress_percent"] = progress_pct
        c_copy["progress_pct"] = progress_pct
        c_copy["onboarded_emp_id"] = pipe.get("onboarded_emp_id", "")
        c_copy["onboarded_at"] = pipe.get("onboarded_at", "")
        c_copy["target_role"] = pipe.get("target_role", "")
        c_copy["department"] = pipe.get("department", "")
        c_copy["assigned_recruiter"] = pipe.get("assigned_recruiter", "")
        c_copy["recruitment_started_at"] = pipe.get("recruitment_started_at", "")
        c_copy["recruitment_notes"] = pipe.get("recruitment_notes", "")
        enriched.append(c_copy)

    return {
        "success": True,
        "data": enriched,
        "count": len(enriched),
        "telemetry": {
            "total_approved": total_pool,
            "awaiting_recruitment": awaiting_count,
            "in_pipeline": in_pipeline_count,
            "onboarded": onboarded_count
        }
    }


@app.get("/api/rejected-archive")
async def api_rejected_archive(search: Optional[str] = None):
    """List all archived rejected candidates stored in rejected_candidates.db."""
    candidates = get_rejected_candidates(search=search)
    return {"success": True, "data": candidates, "count": len(candidates)}


@app.get("/api/candidates/{app_id}")
async def api_candidate_detail(app_id: str):
    """Full detail for a single candidate across active, approved, or rejected databases."""
    app_id = normalize_app_id(app_id)
    candidate = get_candidate(app_id)
    if not candidate:
        raise HTTPException(status_code=404, detail=f"Candidate {app_id} not found.")
    return {"success": True, "data": candidate}


class StatusUpdate(BaseModel):
    status: str
    notes: Optional[str] = ""


@app.put("/api/candidates/{app_id}/status")
async def api_update_status(app_id: str, body: StatusUpdate, request: Request):
    """
    Change a candidate's pipeline status.
    Moves candidate record and documents accordingly across SQL databases and folders:
    - Shortlisted -> approved_candidates.db & uploads/resumes/approved/
    - Rejected -> candidates.db for 10-day grace -> rejected_candidates.db & uploads/resumes/rejected/
    - Reset -> active candidates.db & uploads/resumes/active/
    """
    app_id = normalize_app_id(app_id)
    valid = ("pending", "shortlisted", "rejected")
    if body.status not in valid:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status '{body.status}'. Must be one of: {', '.join(valid)}",
        )
    candidate = get_candidate(app_id)
    if not candidate:
        raise HTTPException(status_code=404, detail=f"Candidate {app_id} not found.")

    update_candidate_status(app_id, body.status, body.notes or "")
    updated = get_candidate(app_id)
    curr_user = get_current_user(request)
    uname = curr_user["username"] if curr_user else "admin123"

    log_audit_event(uname, f"STATUS_{body.status.upper()}", "candidate", app_id, f"Candidate {candidate.get('name', app_id)} status changed to {body.status}")
    return {
        "success": True,
        "message": f"Candidate status updated to '{body.status}' and moved to Approved Resumes." if body.status == "shortlisted" else f"Candidate status updated to '{body.status}'.",
        "data": updated,
    }


@app.get("/api/resume/{filename}")
async def api_download_resume(filename: str):
    """Download a candidate's uploaded resume PDF from wherever it was moved."""
    path = find_resume_file(filename)
    if not path or not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Resume file not found.")
    return FileResponse(path, media_type="application/pdf", filename=os.path.basename(path))


# ==========================================================================
# Employee Directory Endpoints
# ==========================================================================
class EmployeeCreateRequest(BaseModel):
    name: str
    email: str
    phone: Optional[str] = ""
    department: Optional[str] = "Dairy Processing & Production"
    designation: Optional[str] = "Staff"
    joining_date: Optional[str] = ""
    employment_type: Optional[str] = "Permanent"
    status: Optional[str] = "Active"
    location: Optional[str] = "Perundurai Mega Plant (HQ)"
    candidate_app_id: Optional[str] = ""


class EmployeeUpdateRequest(BaseModel):
    name: str
    email: str
    phone: Optional[str] = ""
    department: Optional[str] = "Dairy Processing & Production"
    designation: Optional[str] = "Staff"
    joining_date: Optional[str] = ""
    employment_type: Optional[str] = "Permanent"
    status: Optional[str] = "Active"
    location: Optional[str] = "Perundurai Mega Plant (HQ)"


class OnboardCandidateRequest(BaseModel):
    department: Optional[str] = "Dairy Processing & Production"
    designation: Optional[str] = "Executive"
    joining_date: Optional[str] = ""
    employment_type: Optional[str] = "Permanent"
    location: Optional[str] = "Perundurai Mega Plant (HQ)"
    phone: Optional[str] = ""
    email: Optional[str] = ""
    name: Optional[str] = ""


@app.get("/api/employees/stats")
async def api_get_employee_stats():
    """Retrieve aggregate workforce statistics for the employee directory."""
    stats = get_employee_stats()
    return {"success": True, "data": stats}


@app.get("/api/employees")
async def api_list_employees(
    department: Optional[str] = None,
    status: Optional[str] = None,
    employment_type: Optional[str] = None,
    search: Optional[str] = None,
):
    """List employees with optional filters by department, status, employment type, and text search."""
    employees = get_all_employees(
        department=department,
        status=status,
        employment_type=employment_type,
        search=search,
    )
    return {"success": True, "count": len(employees), "data": employees}


@app.get("/api/employees/{emp_id}")
async def api_get_employee(emp_id: str):
    """Retrieve details for a single employee."""
    emp = get_employee(emp_id)
    if not emp:
        raise HTTPException(status_code=404, detail=f"Employee '{emp_id}' not found.")
    return {"success": True, "data": emp}


@app.post("/api/employees")
async def api_create_employee(req: EmployeeCreateRequest, request: Request):
    """Create a new employee record directly."""
    try:
        emp = create_employee(
            name=req.name,
            email=req.email,
            phone=req.phone or "",
            department=req.department or "Dairy Processing & Production",
            designation=req.designation or "Staff",
            joining_date=req.joining_date or "",
            employment_type=req.employment_type or "Permanent",
            status=req.status or "Active",
            location=req.location or "Perundurai Mega Plant (HQ)",
            candidate_app_id=req.candidate_app_id or "",
        )
        curr_user = get_current_user(request)
        uname = curr_user["username"] if curr_user else "admin123"
        log_audit_event(uname, "CREATE_EMPLOYEE", "employee", emp["emp_id"], f"Added staff {emp['name']} ({emp['emp_id']}) to {emp['department']}")
        return {"success": True, "message": "Employee created successfully.", "data": emp}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/employees/{emp_id}")
async def api_update_employee(emp_id: str, req: EmployeeUpdateRequest, request: Request):
    """Update an existing employee record."""
    try:
        emp = update_employee(
            emp_id=emp_id,
            name=req.name,
            email=req.email,
            phone=req.phone or "",
            department=req.department or "Dairy Processing & Production",
            designation=req.designation or "Staff",
            joining_date=req.joining_date or "",
            employment_type=req.employment_type or "Permanent",
            status=req.status or "Active",
            location=req.location or "Perundurai Mega Plant (HQ)",
        )
        curr_user = get_current_user(request)
        uname = curr_user["username"] if curr_user else "admin123"
        log_audit_event(uname, "UPDATE_EMPLOYEE", "employee", emp_id, f"Updated profile details for {emp['name']} ({emp_id})")
        return {"success": True, "message": "Employee updated successfully.", "data": emp}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/employees/{emp_id}")
async def api_delete_employee(emp_id: str, request: Request):
    """Delete an employee record."""
    emp = get_employee(emp_id)
    if not emp:
        raise HTTPException(status_code=404, detail=f"Employee '{emp_id}' not found.")
    delete_employee(emp_id)
    curr_user = get_current_user(request)
    uname = curr_user["username"] if curr_user else "admin123"
    log_audit_event(uname, "DELETE_EMPLOYEE", "employee", emp_id, f"Removed employee record for {emp.get('name', emp_id)}")
    return {"success": True, "message": f"Employee {emp_id} deleted successfully."}


@app.post("/api/candidates/{app_id}/onboard")
async def api_onboard_candidate(app_id: str, req: OnboardCandidateRequest, request: Request):
    """
    Onboard an approved candidate into the Milky Mist Employee Directory.
    Auto-populates fields from their candidate record if not overridden.
    """
    app_id = normalize_app_id(app_id)
    candidate = get_candidate(app_id)
    if not candidate:
        raise HTTPException(status_code=404, detail=f"Candidate {app_id} not found.")

    name = (req.name or candidate.get("name") or "").strip()
    email = (req.email or candidate.get("email") or "").strip()
    phone = (req.phone or candidate.get("phone") or "").strip()
    location = (req.location or candidate.get("location") or "Perundurai Mega Plant (HQ)").strip()

    if not name or not email:
        raise HTTPException(status_code=400, detail="Candidate must have a valid name and email to onboard.")

    from datetime import date
    joining_date = req.joining_date or date.today().strftime("%Y-%m-%d")

    try:
        emp = create_employee(
            name=name,
            email=email,
            phone=phone,
            department=req.department or "Dairy Processing & Production",
            designation=req.designation or "Executive",
            joining_date=joining_date,
            employment_type=req.employment_type or "Permanent",
            status="Active",
            location=location,
            candidate_app_id=app_id,
        )
        curr_user = get_current_user(request)
        uname = curr_user["username"] if curr_user else "admin123"
        log_audit_event(uname, "ONBOARD_CANDIDATE", "employee", emp["emp_id"], f"Onboarded candidate {app_id} ({name}) as employee {emp['emp_id']}")
        return {
            "success": True,
            "message": f"Candidate {app_id} successfully onboarded as {emp['emp_id']}.",
            "data": emp,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================================================
# Analytics & Reports Endpoints
# ==========================================================================
@app.get("/api/analytics/overview")
async def api_get_analytics_overview():
    """Retrieve comprehensive workforce, location split, recruitment velocity, and task execution data."""
    overview = get_analytics_overview()
    recruitment_stats = get_stats()

    total_apps = recruitment_stats.get("total", 0)
    shortlisted = recruitment_stats.get("shortlisted", 0)
    rejected = recruitment_stats.get("rejected", 0)
    pending = recruitment_stats.get("pending", 0)
    onboarded = overview["workforce"]["onboarded_from_pipeline"]

    approval_rate = round((shortlisted / total_apps * 100), 1) if total_apps > 0 else 0.0
    onboard_rate = round((onboarded / shortlisted * 100), 1) if shortlisted > 0 else 0.0

    overview["recruitment"] = {
        "total_applications": total_apps,
        "pending": pending,
        "shortlisted": shortlisted,
        "rejected": rejected,
        "onboarded": onboarded,
        "approval_rate": approval_rate,
        "onboard_rate": onboard_rate,
    }

    return {"success": True, "data": overview}


@app.get("/api/analytics/export/employees")
async def api_export_employees_csv():
    """Export the entire employee master directory as a CSV file."""
    employees = get_all_employees()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Employee ID",
        "Full Name",
        "Work Email",
        "Phone",
        "Department",
        "Designation",
        "Operating Location",
        "Joining Date",
        "Employment Type",
        "Status",
        "Onboarded From Candidate App ID",
    ])
    for emp in employees:
        writer.writerow([
            emp.get("emp_id", ""),
            emp.get("name", ""),
            emp.get("email", ""),
            emp.get("phone", ""),
            emp.get("department", ""),
            emp.get("designation", ""),
            emp.get("location", ""),
            emp.get("joining_date", ""),
            emp.get("employment_type", ""),
            emp.get("status", ""),
            emp.get("candidate_app_id", ""),
        ])

    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=Milky_Mist_Employee_Directory.csv"},
    )


@app.get("/api/analytics/export/candidates")
async def api_export_candidates_csv():
    """Export all candidates (pending, approved, rejected archive) as a CSV file."""
    active_candidates = get_all_candidates()
    approved_candidates = get_approved_candidates()
    rejected_candidates = get_rejected_candidates()

    seen_ids = set()
    all_candidates = []
    for c in approved_candidates + active_candidates + rejected_candidates:
        if c.get("app_id") not in seen_ids:
            seen_ids.add(c.get("app_id"))
            all_candidates.append(c)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Application ID",
        "Candidate Name",
        "Email",
        "Phone",
        "Location",
        "Age",
        "DOB",
        "Status",
        "Education",
        "Work Experience",
        "Application Date",
        "Admin Notes",
    ])
    for c in all_candidates:
        writer.writerow([
            c.get("app_id", ""),
            c.get("name", ""),
            c.get("email", ""),
            c.get("phone", ""),
            c.get("location", ""),
            c.get("age", ""),
            c.get("dob", ""),
            c.get("status", ""),
            (c.get("education", "") or "").replace("\n", " | "),
            (c.get("work_experience", "") or "").replace("\n", " | "),
            c.get("created_at", ""),
            c.get("admin_notes", ""),
        ])

    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=Milky_Mist_Recruitment_Pipeline.csv"},
    )


# ==============================================================================
# Audit Trail Endpoints
# ==============================================================================

@app.get("/api/audit-logs")
async def api_get_audit_logs(
    limit: int = 150,
    action: Optional[str] = None,
    search: Optional[str] = None,
    request: Request = None,
):
    """Retrieve audit logs with optional filtering by action type and keyword search."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    logs = get_audit_logs(limit=limit, action=action, search=search)
    return {"success": True, "count": len(logs), "data": logs}


@app.get("/api/audit-logs/export")
async def api_export_audit_logs(request: Request):
    """Export system audit trail to CSV format."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    logs = get_audit_logs(limit=1000)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Log ID", "Timestamp", "User", "Action", "Target Type", "Target ID", "Details", "IP Address"])
    for l in logs:
        writer.writerow([
            l.get("id", ""),
            l.get("timestamp", ""),
            l.get("user", ""),
            l.get("action", ""),
            l.get("target_type", ""),
            l.get("target_id", ""),
            l.get("details", ""),
            l.get("ip_address", ""),
        ])
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=Milky_Mist_Audit_Trail.csv"},
    )


# ==============================================================================
# Interview & Candidate Scorecard Endpoints
# ==============================================================================

class InterviewCreateRequest(BaseModel):
    candidate_app_id: str
    candidate_name: str
    round_type: Optional[str] = "Plant Technical Round"
    interview_round: Optional[str] = None
    interviewer: str
    scheduled_at: str
    location: Optional[str] = "Perundurai Mega Plant (HQ)"
    notes: Optional[str] = ""


class ScorecardSubmitRequest(BaseModel):
    rating_technical: int
    rating_safety: int
    rating_experience: int
    rating_culture: int
    recommendation: str  # "Strong Hire", "Hire", "Hold", "Reject"
    notes: Optional[str] = ""
    scorecard_notes: Optional[str] = None


class InterviewStatusRequest(BaseModel):
    status: str  # "Scheduled", "Completed", "Cancelled"


@app.get("/api/interviews")
async def api_list_interviews(
    candidate_app_id: Optional[str] = None,
    status: Optional[str] = None,
    request: Request = None,
):
    """List scheduled interviews and candidate scorecards."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    interviews = list_interviews(candidate_app_id=candidate_app_id, status=status)
    return {"success": True, "count": len(interviews), "data": interviews}


@app.get("/api/interviews/{interview_id}")
async def api_get_interview_detail(interview_id: int, request: Request):
    """Get single interview details and scorecard."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    iv = get_interview(interview_id)
    if not iv:
        raise HTTPException(status_code=404, detail="Interview not found.")
    return {"success": True, "data": iv}


@app.post("/api/interviews")
async def api_create_interview(body: InterviewCreateRequest, request: Request):
    """Schedule an interview with a shortlisted candidate."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    res = create_interview(
        candidate_app_id=body.candidate_app_id,
        candidate_name=body.candidate_name,
        round_type=body.round_type or body.interview_round or "Plant Technical Round",
        interviewer=body.interviewer,
        scheduled_at=body.scheduled_at,
        location=body.location or "Perundurai Mega Plant (HQ)",
        notes=body.notes or "",
        created_by=user["username"],
    )
    return {"success": True, "data": res, "message": "Interview scheduled successfully."}


@app.post("/api/interviews/{interview_id}/scorecard")
async def api_submit_scorecard(interview_id: int, body: ScorecardSubmitRequest, request: Request):
    """Submit evaluation scorecard for a completed candidate interview."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    success = submit_scorecard(
        interview_id=interview_id,
        rating_technical=body.rating_technical,
        rating_safety=body.rating_safety,
        rating_experience=body.rating_experience,
        rating_culture=body.rating_culture,
        recommendation=body.recommendation,
        notes=body.notes or body.scorecard_notes or "",
        user=user["username"],
    )
    return {"success": success, "message": "Scorecard recorded successfully."}


@app.put("/api/interviews/{interview_id}/status")
async def api_update_interview_status(interview_id: int, body: InterviewStatusRequest, request: Request):
    """Update status of an interview."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    success = update_interview_status(interview_id, body.status, user["username"])
    return {"success": success, "message": f"Interview status updated to {body.status}."}


# ==============================================================================
# Attendance & Shift Roster Endpoints
# ==============================================================================

class MarkAttendanceRequest(BaseModel):
    emp_id: str
    att_date: Optional[str] = None
    date: Optional[str] = None
    status: str  # "Present", "Absent", "On Leave", "Late", "Half Day"
    shift_name: Optional[str] = "Shift A (06:00-14:00)"
    check_in_time: Optional[str] = ""
    notes: Optional[str] = ""


class AssignRosterRequest(BaseModel):
    emp_id: str
    roster_date: str
    shift_name: str  # "Shift A", "Shift B", "Shift C", "General Shift"


@app.get("/api/attendance")
async def api_get_attendance(
    date: Optional[str] = None,
    department: Optional[str] = None,
    request: Request = None,
):
    """Get daily workforce attendance records."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    records = get_daily_attendance(att_date=date, department=department)
    return {"success": True, "count": len(records), "data": records}


@app.get("/api/attendance/stats")
async def api_get_attendance_stats(date: Optional[str] = None, request: Request = None):
    """Get attendance KPIs for a given day."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    stats = get_attendance_stats(att_date=date)
    return {"success": True, "data": stats}


@app.post("/api/attendance")
async def api_mark_attendance(body: MarkAttendanceRequest, request: Request):
    """Mark or update an employee's daily attendance."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    target_date = body.att_date or body.date or datetime.now().strftime("%Y-%m-%d")
    success = mark_attendance(
        emp_id=body.emp_id,
        att_date=target_date,
        status=body.status,
        shift_name=body.shift_name or "Shift A (06:00-14:00)",
        check_in_time=body.check_in_time or "",
        notes=body.notes or "",
        marked_by=user["username"],
    )
    return {"success": success, "message": "Attendance marked successfully."}


@app.get("/api/attendance/export")
async def api_export_attendance(date: Optional[str] = None, request: Request = None):
    """Export attendance roster to CSV format."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    records = get_daily_attendance(att_date=date)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Emp ID", "Staff Name", "Department", "Designation", "Work Type", "Date", "Shift", "Status", "Check-in", "Location", "Notes"])
    for r in records:
        writer.writerow([
            r.get("emp_id", ""),
            r.get("emp_name", ""),
            r.get("department", ""),
            r.get("designation", ""),
            r.get("employment_type", ""),
            r.get("att_date", ""),
            r.get("shift_name", ""),
            r.get("status", ""),
            r.get("check_in_time", ""),
            r.get("location", ""),
            r.get("notes", ""),
        ])
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=Milky_Mist_Attendance_{date or 'today'}.csv"},
    )


@app.get("/api/roster")
async def api_get_roster(date: Optional[str] = None, request: Request = None):
    """Get shift assignments for a date."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    roster = get_shift_roster(roster_date=date)
    return {"success": True, "count": len(roster), "data": roster}


@app.post("/api/roster")
async def api_assign_roster(body: AssignRosterRequest, request: Request):
    """Assign or swap shift for an employee."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    success = assign_shift_roster(
        emp_id=body.emp_id,
        roster_date=body.roster_date,
        shift_name=body.shift_name,
        user=user["username"],
    )
    return {"success": success, "message": "Shift roster assigned successfully."}


# ==============================================================================
# Enterprise System Settings & Control Center Endpoints
# ==============================================================================

class SettingsUpdateRequest(BaseModel):
    updates: Dict[str, Any]


@app.get("/api/settings")
async def api_get_settings(request: Request):
    """Retrieve full system settings and enterprise telemetry info."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")

    settings_list = get_all_settings()
    settings_dict = get_settings_dict()

    # System telemetry & database health
    db_size_kb = 0
    if os.path.exists(AUTH_DB_PATH):
        db_size_kb = round(os.path.getsize(AUTH_DB_PATH) / 1024, 1)

    import platform
    telemetry = {
        "db_size_kb": db_size_kb,
        "db_size_mb": round(db_size_kb / 1024, 2),
        "total_settings": len(settings_list),
        "server_os": f"{platform.system()} {platform.release()}",
        "python_version": platform.python_version(),
        "database_type": "SQLite WAL Mode (Enterprise Local)",
        "active_user": user["username"],
        "user_role": user["role"],
    }

    return {
        "success": True,
        "settings": settings_list,
        "values": settings_dict,
        "telemetry": telemetry,
    }


@app.post("/api/settings")
async def api_update_settings(body: SettingsUpdateRequest, request: Request):
    """Update system settings with admin audit logging."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    if user["role"] not in ("developer", "admin"):
        raise HTTPException(status_code=403, detail="Only Admins and Developers can update system settings.")

    success = update_settings(body.updates, user["username"])
    return {"success": success, "message": f"Successfully updated {len(body.updates)} system settings."}


@app.post("/api/settings/reset")
async def api_reset_settings(request: Request):
    """Reset all settings to enterprise defaults."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    if user["role"] not in ("developer", "admin"):
        raise HTTPException(status_code=403, detail="Only Admins and Developers can reset system settings.")

    success = reset_settings_to_defaults(user["username"])
    return {"success": success, "message": "System settings reset to Milky Mist enterprise defaults."}


@app.get("/api/settings/backup")
async def api_backup_database(request: Request):
    """Download live database backup file."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    if user["role"] not in ("developer", "admin"):
        raise HTTPException(status_code=403, detail="Only Admins and Developers can download database backups.")

    if not os.path.exists(AUTH_DB_PATH):
        raise HTTPException(status_code=404, detail="Database file not found.")

    now_tag = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_audit_event(user["username"], "DATABASE_BACKUP", "system", "users.db", f"Downloaded system database snapshot ({now_tag})")

    return FileResponse(
        AUTH_DB_PATH,
        filename=f"MilkyMist_Enterprise_Backup_{now_tag}.db",
        media_type="application/x-sqlite3",
    )


@app.post("/api/settings/test-notification")
async def api_test_notification(request: Request):
    """Test notification trigger."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    return {"success": True, "message": f"Notification test acknowledged for {user['username']}."}


# ==============================================================================
# Payroll & Compensation Endpoints
# ==============================================================================

class GeneratePayrollRequest(BaseModel):
    month_year: str


@app.get("/api/payroll")
async def api_get_payroll(
    month: Optional[str] = None,
    department: Optional[str] = None,
    request: Request = None,
):
    """Retrieve monthly workforce payroll records."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    records = get_payroll_records(month_year=month, department=department)
    return {"success": True, "count": len(records), "data": records}


@app.get("/api/payroll/stats")
async def api_get_payroll_stats(month: Optional[str] = None, request: Request = None):
    """Get aggregate payroll payout, allowances, and statutory deductions."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    stats = get_payroll_stats(month_year=month)
    return {"success": True, "data": stats}


@app.post("/api/payroll/generate")
async def api_generate_payroll(body: GeneratePayrollRequest, request: Request):
    """Trigger automated payroll computation driven by attendance."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    res = generate_monthly_payroll(month_year=body.month_year, user=user["username"])
    return res


@app.get("/api/payroll/{emp_id}/slip")
async def api_get_payslip(emp_id: str, month: Optional[str] = None, request: Request = None):
    """Retrieve single employee payslip detail."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    target_month = month or datetime.now().strftime("%Y-%m")
    slip = get_payslip(emp_id, target_month)
    if not slip:
        raise HTTPException(status_code=404, detail="Salary slip not found for the specified month.")
    return {"success": True, "data": slip}


@app.get("/api/payroll/export")
async def api_export_payroll(month: Optional[str] = None, request: Request = None):
    """Export payroll records to CSV for bank disbursement."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")

    target_month = month or datetime.now().strftime("%Y-%m")
    records = get_payroll_records(month_year=target_month)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Emp ID", "Staff Name", "Department", "Designation", "Location", "Month",
        "Basic (INR)", "HRA (INR)", "Conveyance (INR)", "Plant Allowance (INR)",
        "Shift Allowance (INR)", "Gross Salary (INR)", "PF Deduction (INR)",
        "ESI Deduction (INR)", "LOP Days", "LOP Deduction (INR)", "Net Payable (INR)",
        "Bank Account", "UAN Number", "Status"
    ])
    for r in records:
        writer.writerow([
            r.get("emp_id", ""),
            r.get("emp_name", ""),
            r.get("department", ""),
            r.get("designation", ""),
            r.get("location", ""),
            r.get("month_year", ""),
            r.get("basic_salary", 0),
            r.get("hra", 0),
            r.get("conveyance", 0),
            r.get("plant_allowance", 0),
            r.get("shift_allowance", 0),
            r.get("gross_salary", 0),
            r.get("pf_deduction", 0),
            r.get("esi_deduction", 0),
            r.get("lop_days", 0),
            r.get("lop_deduction", 0),
            r.get("net_salary", 0),
            r.get("bank_account", ""),
            r.get("pf_uan", ""),
            r.get("payment_status", "Processed"),
        ])

    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=Milky_Mist_Payroll_{target_month}.csv"},
    )


# ==============================================================================
# Offer Letter & Appointment Generator Endpoints
# ==============================================================================

class CreateOfferRequest(BaseModel):
    candidate_app_id: str
    candidate_name: str
    candidate_email: Optional[str] = ""
    candidate_phone: Optional[str] = ""
    designation: str
    department: str
    plant_location: Optional[str] = "Perundurai Mega Plant (HQ)"
    joining_date: str
    ctc_annual: float
    employment_type: Optional[str] = "Permanent"
    notes: Optional[str] = ""


class UpdateOfferStatusRequest(BaseModel):
    status: str


@app.get("/api/offers")
async def api_get_offers(search: Optional[str] = None, request: Request = None):
    """Retrieve list of issued offer letters."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    offers = get_offer_letters(search=search)
    return {"success": True, "count": len(offers), "data": offers}


@app.get("/api/offers/{identifier:path}")
async def api_get_offer(identifier: str, request: Request = None):
    """Retrieve single offer letter by candidate_app_id or offer_ref."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    offer = get_offer_letter(identifier)
    if not offer:
        raise HTTPException(status_code=404, detail="Offer letter not found.")
    return {"success": True, "data": offer}


@app.post("/api/offers")
async def api_create_offer(body: CreateOfferRequest, request: Request):
    """Create and issue an official Milky Mist appointment offer letter."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    res = create_offer_letter(body.dict(), user=user["username"])
    return {"success": True, "data": res, "message": "Official offer letter generated successfully."}


@app.put("/api/offers/{offer_id}/status")
async def api_update_offer_status(offer_id: int, body: UpdateOfferStatusRequest, request: Request):
    """Update offer acceptance status."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    success = update_offer_status(offer_id, body.status, user=user["username"])
    return {"success": success, "message": f"Offer letter status updated to {body.status}."}


# ==============================================================================
# Leave & Time-Off Management Endpoints
# ==============================================================================

class CreateLeaveRequestModel(BaseModel):
    emp_id: str
    leave_type: str
    start_date: str
    end_date: str
    days_count: float
    reason: str
    handover_to: Optional[str] = ""


class UpdateLeaveStatusModel(BaseModel):
    status: str
    admin_notes: Optional[str] = ""


@app.get("/api/leaves")
async def api_get_leaves(
    status: Optional[str] = None,
    emp_id: Optional[str] = None,
    search: Optional[str] = None,
    request: Request = None,
):
    """Retrieve list of staff leave requests."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    requests = get_leave_requests(status=status, emp_id=emp_id, search=search)
    return {"success": True, "count": len(requests), "data": requests}


@app.get("/api/leaves/stats")
async def api_get_leave_stats(request: Request = None):
    """Retrieve leave telemetry KPI statistics."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    stats = get_leave_stats()
    return {"success": True, "data": stats}


@app.get("/api/leaves/balances")
async def api_get_leave_balances(emp_id: Optional[str] = None, request: Request = None):
    """Retrieve workforce leave quotas and balance utilization."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    balances = get_leave_balances(emp_id=emp_id)
    return {"success": True, "count": len(balances), "data": balances}


@app.post("/api/leaves")
async def api_create_leave(body: CreateLeaveRequestModel, request: Request):
    """Submit a formal employee leave request."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    try:
        res = create_leave_request(
            emp_id=body.emp_id,
            leave_type=body.leave_type,
            start_date=body.start_date,
            end_date=body.end_date,
            days_count=body.days_count,
            reason=body.reason,
            handover_to=body.handover_to or "",
            requested_by=user["username"],
        )
        return {"success": True, "data": res, "message": "Leave application submitted successfully."}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/api/leaves/{leave_id}/status")
async def api_update_leave_status(leave_id: str, body: UpdateLeaveStatusModel, request: Request):
    """Approve or reject a staff leave application."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    try:
        res = update_leave_status(
            leave_id=leave_id,
            status=body.status,
            admin_notes=body.admin_notes or "",
            action_user=user["username"],
        )
        return {"success": True, "data": res, "message": f"Leave request {leave_id} {body.status.lower()}."}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/candidates/{app_id}/offer-status")
async def api_candidate_offer_status(app_id: str, request: Request = None):
    """Check if candidate has an active offer letter issued."""
    app_id = normalize_app_id(app_id)
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    offer = get_candidate_offer_status(app_id)
    return {"success": True, "has_offer": offer is not None, "offer": offer}


# ==========================================================================
# Recruitment Pipeline & Workflow Endpoints
# ==========================================================================

class WorkflowUpdateModel(BaseModel):
    stages: List[str]

class PipelineStageUpdateModel(BaseModel):
    stage: str
    completed: bool

class PipelineStatusUpdateModel(BaseModel):
    status: str

class PipelineOnboardModel(BaseModel):
    department: Optional[str] = "Human Resources"
    designation: Optional[str] = "Executive"
    joining_date: Optional[str] = None
    ctc: Optional[float] = 0.0
    blood_group: Optional[str] = ""
    emergency_contact: Optional[str] = ""
    shift: Optional[str] = "General"


class BatchPipelineStatusModel(BaseModel):
    app_ids: List[str]
    status: str


class BatchPipelineOnboardModel(BaseModel):
    app_ids: List[str]
    department: Optional[str] = "Dairy Processing & Production"
    designation: Optional[str] = "Operations Staff"


@app.get("/api/recruitment/workflow")
async def api_get_recruitment_workflow(request: Request):
    """Get active workflow stages list."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    stages = get_recruitment_workflow_stages()
    return {"success": True, "stages": stages}


@app.put("/api/recruitment/workflow")
async def api_save_recruitment_workflow(body: WorkflowUpdateModel, request: Request):
    """Update workflow stages sequence."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    if not body.stages or len(body.stages) == 0:
        raise HTTPException(status_code=400, detail="Workflow must have at least one stage.")
    saved = save_recruitment_workflow_stages(body.stages, user["username"])
    return {"success": True, "stages": saved, "message": "Recruitment workflow updated."}


@app.get("/api/recruitment/candidates/{app_id}/workflow")
async def api_get_candidate_workflow(app_id: str, request: Request):
    """Retrieve stages for a candidate (custom if set, or default)."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    real_app_id = normalize_app_id(app_id)
    pipe_dict = get_candidate_pipeline_dict()
    cand_pipe = pipe_dict.get(real_app_id, {})
    stages = get_candidate_workflow_stages(real_app_id)
    return {
        "success": True,
        "app_id": real_app_id,
        "stages": stages,
        "has_custom_workflow": bool(cand_pipe.get("custom_stages")),
        "default_stages": get_recruitment_workflow_stages()
    }


@app.put("/api/recruitment/candidates/{app_id}/workflow")
async def api_save_candidate_workflow(app_id: str, body: WorkflowUpdateModel, request: Request):
    """Update or reset custom workflow stages for an individual candidate."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    real_app_id = normalize_app_id(app_id)
    stages = body.stages if (body.stages and len(body.stages) > 0) else None
    try:
        saved = save_candidate_custom_workflow(real_app_id, stages, user["username"])
        return {
            "success": True,
            "app_id": real_app_id,
            "stages": saved,
            "has_custom_workflow": bool(stages),
            "message": f"Workflow for candidate {real_app_id} updated successfully."
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update candidate workflow: {str(e)}")


@app.get("/api/recruitment/candidates")
async def api_get_recruitment_candidates(request: Request, search: str = "", status: str = ""):
    """List approved candidates with their current recruitment pipeline progress and stages."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    res = get_pipeline_candidates_with_stages(search=search, status_filter=status)
    return {
        "success": True,
        "data": res["candidates"],
        "stages": res["stages"],
        "counts": res["counts"],
        "total": len(res["candidates"])
    }


@app.put("/api/recruitment/candidates/{app_id}/stage")
async def api_update_pipeline_stage(app_id: str, body: PipelineStageUpdateModel, request: Request):
    """Toggle completion for a specific recruitment workflow stage."""
    app_id = normalize_app_id(app_id)
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    try:
        updated = update_candidate_pipeline_stage(app_id, body.stage, body.completed, user["username"])
        return {"success": True, "data": updated, "message": f"Stage '{body.stage}' updated."}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/api/recruitment/candidates/{app_id}/status")
async def api_update_pipeline_status(app_id: str, body: PipelineStatusUpdateModel, request: Request):
    """Change recruitment status (e.g. on_hold, in_progress, ready_to_onboard, onboarded, rejected)."""
    app_id = normalize_app_id(app_id)
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    try:
        updated = update_candidate_pipeline_status(app_id, body.status, user["username"])
        return {"success": True, "data": updated, "message": f"Recruitment status updated to {body.status}."}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/recruitment/candidates/{app_id}/onboard")
async def api_onboard_candidate(app_id: str, body: PipelineOnboardModel, request: Request):
    """Promote an approved recruitment candidate to full Onboarded Employee."""
    app_id = normalize_app_id(app_id)
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    try:
        emp = onboard_candidate_pipeline(app_id, body.dict(), user["username"])
        return {
            "success": True,
            "data": emp,
            "message": f"Candidate successfully onboarded as employee {emp.get('emp_id')}!",
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


class StartRecruitmentModel(BaseModel):
    target_role: Optional[str] = ""
    department: Optional[str] = ""
    assigned_recruiter: Optional[str] = ""
    initial_status: Optional[str] = "in_progress"
    notes: Optional[str] = ""


class BatchStartRecruitmentModel(BaseModel):
    app_ids: List[str]
    target_role: Optional[str] = ""
    department: Optional[str] = ""
    assigned_recruiter: Optional[str] = ""
    initial_status: Optional[str] = "in_progress"
    notes: Optional[str] = ""


@app.post("/api/recruitment/candidates/{app_id}/start-recruitment")
async def api_start_candidate_recruitment(
    app_id: str,
    request: Request,
    body: Optional[StartRecruitmentModel] = None,
):
    """Start active recruitment for an approved candidate with target role and assigned recruiter."""
    app_id = normalize_app_id(app_id)
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    
    target_role = body.target_role if body else ""
    department = body.department if body else ""
    assigned_recruiter = body.assigned_recruiter if body else ""
    initial_status = body.initial_status if body else "in_progress"
    notes = body.notes if body else ""

    try:
        res = enroll_candidate_in_recruitment(
            app_id=app_id,
            user=user["username"],
            target_role=target_role or "",
            department=department or "",
            assigned_recruiter=assigned_recruiter or "",
            initial_status=initial_status or "in_progress",
            notes=notes or ""
        )
        return {
            "success": True,
            "data": res,
            "message": f"Recruitment initiated for candidate {app_id} successfully.",
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/recruitment/candidates/batch-start-recruitment")
async def api_batch_start_recruitment(
    body: BatchStartRecruitmentModel,
    request: Request
):
    """Batch start recruitment for multiple approved candidates."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    
    success_ids = []
    errors = []
    for raw_id in body.app_ids:
        app_id = normalize_app_id(raw_id)
        try:
            enroll_candidate_in_recruitment(
                app_id=app_id,
                user=user["username"],
                target_role=body.target_role or "",
                department=body.department or "",
                assigned_recruiter=body.assigned_recruiter or "",
                initial_status=body.initial_status or "in_progress",
                notes=body.notes or ""
            )
            success_ids.append(app_id)
        except Exception as e:
            errors.append(f"{app_id}: {str(e)}")

    return {
        "success": True,
        "enrolled": success_ids,
        "count": len(success_ids),
        "errors": errors,
        "message": f"Successfully started recruitment for {len(success_ids)} candidates."
    }


@app.post("/api/recruitment/candidates/{app_id}/withdraw")
async def api_withdraw_candidate_from_recruitment(app_id: str, request: Request):
    """Withdraw a candidate from active recruitment back to the Approved Resumes talent pool."""
    app_id = normalize_app_id(app_id)
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    try:
        ok = withdraw_candidate_from_recruitment(app_id, user["username"])
        if not ok:
            raise HTTPException(status_code=404, detail=f"Candidate {app_id} is not in recruitment pipeline.")
        return {
            "success": True,
            "message": f"Candidate {app_id} successfully withdrawn from recruitment and returned to Approved Talent Pool."
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/recruitment/candidates/{app_id}/enroll")
async def api_enroll_candidate_to_recruitment(app_id: str, request: Request):
    """Legacy alias: Pass an approved candidate from Approved Resumes into the active Recruitment pipeline."""
    app_id = normalize_app_id(app_id)
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    try:
        res = enroll_candidate_in_recruitment(app_id, user["username"])
        return {
            "success": True,
            "data": res,
            "message": f"Candidate {app_id} has been passed to the Recruitment pipeline.",
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/api/recruitment/batch/status")
async def api_batch_update_pipeline_status(body: BatchPipelineStatusModel, request: Request):
    """Batch update recruitment pipeline status (e.g. reject, on_hold, in_progress, ready_to_onboard)."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    
    updated = []
    errors = []
    for raw_id in body.app_ids:
        app_id = normalize_app_id(raw_id)
        try:
            update_candidate_pipeline_status(app_id, body.status, user["username"])
            updated.append(app_id)
        except Exception as e:
            errors.append(f"{app_id}: {str(e)}")
            
    return {
        "success": True,
        "updated": updated,
        "count": len(updated),
        "errors": errors,
        "message": f"Successfully updated {len(updated)} candidate(s) to '{body.status}'."
    }


@app.post("/api/recruitment/batch/onboard")
async def api_batch_onboard_candidates(body: BatchPipelineOnboardModel, request: Request):
    """Batch onboard multiple approved candidates."""
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    
    from services.db import get_candidate
    onboarded = []
    errors = []
    for raw_id in body.app_ids:
        app_id = normalize_app_id(raw_id)
        try:
            c = get_candidate(app_id) or {}
            emp_data = {
                "name": c.get("name") or f"Candidate {app_id}",
                "email": c.get("email") or "",
                "phone": c.get("phone") or "",
                "location": c.get("location") or "Perundurai Mega Plant (HQ)",
                "department": body.department or "Dairy Processing & Production",
                "designation": body.designation or "Operations Staff",
                "employment_type": "Permanent",
                "joining_date": datetime.now().strftime("%Y-%m-%d"),
                "salary": 450000,
                "blood_group": "O+"
            }
            emp = onboard_candidate_pipeline(app_id, emp_data, user["username"])
            onboarded.append({"app_id": app_id, "emp_id": emp.get("emp_id")})
        except Exception as e:
            errors.append(f"{app_id}: {str(e)}")
            
    return {
        "success": True,
        "onboarded": onboarded,
        "count": len(onboarded),
        "errors": errors,
        "message": f"Successfully onboarded {len(onboarded)} candidate(s)!"
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("admin_app:app", host="0.0.0.0", port=8001, reload=True)

