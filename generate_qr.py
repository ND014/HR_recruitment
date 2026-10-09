"""
Generate a QR code that points to the candidate application form.
Usage:  python generate_qr.py [URL]
Default URL: http://127.0.0.1:8000
"""

import sys
import os
import qrcode
from qrcode.image.styledpil import StyledPilImage
from qrcode.image.styles.moduledrawers import RoundedModuleDrawer

DEFAULT_URL = "http://127.0.0.1:8000"
OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "candidate_form_qr.png")


def generate(url: str = DEFAULT_URL):
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=12,
        border=4,
    )
    qr.add_data(url)
    qr.make(fit=True)

    img = qr.make_image(
        image_factory=StyledPilImage,
        module_drawer=RoundedModuleDrawer(),
        fill_color="#1E293B",
        back_color="#FFFFFF",
    )
    img.save(OUTPUT_FILE)
    print(f"QR code generated -> {OUTPUT_FILE}")
    print(f"Points to: {url}")


if __name__ == "__main__":
    target_url = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_URL
    generate(target_url)
