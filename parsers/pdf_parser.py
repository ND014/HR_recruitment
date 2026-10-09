import io
from typing import Union, BinaryIO, Optional
import pdfplumber
from pypdf import PdfReader
from parsers.image_parser import extract_text_from_image


def find_column_gutter(page) -> Optional[float]:
    """
    Detects if a PDF page has a multi-column layout by finding a vertical gap
    (gutter) between words in the middle 30% to 70% of the page width.
    """
    words = page.extract_words()
    if not words or len(words) < 20:
        return None
    bx = page.bbox
    w_page = bx[2] - bx[0]
    
    start_x = bx[0] + 0.30 * w_page
    end_x = bx[0] + 0.70 * w_page
    
    step = 2.0
    best_x = None
    max_margin = 0
    curr_x = start_x
    
    while curr_x <= end_x:
        colliding = [w for w in words if w["x0"] - 2 < curr_x < w["x1"] + 2]
        if len(colliding) == 0:
            left_edge = max([w["x1"] for w in words if w["x1"] <= curr_x], default=bx[0])
            right_edge = min([w["x0"] for w in words if w["x0"] >= curr_x], default=bx[2])
            margin = right_edge - left_edge
            if margin > max_margin:
                max_margin = margin
                best_x = (left_edge + right_edge) / 2
        curr_x += step
        
    return best_x if max_margin >= 15 else None


def extract_page_text_smart(page) -> str:
    """
    Extracts text from a pdfplumber page. If the page has two columns,
    crops and extracts each column separately so columns are not combined horizontally.
    """
    gutter_x = find_column_gutter(page)
    if gutter_x:
        bx = page.bbox
        left_crop = page.crop((bx[0], bx[1], gutter_x, bx[3]))
        right_crop = page.crop((gutter_x, bx[1], bx[2], bx[3]))
        left_text = left_crop.extract_text(layout=False) or ""
        right_text = right_crop.extract_text(layout=False) or ""
        return (left_text.strip() + "\n\n" + right_text.strip()).strip()
    else:
        return page.extract_text(layout=False) or ""


def extract_text_from_pdf(file_source: Union[str, bytes, BinaryIO]) -> str:
    """
    Extracts text from PDF with smart column layout detection and table parsing.
    If the document has minimal text (scanned PDF), renders pages to images
    and extracts text using Tesseract OCR.
    
    Args:
        file_source: File path, bytes, or file-like object.
        
    Returns:
        Extracted text string.
    """
    if isinstance(file_source, bytes):
        stream = io.BytesIO(file_source)
    elif hasattr(file_source, "read"):
        file_source.seek(0)
        stream = io.BytesIO(file_source.read())
    else:
        with open(str(file_source), "rb") as f:
            stream = io.BytesIO(f.read())

    extracted_pages = []
    
    # Try pdfplumber with smart column detection
    try:
        stream.seek(0)
        with pdfplumber.open(stream) as pdf:
            for page_idx, page in enumerate(pdf.pages):
                page_text = extract_page_text_smart(page)
                
                # Also check for table data
                tables = page.extract_tables()
                table_lines = []
                for table in tables:
                    for row in table:
                        clean_row = [cell.strip() for cell in row if cell and cell.strip()]
                        if clean_row:
                            table_lines.append(" | ".join(clean_row))

                combined = ""
                if page_text:
                    combined += page_text.strip()
                if table_lines:
                    combined += "\n" + "\n".join(table_lines)
                
                # If page had little/no text, attempt OCR on page rendering
                if len(combined.strip()) < 50:
                    try:
                        page_img = page.to_image(resolution=200).original
                        ocr_text = extract_text_from_image(page_img)
                        if len(ocr_text.strip()) > len(combined.strip()):
                            combined = ocr_text
                    except Exception:
                        pass
                
                if combined.strip():
                    extracted_pages.append(combined.strip())

    except Exception:
        # Fallback to PyPDF
        stream.seek(0)
        try:
            reader = PdfReader(stream)
            for page in reader.pages:
                text = page.extract_text()
                if text and text.strip():
                    extracted_pages.append(text.strip())
        except Exception:
            pass

    return "\n\n".join(extracted_pages)
