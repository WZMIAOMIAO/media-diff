import os
import string
import sys

from media_diff.config import IMAGE_EXTENSIONS, VIDEO_EXTENSIONS
from media_diff.utils.security import get_access_root

# Safety cap for recursive scans so a pathological tree cannot produce an
# unbounded response. Callers surface truncation via the ``truncated`` flag.
MAX_RECURSIVE_ENTRIES = 5000


def get_roots() -> list[str]:
    root = get_access_root()
    if root is not None:
        return [root]
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

    When an access root is configured it is always the default, so the browser
    starts inside the only directory the server may expose.

    - Linux / macOS: the current user's home directory (``~``).
    - Windows: the current user's Desktop (falls back to home if missing).

    The Desktop folder name may be localized on some Windows installs, so a
    few common names are tried before falling back to the home directory.
    """
    root = get_access_root()
    if root is not None:
        return root
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


def _list_media(
    path: str, extensions: set[str], recursive: bool = False
) -> list[dict]:
    """List media files matching ``extensions``.

    Non-recursive (default) returns only the files directly inside ``path``.
    Recursive walks the tree, skipping hidden entries and never following
    symlinks, and adds a ``rel`` key (path relative to ``path``, posix
    separators) used for mirrored pairing. Stops at ``MAX_RECURSIVE_ENTRIES``.
    """
    base = path
    items: list[dict] = []
    try:
        if recursive:
            for dirpath, dirnames, filenames in os.walk(base):
                dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
                for name in filenames:
                    if name.startswith("."):
                        continue
                    ext = os.path.splitext(name)[1].lower()
                    if ext not in extensions:
                        continue
                    full = os.path.join(dirpath, name)
                    rel = os.path.relpath(full, base).replace(os.sep, "/")
                    items.append({"name": name, "path": full, "rel": rel})
                    if len(items) >= MAX_RECURSIVE_ENTRIES:
                        items.sort(key=lambda x: x["rel"].lower())
                        return items
        else:
            with os.scandir(base) as it:
                for entry in it:
                    if entry.is_file():
                        ext = os.path.splitext(entry.name)[1].lower()
                        if ext in extensions:
                            items.append({"name": entry.name, "path": entry.path})
    except PermissionError:
        raise
    if recursive:
        items.sort(key=lambda x: x["rel"].lower())
    else:
        items.sort(key=lambda x: x["name"].lower())
    return items


def list_images(path: str, recursive: bool = False) -> list[dict]:
    return _list_media(path, IMAGE_EXTENSIONS, recursive)


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


def list_videos(path: str, recursive: bool = False) -> list[dict]:
    return _list_media(path, VIDEO_EXTENSIONS, recursive)
