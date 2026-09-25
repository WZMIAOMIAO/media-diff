from io import BytesIO
from typing import Any

import numpy as np
from PIL import Image

from media_diff.config import IMAGE_EXTENSIONS


def get_image_info(path: str) -> dict:
    """Return {width, height, format} for the image at path."""
    with Image.open(path) as img:
        return {
            "width": img.width,
            "height": img.height,
            "format": img.format or "",
        }


def calculate_histogram(img: Image.Image) -> dict:
    """Compute RGB 256-bin histogram + per-channel mean using NumPy.

    Expects an RGB image (converts if needed). Returns dict with keys:
    r, g, b (lists of 256 ints), r_mean, g_mean, b_mean (floats).
    """
    rgb = img.convert("RGB")
    arr = np.asarray(rgb, dtype=np.uint8)  # (H, W, 3)

    r_channel = arr[:, :, 0].ravel()
    g_channel = arr[:, :, 1].ravel()
    b_channel = arr[:, :, 2].ravel()

    r_hist = np.bincount(r_channel, minlength=256)[:256]
    g_hist = np.bincount(g_channel, minlength=256)[:256]
    b_hist = np.bincount(b_channel, minlength=256)[:256]

    return {
        "r": r_hist.tolist(),
        "g": g_hist.tolist(),
        "b": b_hist.tolist(),
        "r_mean": float(r_channel.mean()) if r_channel.size else 0.0,
        "g_mean": float(g_channel.mean()) if g_channel.size else 0.0,
        "b_mean": float(b_channel.mean()) if b_channel.size else 0.0,
    }


def generate_thumbnail(path: str, size: int = 200) -> tuple[bytes, dict]:
    """Generate a thumbnail JPEG + histogram computed on the thumbnail.

    The thumbnail is scaled so its largest edge equals `size` (using
    NEAREST interpolation for speed). The RGB histogram is computed on the
    resulting thumbnail (not the original), reducing computation cost.

    Returns (jpeg_bytes, histogram_dict).
    """
    with Image.open(path) as img:
        rgb = img.convert("RGB")
        max_edge = max(rgb.width, rgb.height)
        if max_edge > size:
            scale = size / max_edge
            new_w = max(1, int(round(rgb.width * scale)))
            new_h = max(1, int(round(rgb.height * scale)))
            thumb = rgb.resize((new_w, new_h), Image.NEAREST)
        else:
            thumb = rgb

        histogram = calculate_histogram(thumb)

        buf = BytesIO()
        thumb.save(buf, format="JPEG", quality=85)
        jpeg_bytes = buf.getvalue()

    return jpeg_bytes, histogram


def is_supported_image(path: str) -> bool:
    """Check if the file extension is a supported image format."""
    import os

    ext = os.path.splitext(path)[1].lower()
    return ext in IMAGE_EXTENSIONS
