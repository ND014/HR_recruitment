# Resume Data Extractor

A web application designed to extract structured information from resumes submitted in `.docx`, `.pdf`, and image formats (`.png`, `.jpg`, `.jpeg`).

## Features

- **Multi-Format Ingestion**:
  - Word documents (`.docx`) with paragraph and table hierarchy extraction.
  - PDF files (`.pdf`) with text extraction and automatic OCR fallback for scanned documents.
  - Image files (`.png`, `.jpg`, `.jpeg`, `.tiff`, `.bmp`) with Tesseract OCR and image preprocessing (grayscale, contrast enhancement).
- **Target Information Extraction**:
  - **Name**: Combines spaCy Named Entity Recognition (`PERSON`) with positional heuristics.
  - **Age / DOB**: Explicit age detection (`Age: 29`, `29 years old`) and Date of Birth parsing with calculated age.
  - **Phone Number**: Robust international and domestic regex.
  - **Education**: Degrees (B.Tech, B.S., M.S., MBA, Ph.D, etc.), university/institution name, duration, and GPA/grades.
  - **Work Experience**: Job roles, company names, employment durations, total years calculation, and key responsibility bullets.
- **Minimalist Web UI**:
  - Strictly no logos or branding.
  - Drag-and-drop file upload.
  - Structured card dashboard with copyable and downloadable JSON export.
  - Raw text inspector to verify parser and OCR text.

## Running the Application

### Option 1: Double-click `run.bat`
Or in PowerShell / Command Prompt:
```powershell
cd C:\Users\NITHISH\.gemini\antigravity\scratch\resume-data-extractor
.\run.bat
```

### Option 2: Run directly with the virtual environment
```powershell
cd C:\Users\NITHISH\.gemini\antigravity\scratch\resume-data-extractor
.\.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8000 --reload
```

Open your browser at **[http://localhost:8000](http://localhost:8000)**.

## Running Tests
```powershell
.\.venv\Scripts\python.exe tests/test_extraction.py
```
