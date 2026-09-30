"""Access-root (sandbox) enforcement.

When the server is started with a root directory (``media-diff --root DIR`` or
the ``MEDIA_DIFF_ROOT`` environment variable), every path accepted by the API
must resolve to that directory or one of its descendants. This prevents the web
UI from browsing or reading arbitrary files on the host.

When no root is configured the server stays unrestricted (the previous
behaviour, intended for trusted local use).
"""

import os

from media_diff import config


class AccessDeniedError(PermissionError):
    """Raised when a path falls outside the configured access root."""


def get_access_root() -> str | None:
    """Return the normalized (realpath) access root, or ``None`` if unset."""
    raw = config.ACCESS_ROOT
    if not raw:
        return None
    return os.path.realpath(os.path.abspath(os.path.expanduser(raw)))


def is_within_access_root(path: str) -> bool:
    """Whether ``path`` resolves to a location inside the access root.

    Symlinks are resolved first, so a link inside the root that points outside
    is rejected. Unrestricted mode always returns ``True``.
    """
    root = get_access_root()
    if root is None:
        return True
    try:
        target = os.path.realpath(os.path.abspath(path))
        return os.path.commonpath([target, root]) == root
    except ValueError:
        # Different drives (Windows) -> definitely outside the root.
        return False


def ensure_within_access_root(path: str) -> str:
    """Raise :class:`AccessDeniedError` if ``path`` is outside the access root."""
    if not is_within_access_root(path):
        raise AccessDeniedError("路径超出允许访问的范围")
    return path


def validate_access_root() -> None:
    """Fail fast if a configured access root does not exist or is not a folder."""
    raw = config.ACCESS_ROOT
    if not raw:
        return
    root = get_access_root()
    if root is None or not os.path.isdir(root):
        raise RuntimeError(f"访问根目录不存在或不是文件夹: {raw}")
