#!/usr/bin/env python3
"""
Apply cute cat emoji stamp over face regions.
Usage: cd bemystyle-reel && python3 scripts/apply_cat_stamp.py
"""
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import os
import subprocess
import tempfile

BASE     = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SLIDES   = os.path.join(BASE, "public/assets/slides")
EMOJI    = "🐱"
BG_COLOR = (255, 228, 196, 235)   # warm peach cream
BORDER   = (220, 160, 100, 255)
FONT_PATH = "/System/Library/Fonts/Apple Color Emoji.ttc"
FONT_BASE_SIZE = 160               # bitmap-supported size


# ─── stamp rendering ────────────────────────────────────────────────────────

def make_stamp(target_size: int) -> Image.Image:
    """
    Create a circular cat emoji stamp at `target_size` pixels.
    We render at FONT_BASE_SIZE (160) and scale down as needed.
    """
    render_size = max(target_size, FONT_BASE_SIZE + 60)
    stamp = Image.new("RGBA", (render_size, render_size), (0, 0, 0, 0))
    draw  = ImageDraw.Draw(stamp)

    draw.ellipse([0, 0, render_size - 1, render_size - 1], fill=BG_COLOR)
    draw.ellipse([4, 4, render_size - 5, render_size - 5], outline=BORDER, width=5)

    font  = ImageFont.truetype(FONT_PATH, FONT_BASE_SIZE)
    bbox  = draw.textbbox((0, 0), EMOJI, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = (render_size - tw) // 2 - bbox[0]
    ty = (render_size - th) // 2 - bbox[1]
    draw.text((tx, ty), EMOJI, font=font, embedded_color=True)

    if target_size != render_size:
        stamp = stamp.resize((target_size, target_size), Image.LANCZOS)
    return stamp


def paste_stamp(img: Image.Image, x: int, y: int, w: int, h: int) -> Image.Image:
    """Paste a stamp centered on the face region (x, y, w, h)."""
    pad  = int(max(w, h) * 0.25)
    size = max(w, h) + pad * 2
    stamp = make_stamp(size)

    if img.mode != "RGBA":
        img = img.convert("RGBA")

    cx = x + w // 2
    cy = y + h // 2
    px = max(0, min(cx - size // 2, img.width  - size))
    py = max(0, min(cy - size // 2, img.height - size))
    img.paste(stamp, (px, py), stamp)
    return img


# ─── image regeneration ────────────────────────────────────────────────────

def cover_resize(img: Image.Image, tw: int, th: int) -> Image.Image:
    """Replicate sharp's cover+center resize."""
    sw, sh = img.size
    scale  = max(tw / sw, th / sh)
    nw, nh = int(sw * scale), int(sh * scale)
    img    = img.resize((nw, nh), Image.LANCZOS)
    left   = (nw - tw) // 2
    top    = (nh - th) // 2
    return img.crop((left, top, left + tw, top + th))


def heic_to_jpeg_pil(heic_path: str) -> Image.Image:
    """Convert HEIC to PIL Image via sips."""
    tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
    tmp.close()
    subprocess.run(
        ["sips", "-s", "format", "jpeg", heic_path, "--out", tmp.name],
        capture_output=True, check=True,
    )
    img = Image.open(tmp.name).copy()
    os.unlink(tmp.name)
    return img


def regenerate_slide(heic_path: str, out_path: str):
    """Regenerate a clean slide JPEG from HEIC (same as convert-and-rename.js)."""
    print(f"  Regenerating from {os.path.basename(heic_path)} …")
    img = heic_to_jpeg_pil(heic_path)
    img = cover_resize(img, 1080, 1920)
    img.convert("RGB").save(out_path, "JPEG", quality=85)
    print(f"  Clean JPEG saved ({img.size}).")
    return img


# ─── face detection ────────────────────────────────────────────────────────

def detect_faces(img_path: str, scale=1.05, min_neighbors=4, min_size=50) -> list:
    img  = cv2.imread(img_path)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    cas  = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    )
    faces = cas.detectMultiScale(
        gray, scaleFactor=scale, minNeighbors=min_neighbors, minSize=(min_size, min_size)
    )
    return [tuple(f) for f in faces] if len(faces) > 0 else []


# ─── per-slide processing ──────────────────────────────────────────────────

def process(jpg_path: str, faces: list, label: str):
    print(f"\n[{label}]")
    img = Image.open(jpg_path)
    for (x, y, w, h) in faces:
        print(f"  stamp  x={x} y={y} w={w} h={h}")
        img = paste_stamp(img, x, y, w, h)
    img.convert("RGB").save(jpg_path, "JPEG", quality=95)
    print(f"  → saved {os.path.basename(jpg_path)}")


# ─── main ──────────────────────────────────────────────────────────────────

if __name__ == "__main__":

    # ── slide01 ──────────────────────────────────────────────────────────────
    # Two women at a workshop table.
    # Faces are angled/looking-down; auto-detection fails → manual coords.
    process(
        jpg_path=os.path.join(SLIDES, "slide01.jpg"),
        faces=[
            (48,  450, 175, 195),   # left woman  (striped, looking down)
            (242, 385, 192, 200),   # right woman (white jacket, glasses)
        ],
        label="slide01",
    )

    # ── slide05 ──────────────────────────────────────────────────────────────
    # Left woman (polka dot) is large/prominent; right woman is smaller/background.
    process(
        jpg_path=os.path.join(SLIDES, "slide05.jpg"),
        faces=[
            (18,  12,  295, 290),   # left woman  (large, looking sideways)
            (612, 105, 210, 215),   # right woman (striped, with glasses)
        ],
        label="slide05",
    )

    # ── slide06 ──────────────────────────────────────────────────────────────
    # Regenerate clean JPEG from HEIC, then stamp over participant faces.
    # Previous version had pixelated mosaic; stamps replace it entirely.
    heic06  = os.path.join(SLIDES, "IMG_1132.HEIC")
    jpg06   = os.path.join(SLIDES, "slide06.jpg")
    regenerate_slide(heic06, jpg06)

    # Try auto-detect on the clean JPEG, fallback to manual coords.
    auto = detect_faces(jpg06, scale=1.05, min_neighbors=4, min_size=50)
    print(f"  Auto-detected faces: {auto}")
    # Override auto-detection — manual coords verified with grid
    faces06 = [
        (175, 830, 200, 210),   # left participant  (striped, glasses)
        (278, 845, 155, 145),   # right participant (white top, looking down)
    ]
    if len(auto) < 2:
        print("  → using manual fallback coords")
    process(jpg_path=jpg06, faces=faces06, label="slide06")

    # ── slide08 ──────────────────────────────────────────────────────────────
    # Instructor (floral outfit) near whiteboard at bottom-left → no stamp.
    # One student (glasses / updo hair) on the right side.
    process(
        jpg_path=os.path.join(SLIDES, "slide08.jpg"),
        faces=[
            (1420, 545, 230, 200),   # student: glasses / updo, right side
        ],
        label="slide08",
    )

    # ── slide09 ──────────────────────────────────────────────────────────────
    # Instructor (floral outfit) near whiteboard at left → no stamp.
    # Two students on the right: polka-dot top (upper) and striped top (lower).
    process(
        jpg_path=os.path.join(SLIDES, "slide09.jpg"),
        faces=[
            (1485, 238, 205, 215),   # student: polka-dot top, upper right
            (1340, 455, 165, 175),   # student: striped top, lower right
        ],
        label="slide09",
    )

    print("\nAll done.")
