import os
import re
import string
import sys
import zipfile

from media_diff.config import (
    IMAGE_EXTENSIONS,
    VIDEO_EXTENSIONS,
    ZIP_COMPRESSION,
)
from media_diff.utils.security import get_access_root

# Safety cap for recursive scans so a pathological tree cannot produce an
# unbounded response. Callers surface truncation via the ``truncated`` flag.
MAX_RECURSIVE_ENTRIES = 5000

# A folder download copies every entry, so cap the total number of entries
# (files + subdirectories) a folder may contain. Folders above this are refused
# outright rather than silently truncated.
MAX_DOWNLOAD_ENTRIES = 2000

# Split a string into alternating non-digit / digit runs, e.g.
# "iter_2" -> ["iter_", "2", ""], "run10b" -> ["run", "10", "b"].
_NATURAL_SPLIT = re.compile(r"(\d+)")


def natural_sort_key(value: str) -> tuple:
    """Sort key giving a human-friendly, numeric-aware order.

    Plain lexicographic ordering puts ``iter_10`` before ``iter_2``; this key
    compares digit runs as numbers (so ``iter_2`` < ``iter_10``) while keeping
    case-insensitive text order otherwise.

    It returns ``(parts, value.lower())`` where ``parts`` alternates non-digit
    and digit chunks. Because ``re.split`` with a capturing group always yields
    the same parity (even index = text, odd index = digits), a given index is
    never compared as int against str. The lower-cased original is a final
    tie-breaker so equal-numeric names (e.g. ``01`` vs ``1``) order
    deterministically instead of depending on directory scan order.
    """
    parts = [
        int(part) if part.isdigit() else part.lower()
        for part in _NATURAL_SPLIT.split(value)
    ]
    return (parts, value.lower())


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
    subdirs.sort(key=lambda x: natural_sort_key(x["name"]))
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
                dirnames[:] = sorted(
                    (d for d in dirnames if not d.startswith(".")),
                    key=natural_sort_key,
                )
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
                        items.sort(key=lambda x: natural_sort_key(x["rel"]))
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
        items.sort(key=lambda x: natural_sort_key(x["rel"]))
    else:
        items.sort(key=lambda x: natural_sort_key(x["name"]))
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
    files.sort(key=lambda x: natural_sort_key(x["name"]))
    return files


def list_videos(path: str, recursive: bool = False) -> list[dict]:
    return _list_media(path, VIDEO_EXTENSIONS, recursive)


def list_all_entries(base: str) -> tuple[list[dict], int, bool]:
    """Recursively list every entry (files and directories) under ``base``.

    Unlike the media listings this keeps hidden entries and non-media files so a
    folder can be reproduced verbatim by the client. ``rel`` is the path relative
    to ``base`` with posix separators; ``is_dir`` marks directories (including
    empty ones, so they can be recreated).

    Symlinks are skipped entirely: they may point outside the access root or
    introduce cycles.

    Returns ``(entries, total, too_many)`` where ``total`` is the true number of
    entries in the whole tree. When it exceeds ``MAX_DOWNLOAD_ENTRIES`` only the
    first ``MAX_DOWNLOAD_ENTRIES`` entries are collected (``too_many`` is
    ``True``) so a huge tree cannot produce an unbounded payload; the count
    itself is always complete so the UI can report the real total.
    """
    entries: list[dict] = []
    total = 0
    # Explicit stack (abs_dir, rel_dir) instead of os.walk so symlinked dirs are
    # never descended into.
    stack: list[tuple[str, str]] = [(base, "")]
    while stack:
        abs_dir, rel_dir = stack.pop()
        try:
            with os.scandir(abs_dir) as it:
                children = list(it)
        except PermissionError:
            raise

        dir_children: list[tuple[str, str]] = []
        for entry in children:
            try:
                if entry.is_symlink():
                    continue
                is_dir = entry.is_dir()
            except OSError:
                continue
            rel = f"{rel_dir}/{entry.name}" if rel_dir else entry.name
            total += 1
            # Collect only the first ``MAX_DOWNLOAD_ENTRIES`` entries; keep
            # walking so ``total`` reflects the real count.
            if len(entries) < MAX_DOWNLOAD_ENTRIES:
                entries.append({"rel": rel, "path": entry.path, "is_dir": is_dir})
            if is_dir:
                dir_children.append((entry.path, rel))

        dir_children.sort(key=lambda x: natural_sort_key(x[1]))
        stack.extend(reversed(dir_children))

    if total > MAX_DOWNLOAD_ENTRIES:
        return [], total, True
    entries.sort(key=lambda x: natural_sort_key(x["rel"]))
    return entries, total, False


def create_zip_archive(base: str, dest_zip: str, on_entry=None) -> None:
    """Zip the contents of ``base`` into ``dest_zip`` (a temp file).

    Entries are stored under a top-level directory named after ``base`` so
    extracting the archive reproduces the original folder verbatim. Hidden
    entries and empty directories are included; symlinks are skipped (they may
    point outside the access root or form cycles).

    ``on_entry`` (if given) is called once per entry written, so callers can
    report progress. It may raise to abort the archive.

    Compression method follows ``config.ZIP_COMPRESSION`` (default ``store``):
    media files are already compressed, so storing them verbatim is ~10x faster
    while barely changing the archive size.
    """
    method = (
        zipfile.ZIP_DEFLATED if ZIP_COMPRESSION == "deflate" else zipfile.ZIP_STORED
    )
    root_name = os.path.basename(os.path.normpath(base)) or "download"
    with zipfile.ZipFile(dest_zip, "w", method) as zf:
        for dirpath, dirnames, filenames in os.walk(base, followlinks=False):
            dirnames[:] = sorted(
                (
                    d
                    for d in dirnames
                    if not os.path.islink(os.path.join(dirpath, d))
                ),
                key=natural_sort_key,
            )
            rel = os.path.relpath(dirpath, base)
            arc_dir = (
                root_name if rel == "." else f"{root_name}/{rel.replace(os.sep, '/')}"
            )
            if rel != ".":
                # Store the directory entry itself so empty dirs survive.
                zf.writestr(arc_dir + "/", b"")
                if on_entry is not None:
                    on_entry()
            for name in sorted(filenames, key=natural_sort_key):
                full = os.path.join(dirpath, name)
                if os.path.islink(full):
                    continue
                zf.write(full, f"{arc_dir}/{name}")
                if on_entry is not None:
                    on_entry()
