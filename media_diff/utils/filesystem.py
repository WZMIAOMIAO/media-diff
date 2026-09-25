import os
import string
import sys

from media_diff.config import IMAGE_EXTENSIONS, VIDEO_EXTENSIONS


def get_roots() -> list[str]:
    if sys.platform.startswith("win"):
        roots: list[str] = []
        for letter in string.ascii_uppercase:
            drive = f"{letter}:\\"
            if os.path.exists(drive):
                roots.append(drive)
        return roots
    return ["/"]


def get_default_browse_path() -> str:
    """Default directory shown when opening the folder browser.

    - Linux / macOS: the current user's home directory (``~``).
    - Windows: the current user's Desktop (falls back to home if missing).

    The Desktop folder name may be localized on some Windows installs, so a
    few common names are tried before falling back to the home directory.
    """
    home = os.path.expanduser("~")
    if sys.platform.startswith("win"):
        for name in ("Desktop", "桌面"):
            desktop = os.path.join(home, name)
            if os.path.isdir(desktop):
                return desktop
        return home
    return home


def list_subdirs(path: str) -> list[dict]:
    base = path
    subdirs: list[dict] = []
    try:
        with os.scandir(base) as it:
            for entry in it:
                if entry.is_dir() and not entry.name.startswith("."):
                    has_children = _has_child_dir(entry.path)
                    subdirs.append(
                        {
                            "name": entry.name,
                            "path": entry.path,
                            "has_children": has_children,
                        }
                    )
    except PermissionError:
        raise
    subdirs.sort(key=lambda x: x["name"].lower())
    return subdirs


def _has_child_dir(path: str) -> bool:
    try:
        with os.scandir(path) as it:
            for entry in it:
                if entry.is_dir():
                    return True
    except (PermissionError, OSError):
        return False
    return False


def list_images(path: str) -> list[dict]:
    base = path
    images: list[dict] = []
    try:
        with os.scandir(base) as it:
            for entry in it:
                if entry.is_file():
                    ext = os.path.splitext(entry.name)[1].lower()
                    if ext in IMAGE_EXTENSIONS:
                        images.append({"name": entry.name, "path": entry.path})
    except PermissionError:
        raise
    images.sort(key=lambda x: x["name"].lower())
    return images


def list_json_files(path: str) -> list[dict]:
    base = path
    files: list[dict] = []
    try:
        with os.scandir(base) as it:
            for entry in it:
                if entry.is_file():
                    ext = os.path.splitext(entry.name)[1].lower()
                    if ext == ".json":
                        files.append({"name": entry.name, "path": entry.path})
    except PermissionError:
        raise
    files.sort(key=lambda x: x["name"].lower())
    return files


def list_videos(path: str) -> list[dict]:
    base = path
    videos: list[dict] = []
    try:
        with os.scandir(base) as it:
            for entry in it:
                if entry.is_file():
                    ext = os.path.splitext(entry.name)[1].lower()
                    if ext in VIDEO_EXTENSIONS:
                        videos.append({"name": entry.name, "path": entry.path})
    except PermissionError:
        raise
    videos.sort(key=lambda x: x["name"].lower())
    return videos
