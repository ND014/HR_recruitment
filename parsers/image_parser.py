import os
import shutil
from typing import Union, BinaryIO
from PIL import Image, ImageEnhance, ImageFilter
import pytesseract
import io

# Automatically detect Tesseract executable
POSSIBLE_TESSERACT_PATHS = [
    os.path.expanduser(r"~\AppData\Local\Programs\Tesseract-OCR\tesseract.exe"),
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
]

tesseract_found = False
for path in POSSIBLE_TESSERACT_PATHS:
    if os.path.exists(path):
        pytesseract.pytesseract.tesseract_cmd = path
        tesseract_found = True
        break

if not tesseract_found:
    which_path = shutil.which("tesseract")
    if which_path:
        pytesseract.pytesseract.tesseract_cmd = which_path
        tesseract_found = True


def preprocess_image(image: Image.Image) -> Image.Image:
    """
    Applies preprocessing to maximize OCR accuracy:
    - Converts to Grayscale
    - Increases contrast
    - Slight sharpening
    """
    if image.mode != "L":
        image = image.convert("L")
    
    # Increase contrast
    enhancer = ImageEnhance.Contrast(image)
    image = enhancer.enhance(1.8)
    
    # Apply subtle sharpening
    image = image.filter(ImageFilter.SHARPEN)
    
    return image


def extract_text_from_image(file_source: Union[str, bytes, BinaryIO, Image.Image]) -> str:
    """
    Extracts text from an image file or PIL Image using Tesseract OCR.
    
    Args:
        file_source: File path, bytes, file-like object, or PIL Image.
    
    Returns:
        Extracted text string.
    """
    if isinstance(file_source, Image.Image):
        img = file_source
    elif isinstance(file_source, bytes):
        img = Image.open(io.BytesIO(file_source))
    elif hasattr(file_source, "read"):
        file_source.seek(0)
        img = Image.open(file_source)
    else:
        img = Image.open(str(file_source))

    # Preprocess
    processed_img = preprocess_image(img)

    # OCR configuration: PSM 3 (Fully automatic page segmentation)
    custom_config = r"--oem 3 --psm 3"
    text = pytesseract.image_to_string(processed_img, config=custom_config)
    
    return text.strip()
