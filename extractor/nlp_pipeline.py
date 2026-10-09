import re
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional
import dateparser

# Suppress verbose pdfminer logs if any
logging.getLogger("pdfminer").setLevel(logging.ERROR)

# Attempt to load spacy; provide fallback if model is not available
nlp = None
try:
    import spacy
    try:
        nlp = spacy.load("en_core_web_sm")
    except Exception:
        nlp = spacy.blank("en")
except Exception:
    nlp = None


# Exclusion lists for candidate names
FALSE_NAME_WORDS = {
    "resume", "curriculum", "vitae", "cv", "profile", "summary", "contact", 
    "education", "experience", "work", "skills", "projects", "certifications",
    "personal", "details", "information", "phone", "email", "address", 
    "objective", "declaration", "languages", "hobbies", "interests",
    "developer", "engineer", "manager", "designer", "architect", "analyst",
    "page", "github", "linkedin", "portfolio", "website", "date", "birth",
    "responsibilities", "technical", "technologies", "qualifications", "achievements"
}

# Exhaustive Degree Patterns & Abbreviations (Undergraduate, Postgraduate, Doctorate, Associate)
DEGREE_ABBR_PAT = re.compile(
    r'\b(?:'
    r'Bachelor(?:\'s)?(?:[ \t]+(?:of|in)[ \t]+[A-Za-z \t&/.+-]{2,50})?|'
    r'Master(?:\'s)?(?:[ \t]+(?:of|in)[ \t]+[A-Za-z \t&/.+-]{2,50})?|'
    r'Associate(?:\'s)?(?:[ \t]+(?:of|in)[ \t]+[A-Za-z \t&/.+-]{2,50}|[ \t]+Degree)?|'
    r'Doctor\s+of\s+Philosophy|Doctorate|Postdoc(?:torate)?|'
    r'B\.?\s*Tech(?:\.|\b)|M\.?\s*Tech(?:\.|\b)|'
    r'B\.?\s*Arch(?:\.|\b)|M\.?\s*Arch(?:\.|\b)|'
    r'B\.?\s*Pharm(?:\.|\b)|M\.?\s*Pharm(?:\.|\b)|'
    r'B\.?\s*Des(?:\.|\b)|M\.?\s*Des(?:\.|\b)|'
    r'B\.?\s*Ed(?:\.|\b)|M\.?\s*Ed(?:\.|\b)|'
    r'B\.?\s*Com(?:m)?(?:\.|\b)|M\.?\s*Com(?:\.|\b)|'
    r'B\.?\s*B\.?\s*A(?:\.|\b)|M\.?\s*B\.?\s*A(?:\.|\b)|'
    r'B\.?\s*C\.?\s*A(?:\.|\b)|M\.?\s*C\.?\s*A(?:\.|\b)|'
    r'B\.?\s*Sc(?:\.|\b)(?:\s*\((?:Hons|Honours|Honors)\))?|M\.?\s*Sc(?:\.|\b)|'
    r'B\.?\s*S\.?\s*W(?:\.|\b)|M\.?\s*S\.?\s*W(?:\.|\b)|'
    r'B\.?\s*F\.?\s*A(?:\.|\b)|M\.?\s*F\.?\s*A(?:\.|\b)|'
    r'B\.?\s*H\.?\s*M(?:\.|\b)|M\.?\s*P\.?\s*A(?:\.|\b)|'
    r'B\.?\s*Voc(?:\.|\b)|M\.?\s*P\.?\s*H(?:\.|\b)|'
    r'LL\.?\s*B(?:\.|\b)|LL\.?\s*M(?:\.|\b)|'
    r'MBBS|BDS|BAMS|BHMS|BVSc|PGDM|PGDHRM|MMS|'
    r'Ph\.?\s*D(?:\.|\b)|D\.?\s*Phil(?:\.|\b)|Sc\.?\s*D(?:\.|\b)|Ed\.?\s*D(?:\.|\b)|DBA|'
    r'B\.?\s*E(?:\.|\b)(?:\s*\((?:Hons|Honours|Honors)\))?|M\.?\s*E(?:\.|\b)|'
    r'B\.?\s*S(?:\.|\b)(?:\s*\((?:Hons|Honours|Honors)\))?|M\.?\s*S(?:\.|\b)|'
    r'B\.?\s*A(?:\.|\b)(?:\s*\((?:Hons|Honours|Honors)\))?|M\.?\s*A(?:\.|\b)|'
    r'A\.?\s*A(?:\.|\b)|A\.?\s*S(?:\.|\b)|M\.?\s*D(?:\.|\b)'
    r')(?:[ \t]*(?:in|of|\/|-|–|,|\(|\:)?[ \t]*(?:[A-Za-z0-9 \t&/.+-]{2,60}\)?)?)?',
    re.I
)

# University and College keyword synonyms and abbreviations
UNIV_COLLEGE_KW = re.compile(
    r'\b(?:university|universities|univ\.?|univeristy|universite|universiteit|college|colleges|coll\.?|clg\.?|collg|campus|institute\s+of\s+technology|institute\s+of\s+management|institute\s+of\s+science|polytechnic|faculty\s+of|MIT|Caltech|Stanford|Harvard|Oxford|Cambridge|Imperial|IIT|NIT|IIIT|IIM|BITS|NUS|NTU)\b',
    re.IGNORECASE
)

# Institution name pattern
INSTITUTION_NAME_PAT = re.compile(
    r'((?:University\s+of\s+[A-Za-z\s&.,\'-]+)|(?:[A-Z0-9][A-Za-z0-9\s&.\',-]{2,55}(?:University|College|Univ|Coll|Clg|Campus)[A-Za-z0-9\s&.\',-]*))',
    re.IGNORECASE
)

# Grades, Honours, Academic performance patterns
GRADE_PAT = re.compile(
    r'(?:(?:First|Second|Third)\s+(?:Class|Upper(?:\s+Division)?|Lower(?:\s+Division)?)|Distinction|Merit|Cum\s+Laude|Magna\s+Cum\s+Laude|Summa\s+Cum\s+Laude|(?:GPA|CGPA)\s*[:\-]?\s*\d+(?:\.\d+)?(?:\s*/\s*\d+)?|Average\s*[:\-]?\s*\d+(?:\.\d+)?%|\d+(?:\.\d+)?%|Average\s*[:\-]?\s*\d+(?:\.\d+)?)',
    re.IGNORECASE
)

HONORS_PAT = re.compile(
    r'(?:Final\s+Year\s+Project\s*\([^)]*\)\s*[:\-]?\s*[A-Za-z\s]+|Dean\'s\s+List)',
    re.IGNORECASE
)

EXCHANGE_PAT = re.compile(
    r'\b(?:\d+[- ](?:year|month|term|semester)\s+)?(?:academic\s+)?exchange(?:\s+student|\s+programme|\s+program)?\b',
    re.IGNORECASE
)

# Core job title and role synonyms
JOB_KEYWORDS = [
    "engineer", "developer", "architect", "scientist", "analyst", "manager",
    "consultant", "specialist", "administrator", "director", "lead", "officer",
    "intern", "internship", "assistant", "technician", "executive", "programmer", "designer",
    "tester", "coordinator", "strategist", "researcher", "founder", "co-founder",
    "cofounder", "cto", "ceo", "cpo", "coo", "cfo", "vp", "president", "partner",
    "principal", "staff", "sde", "swe", "mts", "sdet", "sre", "devops", "sysadmin",
    "dba", "recruiter", "trainee", "apprentice", "fellow", "head of", "associate",
    "instructor", "representative", "writer", "marketer", "auditor", "accountant"
]

MONTH_NAMES = r'(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)'
YEAR_PAT = r'(?:19|20)\d{2}'
PRESENT_PAT = r'(?:Present|Current|Till Date|To Date|Ongoing|Continuing)'

# Matches single-year spans (e.g. June - September 2025, June-September 2024) and multi-year spans
DATE_RANGE_PAT = re.compile(
    rf'\b(?:'
    rf'{MONTH_NAMES}\.?\s*[-–—/]\s*{MONTH_NAMES}\.?\s*,?\s*{YEAR_PAT}|'
    rf'{MONTH_NAMES}\.?\s*,?\s*{YEAR_PAT}\s*[-–—/]\s*(?:{MONTH_NAMES}\.?\s*,?\s*{YEAR_PAT}|{PRESENT_PAT})|'
    rf'{YEAR_PAT}\s*[-–—/]\s*(?:{YEAR_PAT}|{PRESENT_PAT})|'
    rf'{MONTH_NAMES}\.?\s*,?\s*{YEAR_PAT}\s*[-–—/]\s*{PRESENT_PAT}'
    rf')\b',
    re.IGNORECASE
)

MONTH_MAP = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12
}


def clean_text(raw_text: str) -> str:
    """Normalize line endings, remove multiple blank lines, fix OCR joined words, replace replacement chars."""
    if not raw_text:
        return ""
    text = raw_text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\u00a0", " ").replace("\t", " ")
    text = text.replace("\ufffd", " — ")
    # Fix OCR joined words like 'Scientistat' or 'Developerin'
    text = re.sub(r"([A-Za-z]{3,})(at|in|from|to|by)([A-Z])", r"\1 \2 \3", text)
    text = re.sub(r"\b([A-Za-z]*(?:Scientist|Engineer|Developer|Manager|Analyst|Consultant|Architect|Lead|Director|Intern|Designer|Officer|Administrator))at\b", r"\1 at", text, flags=re.IGNORECASE)
    lines = [re.sub(r"[ ]{2,}", " ", line.strip()) for line in text.split("\n")]
    return "\n".join(lines)


def extract_sections(text: str) -> Dict[str, str]:
    """Segment text into logical resume sections using extensive header synonyms."""
    section_headers = {
        "EXPERIENCE": [
            r"work\s+experience", r"professional\s+experience", r"employment\s+history",
            r"experience(?:s)?", r"work\s+history", r"career\s+history", r"career\s+summary",
            r"employment", r"positions\s+held", r"professional\s+background",
            r"relevant\s+experience", r"internships?(?:\s*&|\s+and)?\s*experience",
            r"internships?", r"work\s+summary", r"work\s+profile", r"industry\s+experience",
            r"professional\s+employment", r"job\s+history", r"practical\s+experience",
            r"hands-on\s+experience", r"projects?\s*(?:&|and)\s*experience",
            r"professional\s+journey", r"career\s+profile"
        ],
        "EDUCATION": [
            r"education(?:\s*(?:&|and|\/)\s*certifications?)?(?:\s+background|\s+details|\s+qualifications?|\s+profile|\s+record)?",
            r"academic(?:s)?(?:\s+background|\s+qualifications?|\s+details|\s+profile|\s+record)?",
            r"qualifications?", r"scholastic(?:\s+record|\s+achievements?)?",
            r"degrees?", r"higher\s+education", r"university\s+education",
            r"education\s*(?:&|and)\s*training", r"academic\s+credentials"
        ],
        "CERTIFICATIONS": [
            r"certifications?", r"certificates?", r"licenses?\s*(?:&|and)\s*certifications?"
        ],
        "SKILLS": [
            r"(?:key\s+)?competencies",
            r"technical\s+skills", r"skills\s*(?:&|and)\s*tools", r"skills",
            r"core\s+competencies", r"technologies", r"areas\s+of\s+expertise",
            r"technical\s+proficiencies", r"tools\s*(?:&|and)\s*technologies"
        ],
        "PROJECTS": [
            r"projects?", r"personal\s+projects?", r"academic\s+projects?",
            r"key\s+projects", r"notable\s+projects"
        ],
        "PERSONAL": [
            r"personal\s+details", r"personal\s+information", r"contact(?:\s+information)?",
            r"about\s+me", r"personal\s+profile", r"bio"
        ]
    }

    lines = text.split("\n")
    current_section = "HEADER"
    sections = {key: [] for key in section_headers}
    sections["HEADER"] = []

    for line in lines:
        stripped = line.strip().lower()
        if not stripped:
            continue
        
        matched_section = None
        if len(stripped.split()) <= 6:
            for sec_name, patterns in section_headers.items():
                for pat in patterns:
                    if re.fullmatch(pat, stripped, re.IGNORECASE) or re.match(r"^" + pat + r"[:\s]*$", stripped, re.IGNORECASE):
                        matched_section = sec_name
                        break
                if matched_section:
                    break

        if matched_section:
            current_section = matched_section
        else:
            sections[current_section].append(line)

    return {k: "\n".join(v).strip() for k, v in sections.items()}


def extract_name(text: str) -> str:
    """Extract candidate's name using spaCy NER combined with top-of-resume heuristics."""
    lines = [line.strip() for line in text.split("\n") if line.strip()]
    if not lines:
        return "Not specified"

    # 1. Inspect top 5 lines for a likely name
    for line in lines[:5]:
        if "@" in line or "http" in line or re.search(r"\d{5,}", line):
            continue
        
        words = line.split()
        if 2 <= len(words) <= 4:
            lower_words = [w.lower().strip(".,:;()") for w in words]
            if not any(w in FALSE_NAME_WORDS for w in lower_words):
                if all(w.istitle() or w.isupper() for w in words if w.isalpha()):
                    return " ".join(w.capitalize() for w in words if w.isalpha())

    # 2. Try spaCy NER on the first 800 characters
    if nlp:
        doc = nlp(text[:800])
        for ent in doc.ents:
            if ent.label_ == "PERSON":
                cand = ent.text.strip()
                words = cand.split()
                if 2 <= len(words) <= 4:
                    lower_words = [w.lower().strip(".,:;()") for w in words]
                    if not any(w in FALSE_NAME_WORDS for w in lower_words):
                        return " ".join(w.capitalize() for w in words if w.isalpha())

    return "Not specified"


def extract_phone(text: str) -> str:
    """Extract phone number using comprehensive international & domestic regex."""
    patterns = [
        r"(?:(?:\+91|91|0)[-.\s]?)?[6-9]\d{4}[-.\s]?\d{5}",
        r"(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}",
        r"\+?\d{1,3}[-.\s]\d{3,4}[-.\s]\d{3,4}",
        r"\b\d{10}\b"
    ]

    for pat in patterns:
        matches = re.findall(pat, text)
        for match in matches:
            cleaned = re.sub(r"[^\d+]", "", match)
            digits_only = re.sub(r"\D", "", cleaned)
            if 10 <= len(digits_only) <= 13:
                if not (digits_only.startswith("20") and len(digits_only) == 10 and digits_only[4:6] == "20"):
                    return match.strip()

    return "Not specified"


def extract_age(text: str) -> str:
    """Extract explicit age or calculate it from Date of Birth (DOB)."""
    age_patterns = [
        r"\b(?:age|aged)\s*[:\-]?\s*(\d{1,2})\b",
        r"\b(\d{1,2})\s*(?:years?\s*old|yrs?\s*old)\b",
    ]
    for pat in age_patterns:
        match = re.search(pat, text, re.IGNORECASE)
        if match:
            age_val = int(match.group(1))
            if 16 <= age_val <= 80:
                return f"{age_val} years"

    dob_patterns = [
        r"\b(?:dob|date\s+of\s+birth|d\.o\.b\.?|birth\s*date)\s*[:\-]?\s*([0-9]{1,2}[-/.][0-9]{1,2}[-/.][0-9]{2,4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4})\b"
    ]
    for pat in dob_patterns:
        match = re.search(pat, text, re.IGNORECASE)
        if match:
            raw_dob = match.group(1).strip()
            parsed_date = dateparser.parse(raw_dob)
            if parsed_date:
                current_year = 2026
                calculated_age = current_year - parsed_date.year
                if 16 <= calculated_age <= 85:
                    return f"{calculated_age} years (Calculated from DOB: {raw_dob})"

    return "Not specified"


def extract_education(text: str, sections: Dict[str, str]) -> List[Dict[str, Any]]:
    """
    Extract education items using exhaustive degree abbreviations (BA, BSc, BTech, MBA, MCA, PhD, etc.)
    STRICT REQUIREMENT: Only includes entries where the institution explicitly references a
    university or college (using synonyms: university, college, clg, univ, campus, etc.).
    Non-university courses, bootcamps, and secondary schools are excluded.
    """
    edu_text = sections.get("EDUCATION", "")
    search_lines = [l.strip() for l in edu_text.split("\n") if l.strip()]
    if len(search_lines) < 2:
        search_lines = [l.strip() for l in text.split("\n") if l.strip()]

    date_range_pat = re.compile(
        r"\b((?:(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*)?(?:19|20)\d{2}\s*[-–—/]\s*(?:(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*)?(?:19|20)\d{2}|Present|Current))|(?:19|20)\d{2})\b",
        re.IGNORECASE
    )

    extracted = []
    seen_institutions = set()

    for i, line in enumerate(search_lines):
        if not UNIV_COLLEGE_KW.search(line):
            continue

        # Extract institution name
        inst_match = INSTITUTION_NAME_PAT.search(line)
        if inst_match:
            raw_inst = inst_match.group(1).strip()
        else:
            raw_inst = line

        # Clean out dates, brackets, or trailing characters from institution name
        clean_inst = re.sub(r"[,|–— -]?\s*\b(?:19|20)\d{2}\b.*$", "", raw_inst)
        clean_inst = re.sub(r"\(.*?\)", "", clean_inst).strip().rstrip(" ,.-|()")
        if not clean_inst or clean_inst.lower() in seen_institutions:
            continue

        seen_institutions.add(clean_inst.lower())

        # 1. Degree check: inspect previous lines (support multi-line joined titles)
        degree_str = "Not specified"
        for j in range(max(0, i - 2), i):
            cand = search_lines[j]
            if j + 1 < i and any(cand.rstrip().endswith(w) for w in ["with", "in", "and", "&", "of"]):
                cand = cand + " " + search_lines[j + 1]
            dm = DEGREE_ABBR_PAT.search(cand)
            if dm:
                degree_str = dm.group(0).strip()
                break

        # Check line itself
        if degree_str == "Not specified":
            dm = DEGREE_ABBR_PAT.search(line)
            if dm:
                cand_deg = dm.group(0).strip()
                cand_deg = re.sub(re.escape(clean_inst), "", cand_deg, flags=re.IGNORECASE).strip().rstrip(" ,.-|()")
                if cand_deg:
                    degree_str = cand_deg

        # Check following lines
        if degree_str == "Not specified":
            for j in range(i + 1, min(len(search_lines), i + 3)):
                cand = search_lines[j]
                if UNIV_COLLEGE_KW.search(cand):
                    break
                dm = DEGREE_ABBR_PAT.search(cand)
                if dm:
                    degree_str = dm.group(0).strip()
                    break

        # Check academic exchange pattern
        if degree_str == "Not specified":
            for j in range(max(0, i - 2), min(len(search_lines), i + 3)):
                em = EXCHANGE_PAT.search(search_lines[j])
                if em:
                    degree_str = em.group(0).strip().capitalize()
                    break

        # 2. Grade check
        grade_parts = []
        for j in range(max(0, i - 1), min(len(search_lines), i + 3)):
            cl = search_lines[j]
            hm = HONORS_PAT.search(cl)
            gm = GRADE_PAT.search(cl)
            if hm:
                h_val = hm.group(0).strip()
                if h_val not in grade_parts:
                    grade_parts.append(h_val)
            elif gm:
                g_val = gm.group(0).strip()
                if g_val not in grade_parts:
                    grade_parts.append(g_val)

        grade_str = " | ".join(grade_parts) if grade_parts else "Not specified"

        # 3. Year check
        year_str = "Not specified"
        for j in range(max(0, i - 2), min(len(search_lines), i + 3)):
            ym = date_range_pat.search(search_lines[j])
            if ym:
                year_str = ym.group(1).strip()
                break

        extracted.append({
            "institution": clean_inst,
            "degree": degree_str if degree_str else "Not specified",
            "year": year_str,
            "grade": grade_str
        })

    return extracted


def parse_date_point(d_str: str) -> (Optional[int], Optional[int]):
    """Helper to convert date fragment into (year, month)."""
    d_clean = d_str.strip().lower()
    if any(w in d_clean for w in ["present", "current", "till date", "to date", "now", "ongoing", "continuing"]):
        return 2026, 9
    
    m_match = re.search(r"([a-z]{3})[a-z]*\.?\s*(\d{4})", d_clean)
    if m_match:
        m_name = m_match.group(1)
        year = int(m_match.group(2))
        month = MONTH_MAP.get(m_name, 1)
        return year, month

    m_only = re.search(r"\b([a-z]{3})[a-z]*\b", d_clean)
    if m_only and m_only.group(1) in MONTH_MAP:
        return None, MONTH_MAP[m_only.group(1)]

    slash_m = re.search(r"(\d{1,2})/(?:20|19)?(\d{2,4})", d_clean)
    if slash_m:
        month = int(slash_m.group(1))
        year = int(slash_m.group(2))
        if year < 100:
            year += 2000
        return year, month

    y_m = re.search(r"\b(19\d{2}|20\d{2})\b", d_clean)
    if y_m:
        return int(y_m.group(1)), 1

    return None, None


def calculate_tenure_months(date_str: str) -> int:
    """Calculate months duration between two dates in a range string."""
    parts = [p.strip() for p in re.split(r"\s*[-–—/]\s*|\s+to\s+|\s+until\s+", date_str, flags=re.IGNORECASE) if p.strip()]
    if len(parts) >= 2:
        y1, m1 = parse_date_point(parts[0])
        y2, m2 = parse_date_point(parts[1])
        # If first part has month but no year (e.g. 'June' in 'June - September 2025'), inherit year from second part
        if y1 is None and y2 is not None and m1 is not None and m2 is not None:
            y1 = y2 if m1 <= m2 else y2 - 1
        if y1 and y2:
            m1 = m1 or 1
            m2 = m2 or 1
            months = (y2 - y1) * 12 + (m2 - m1)
            return max(1, months)
    return 0


def format_months(total_m: int) -> str:
    """Format total months into human-readable duration."""
    if total_m <= 0:
        return "Not specified"
    years = total_m // 12
    months = total_m % 12
    y_str = "yr" if years == 1 else "yrs"
    m_str = "mo" if months == 1 else "mos"
    if years > 0 and months > 0:
        return f"{years} {y_str} {months} {m_str}"
    elif years > 0:
        return f"{years} {'year' if years == 1 else 'years'}"
    else:
        return f"{months} {'month' if months == 1 else 'months'}"


def split_role_and_company(text: str) -> (str, str):
    """Cleanly separate job role and company from a combined header string."""
    clean = re.sub(r"[,|–— -]?\s*\b(?:19|20)\d{2}\b.*$", "", text).strip()
    
    # 1. Check explicit labels like "Role: SWE | Company: Google"
    r_match = re.search(r"(?:role|title|designation|position)\s*[:\-]\s*([^|,-]+)", clean, re.I)
    c_match = re.search(r"(?:company|organization|employer|client)\s*[:\-]\s*([^|,-]+)", clean, re.I)
    if r_match or c_match:
        r = r_match.group(1).strip() if r_match else "Not specified"
        c = c_match.group(1).strip() if c_match else "Not specified"
        return r, c

    # 2. Delimiter 'at' or '@'
    at_match = re.search(r"\s+(?:at|@)\s+", clean, re.IGNORECASE)
    if at_match:
        role = clean[:at_match.start()].strip()
        comp = clean[at_match.end():].strip().rstrip(" ,.-|")
        return role, comp

    # 3. Delimiters '|', ' - ', ' – ', ' — ', ','
    parts = [p.strip() for p in re.split(r"\s*[|–—]\s*|\s+-\s+|,\s+", clean) if p.strip()]
    if len(parts) >= 2:
        for idx, p in enumerate(parts):
            if any(k in p.lower() for k in JOB_KEYWORDS):
                role = p
                others = [
                    p2 for i2, p2 in enumerate(parts)
                    if i2 != idx and not re.search(r"\b(remote|full-time|part-time|contract|usa|india|[A-Z]{2})\b", p2, re.I)
                ]
                comp = others[0] if others else "Not specified"
                return role, comp

    # Single text fallback
    if any(k in clean.lower() for k in JOB_KEYWORDS):
        return clean, "Not specified"
    return "Not specified", clean


def extract_work_experience(text: str, sections: Dict[str, str]) -> Dict[str, Any]:
    """
    Extract work experience positions, roles, dates, companies, and total calculated duration.
    Supports single-year spans (Month - Month Year), multi-year spans, diverse layout hierarchies,
    and cleanly filters out section headers.
    """
    exp_text = sections.get("EXPERIENCE", "")
    lines = [l.strip() for l in exp_text.split("\n") if l.strip()] if len(exp_text) > 40 else [l.strip() for l in text.split("\n") if l.strip()]

    # Locate anchors (lines containing work date ranges)
    anchors = []
    for idx, line in enumerate(lines):
        m = DATE_RANGE_PAT.search(line)
        if m:
            anchors.append((idx, m.group(0).strip(), line))

    positions = []
    total_months_sum = 0

    for a_idx, (line_num, date_range, orig_line) in enumerate(anchors):
        m_count = calculate_tenure_months(date_range)
        total_months_sum += m_count
        tenure_str = format_months(m_count)

        role = "Not specified"
        company = "Not specified"
        bullet_start_idx = line_num + 1

        line_without_date = DATE_RANGE_PAT.sub("", orig_line).strip(" |–—-,()")

        # Case 1: Role text is on the same line as the date
        if len(line_without_date) > 3 and any(k in line_without_date.lower() for k in JOB_KEYWORDS):
            curr_role_text = line_without_date
            cand_comp_found = None
            if line_num + 1 < len(lines):
                cand_cont = lines[line_num + 1].strip()
                if len(cand_cont.split()) <= 4 and not cand_cont.startswith(("-", "•", "*", "–")) and not any(cand_cont.lower().startswith(x) for x in ["conducted", "supported", "built", "led", "managed", "developed"]):
                    curr_role_text += " " + cand_cont.rstrip(".")
                    bullet_start_idx = line_num + 2
                    if bullet_start_idx < len(lines):
                        cand_comp = lines[bullet_start_idx].strip()
                        if not cand_comp.startswith(("-", "•", "*", "–")) and len(cand_comp.split()) <= 6:
                            cand_comp_found = cand_comp
                            bullet_start_idx += 1

            if cand_comp_found:
                role = curr_role_text
                company = cand_comp_found
            else:
                r_split, c_split = split_role_and_company(curr_role_text)
                role = r_split
                if c_split != "Not specified":
                    company = c_split
        else:
            # Case 2: Date is on a standalone line
            line_before = lines[line_num - 1] if line_num > 0 else ""
            line_before_2 = lines[line_num - 2] if line_num > 1 else ""
            line_after = lines[line_num + 1] if line_num + 1 < len(lines) else ""

            # Check if line_before has combined 'Role at Company' or 'Role | Company'
            r_b, c_b = split_role_and_company(line_before)
            if c_b != "Not specified" and r_b != "Not specified":
                role = r_b
                company = c_b
                bullet_start_idx = line_num + 1
            else:
                before_has_kw = any(k in line_before.lower() for k in JOB_KEYWORDS)
                before_2_has_kw = any(k in line_before_2.lower() for k in JOB_KEYWORDS) if line_before_2 else False
                after_has_kw = any(k in line_after.lower() for k in JOB_KEYWORDS)

                if after_has_kw and not before_has_kw:
                    # e.g. SquashApps, Coimbatore (line_before) / Product Management Intern (line_after)
                    role = line_after
                    company = line_before
                    bullet_start_idx = line_num + 2
                elif before_2_has_kw and not before_has_kw and not line_before.startswith(("-", "•", "*", "–")):
                    # e.g. Senior Software Engineer (line_before_2) / Acme Corp (line_before)
                    role = line_before_2
                    company = line_before
                    bullet_start_idx = line_num + 1
                elif before_has_kw and not before_2_has_kw and line_before_2 and not line_before_2.startswith(("-", "•", "*", "–")) and len(line_before_2.split()) <= 6:
                    # e.g. Acme Corp (line_before_2) / Senior Software Engineer (line_before)
                    role = line_before
                    company = line_before_2
                    bullet_start_idx = line_num + 1
                elif before_has_kw:
                    role = line_before
                    company = "Not specified"
                    bullet_start_idx = line_num + 1
                else:
                    role, company = r_b, c_b
                    bullet_start_idx = line_num + 1

        # Determine where bullet details end (before next position or section boundary)
        next_anchor_idx = anchors[a_idx + 1][0] if a_idx + 1 < len(anchors) else len(lines)
        end_detail_idx = next_anchor_idx
        while end_detail_idx > bullet_start_idx:
            cand = lines[end_detail_idx - 1].strip()
            if not cand.startswith(("-", "•", "*", "–", "·", "\u2022")) and len(cand.split()) <= 5 and (any(k in cand.lower() for k in JOB_KEYWORDS) or "," in cand or cand.isupper()):
                end_detail_idx -= 1
            else:
                break

        details = []
        for d_idx in range(bullet_start_idx, end_detail_idx):
            detail_line = lines[d_idx]
            if len(detail_line.split()) <= 4 and re.search(r"^(?:education|skills|projects|certifications|awards|languages|references)\b", detail_line, re.I):
                break
            clean_detail = detail_line.lstrip("-•*–· \u2022").strip()
            clean_detail = re.sub(r"^\d+\.\s*", "", clean_detail)
            if clean_detail and len(clean_detail) > 4:
                details.append(clean_detail)

        positions.append({
            "role": role.strip() if role else "Not specified",
            "company": company.strip() if company else "Not specified",
            "duration": date_range,
            "tenure": tenure_str,
            "details": details
        })

    return {
        "total_experience_estimated": format_months(total_months_sum),
        "positions": positions
    }


def extract_email(text: str) -> str:
    """Helper extractor for email address."""
    match = re.search(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,7}\b", text)
    return match.group(0).strip() if match else "Not specified"


def parse_resume(raw_text: str) -> Dict[str, Any]:
    """
    Main NLP pipeline entry point.
    Extracts: Name, Age, Phone Number, Education, Work Experience (and Email).
    """
    cleaned = clean_text(raw_text)
    sections = extract_sections(cleaned)

    name = extract_name(cleaned)
    age = extract_age(cleaned)
    phone = extract_phone(cleaned)
    email = extract_email(cleaned)
    education = extract_education(cleaned, sections)
    work_experience = extract_work_experience(cleaned, sections)

    return {
        "name": name,
        "age": age,
        "phone_number": phone,
        "email": email,
        "education": education,
        "work_experience": work_experience,
        "raw_text": cleaned
    }
