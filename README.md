# HR Recruitment & Candidate Management System

A web-based recruitment and candidate evaluation platform featuring automated resume parsing, applicant tracking, workflow stages, and onboarding management.

---

## Architecture & Tech Stack

- **Backend**: Python 3.10+, FastAPI, Uvicorn, SQLite
- **Frontend**: HTML5, CSS3, Vanilla JS / React components
- **Document Parsing & Extraction**: `pdfplumber`, `python-docx`, `pytesseract` (OCR fallback), `spacy`

---

## Project Structure

```text
├── app.py                  # Candidate Intake Portal (Port 8000)
├── admin_app.py            # Admin HR Dashboard & Pipeline API (Port 8001)
├── extractor/              # NLP entity extraction and info heuristics
├── parsers/                # PDF, DOCX, and Image parser modules
├── services/               # Database access and auth management (SQLite)
├── static/                 # Candidate Portal frontend assets
├── static_admin/           # Admin Dashboard frontend assets
├── tests/                  # Extraction and parsing tests
├── requirements.txt        # Python dependencies
└── README.md
```

---

## Getting Started

### 1. Prerequisites
- Python 3.10 or higher
- Git

### 2. Setup & Installation

```bash
# Clone the repository
git clone https://github.com/ND014/HR_recruitment.git
cd HR_recruitment

# Create and activate a virtual environment
python -m venv .venv

# Windows:
.\.venv\Scripts\activate

# macOS / Linux:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Download the spaCy English model
python -m spacy download en_core_web_sm
```

---

## Running the Applications

The system runs on two services:

### 1. Candidate Application Portal (Port 8000)
Handles resume submission, format parsing, and application intake.
```bash
uvicorn app:app --host 127.0.0.1 --port 8000 --reload
```
Access at: `http://localhost:8000`

### 2. Admin HR Dashboard (Port 8001)
Applicant review, customizable workflow evaluation stages, bulk actions, and employee directory onboarding.
```bash
uvicorn admin_app:app --host 127.0.0.1 --port 8001 --reload
```
Access at: `http://localhost:8001`

**Default Credentials:**
- `dev123` / `123456` (Developer)
- `admin123` / `123456` (HR Administrator)

---

## Running Tests

```bash
python tests/test_extraction.py
```

---

## Future Enhancements / Contributing

Contributions and enhancements are welcome. Suggested areas for extension:
- Integration with third-party job boards and email notifications (SMTP/SendGrid).
- Automated interview scheduling and calendar integrations.
- Role-based permissions expansion and advanced analytics reporting.
