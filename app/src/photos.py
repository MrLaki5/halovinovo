"""Mask photo files on disk. nginx serves UPLOAD_DIR at /uploads/."""

import uuid
from pathlib import Path
from typing import Iterable, Optional

from config import settings
from loguru import logger

URL_PREFIX = "/uploads/"


def detect_extension(data: bytes) -> Optional[str]:
    """Sniff the image type from its magic bytes rather than trusting the upload's headers."""
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def save_photo(data: bytes, extension: str) -> str:
    """Write the photo under a fresh random name, so cached URLs never go stale."""
    name = f"{uuid.uuid4().hex}.{extension}"
    directory = Path(settings.UPLOAD_DIR)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / name).write_bytes(data)
    return name


def delete_photos(names: Iterable[str]) -> None:
    for name in names:
        try:
            (Path(settings.UPLOAD_DIR) / name).unlink(missing_ok=True)
        except OSError as e:
            logger.warning(f"Could not delete photo {name}: {e}")


def photo_url(name: str) -> str:
    return URL_PREFIX + name
