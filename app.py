import os
import json
from typing import Optional
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from services.db import save_candidate, get_all_candidates, find_existing_candidate, UPLOADS_DIR

app = FastAPI(title="Candidate Application & Intake API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(UPLOADS_DIR, exist_ok=True)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", response_class=HTMLResponse)
async def serve_index():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(
            index_path,
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0"
            }
        )
    return "<h1>Candidate Application Form</h1><p>UI loading...</p>"


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "Candidate Application & Intake"}


@app.post("/api/submit")
async def submit_application(
    name: str = Form(...),
    email: str = Form(...),
    dob: str = Form(...),
    location: str = Form(...),
    phone_number: str = Form(...),
    education: str = Form(...),
    work_experience: str = Form(...),
    resume: Optional[UploadFile] = File(None),
):
    """
    Candidate intake endpoint:
    Receives candidate details (Name, Email, DOB, Location, Phone, Education, Work Experience),
    calculates Age from DOB, optionally stores uploaded resume PDF (max 5 MB), and saves record to SQL.
    """
    if not name.strip():
        raise HTTPException(status_code=400, detail="Candidate full name is required.")
    if not email.strip():
        raise HTTPException(status_code=400, detail="Email address is required.")
    if not dob.strip():
        raise HTTPException(status_code=400, detail="Date of Birth is required.")
    if not location.strip():
        raise HTTPException(status_code=400, detail="Location is required.")
    if not phone_number.strip():
        raise HTTPException(status_code=400, detail="Phone number is required.")

    resume_bytes = None
    resume_filename = None
    MAX_FILE_SIZE = 5 * 1024 * 1024  # 5 MB

    if resume and resume.filename:
        filename = resume.filename
        ext = os.path.splitext(filename)[1].lower()
        if ext != ".pdf":
            raise HTTPException(
                status_code=400,
                detail=f"Invalid resume format '{ext}'. Only PDF files (.pdf) are accepted.",
            )
        resume_bytes = await resume.read()
        if len(resume_bytes) > MAX_FILE_SIZE:
            size_mb = len(resume_bytes) / (1024 * 1024)
            raise HTTPException(
                status_code=400,
                detail=f"Uploaded PDF resume is too large ({size_mb:.1f} MB). Maximum allowed size is 5 MB.",
            )
        if len(resume_bytes) == 0:
            resume_bytes = None
        else:
            resume_filename = filename

    try:
        record = save_candidate(
            name=name,
            email=email,
            dob_str=dob,
            location=location,
            phone=phone_number,
            education=education,
            work_experience=work_experience,
            resume_bytes=resume_bytes,
            resume_filename=resume_filename,
        )
    except ValueError as ve:
        raise HTTPException(
            status_code=400,
            detail=str(ve),
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to save application: {str(e)}",
        )

    return {
        "success": True,
        "message": "Candidate application successfully saved!",
        "data": record,
    }


@app.get("/api/check-applicant")
async def check_applicant(phone: str = "", email: str = ""):
    """Check if an applicant with this mobile number or email already exists."""
    existing = find_existing_candidate(phone=phone, email=email)
    if existing:
        return {
            "exists": True,
            "app_id": existing["app_id"],
            "name": existing["name"],
            "phone": existing["phone"],
            "email": existing["email"],
            "created_at": existing["created_at"],
            "status": existing["status"],
        }
    return {"exists": False}


@app.get("/api/submissions")
async def get_submissions():
    """Retrieve all submitted candidate records from the database."""
    records = get_all_candidates()
    # Map field names to match what the frontend expects
    mapped = []
    for r in records:
        mapped.append({
            "id": r.get("app_id", ""),
            "timestamp": r.get("created_at", ""),
            "name": r.get("name", ""),
            "email": r.get("email", ""),
            "dob": r.get("dob", ""),
            "age": r.get("age", ""),
            "location": r.get("location", ""),
            "phone_number": r.get("phone", ""),
            "education": r.get("education", ""),
            "work_experience": r.get("work_experience", ""),
            "resume_filename": r.get("resume_filename", ""),
            "resume_path": r.get("resume_path", ""),
        })
    return {"success": True, "count": len(mapped), "data": mapped}


@app.get("/api/resume/{filename}")
async def get_uploaded_resume(filename: str):
    """View or download an uploaded resume PDF."""
    safe_filename = os.path.basename(filename)
    file_path = os.path.join(UPLOADS_DIR, safe_filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Resume file not found.")
    return FileResponse(
        file_path, filename=safe_filename, media_type="application/pdf"
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
