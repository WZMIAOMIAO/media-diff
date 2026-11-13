"""Access-root (sandbox) enforcement.

When the server is started with one or more root directories (repeat
``media-diff --root DIR``, or use ``MEDIA_DIFF_ROOT`` with ``os.pathsep``),
every path accepted by the API must resolve to one of those directories or a
descendant. This prevents the web UI from browsing or reading arbitrary files
on the host.

When no root is configured the server stays unrestricted (the previous
behaviour, intended for trusted local use).
"""

import os

from media_diff import config


class AccessDeniedError(PermissionError):
    """Raised when a path falls outside the configured access roots."""


def _configured_roots() -> list[str]:
    """Raw configured roots, falling back to the legacy single ``ACCESS_ROOT``."""
    roots = list(getattr(config, "ACCESS_ROOTS", []) or [])
    if not roots:
        legacy = getattr(config, "ACCESS_ROOT", None)
        if legacy:
            roots = [legacy]
    return roots


def get_access_roots() -> list[str]:
    """Return the normalized (realpath) access roots; empty = unrestricted."""
    roots: list[str] = []
    seen: set[str] = set()
    for raw in _configured_roots():
        if not raw:
            continue
        root = os.path.realpath(os.path.abspath(os.path.expanduser(str(raw))))
        if root not in seen:
            seen.add(root)
            roots.append(root)
    return roots


def get_access_root() -> str | None:
    """Return the first access root, or ``None`` if unset (back-compat)."""
    roots = get_access_roots()
    return roots[0] if roots else None


def is_within_access_root(path: str) -> bool:
    """Whether ``path`` resolves inside *any* configured access root.

    Symlinks are resolved first, so a link inside a root that points outside
    is rejected. Unrestricted mode always returns ``True``.
    """
    roots = get_access_roots()
    if not roots:
        return True
    try:
        target = os.path.realpath(os.path.abspath(path))
    except (OSError, ValueError):
        return False
    for root in roots:
        try:
            if os.path.commonpath([target, root]) == root:
                return True
        except ValueError:
            # Different drives (Windows) -> keep checking the other roots.
            continue
    return False


def ensure_within_access_root(path: str) -> str:
    """Raise :class:`AccessDeniedError` if ``path`` is outside all roots."""
    if not is_within_access_root(path):
        raise AccessDeniedError("路径超出允许访问的范围")
    return path


def validate_access_root() -> None:
    """Fail fast if any configured access root does not exist / is not a folder."""
    for raw in _configured_roots():
        root = os.path.realpath(os.path.abspath(os.path.expanduser(str(raw))))
        if not os.path.isdir(root):
            raise RuntimeError(f"访问根目录不存在或不是文件夹: {raw}")
