"""
Extract all embedded images from the Parafour catalog PDF.
Saves to images/catalog/ named page<N>_img<I>.<ext>.
"""

import sys
import os
from pathlib import Path

PDF_PATH = Path(__file__).parent / "2025_Parafour_CATALOG_Pricelist-MSRP.pdf"
OUTPUT_DIR = Path(__file__).parent / "images" / "catalog"

XREF_EXT = {
    "image/jpeg": "jpg",
    "image/png":  "png",
    "image/gif":  "gif",
    "image/tiff": "tif",
    "image/bmp":  "bmp",
    "image/webp": "webp",
}

def main():
    try:
        import fitz  # PyMuPDF
    except ImportError:
        sys.exit("PyMuPDF not found. Run: pip install pymupdf")

    if not PDF_PATH.exists():
        sys.exit(f"PDF not found: {PDF_PATH}\nPlace the catalog PDF in the project root and re-run.")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    doc = fitz.open(PDF_PATH)
    saved = []

    for page_num, page in enumerate(doc, start=1):
        img_list = page.get_images(full=True)
        for img_idx, img_info in enumerate(img_list, start=1):
            xref = img_info[0]
            base_image = doc.extract_image(xref)
            image_bytes = base_image["image"]
            colorspace = base_image.get("colorspace", 0)

            # Determine extension from MIME type or raw ext field
            mime = base_image.get("ext", "")
            if mime in ("jpeg", "jpg"):
                ext = "jpg"
            elif mime in XREF_EXT.values():
                ext = mime
            else:
                ext = XREF_EXT.get(base_image.get("mime", ""), "jpg")

            filename = f"page{page_num}_img{img_idx}.{ext}"
            out_path = OUTPUT_DIR / filename

            # Skip duplicate xrefs already written under a different page
            if out_path.exists() and out_path.stat().st_size == len(image_bytes):
                saved.append(str(out_path.relative_to(Path(__file__).parent)))
                continue

            out_path.write_bytes(image_bytes)
            saved.append(str(out_path.relative_to(Path(__file__).parent)))
            print(f"  Saved: {filename}  ({len(image_bytes):,} bytes, page {page_num})")

    doc.close()

    print(f"\n{'='*50}")
    print(f"Extraction complete — {len(saved)} image(s) saved to {OUTPUT_DIR.relative_to(Path(__file__).parent)}/")
    print("="*50)
    for path in saved:
        print(f"  {path}")

if __name__ == "__main__":
    main()
