"""Annotation (标注) helpers.

Server-side logic for the image annotation mode:

- Resolve the user supplied output path to a concrete JSON file.
- Validate that the output path is usable (directory exists, target writable).
- Load existing annotations.
- Merge submitted annotations using an append/replace strategy keyed by
  ``(image_paths..., question)`` so re-submitting the same image group with the
  same question replaces the previous entry instead of duplicating it.

All read/modify/write operations are guarded by a module level
:class:`threading.Lock` so concurrent requests cannot corrupt the file.
"""

import json
import os
import threading

from media_diff.utils.security import AccessDeniedError, ensure_within_access_root

RESULT_FILENAME = "annotation_results.json"
RESULT_FILENAMES = {
    "image": "annotation_results.json",
    "video": "video_annotation_results.json",
}

# Key holding the compared media paths: ``image`` for image mode, ``video`` for
# video mode. Both are accepted so a single file/format handles either.
MEDIA_FIELDS = ("image", "video")

_LOCK = threading.Lock()


class AnnotationError(Exception):
    """Raised for user facing validation errors."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def _default_filename(media: str) -> str:
    return RESULT_FILENAMES.get(media, RESULT_FILENAME)


def resolve_output_path(raw: str, media: str = "image") -> str:
    """Resolve a user supplied directory/file path to a JSON file path.

    - A path ending in ``.json`` is treated as the output file itself (its
      parent directory must exist).
    - Any other path is treated as a directory (which must exist) and the
      mode's default result file name is appended.
    """
    if not raw or not raw.strip():
        raise AnnotationError("输出路径不能为空")
    try:
        ensure_within_access_root(raw)
    except AccessDeniedError as exc:
        raise AnnotationError("输出路径超出允许访问的范围", status_code=403) from exc
    normalized = os.path.normpath(raw.strip())
    if normalized.lower().endswith(".json"):
        parent = os.path.dirname(normalized) or "."
        if not os.path.isdir(parent):
            raise AnnotationError("输出目录不存在", status_code=404)
        return normalized
    if not os.path.isdir(normalized):
        raise AnnotationError("输出目录不存在", status_code=404)
    return os.path.join(normalized, _default_filename(media))


def _is_writable(path: str) -> bool:
    if os.path.exists(path):
        return os.access(path, os.W_OK)
    return os.access(os.path.dirname(path) or ".", os.W_OK)


def check_path(raw: str, media: str = "image") -> dict:
    """Validate a user supplied output path.

    Returns the resolved file path plus whether the file already exists and
    whether it can be written to.
    """
    path = resolve_output_path(raw, media)
    return {
        "path": path,
        "exists": os.path.isfile(path),
        "writable": _is_writable(path),
    }


def _question_of(entry: dict) -> str:
    return entry.get("question", "")


def _answer_of(entry: dict) -> str:
    return entry.get("answer", "")


def _media_paths(entry: dict) -> list | None:
    for field in MEDIA_FIELDS:
        value = entry.get(field)
        if isinstance(value, list):
            return value
    return None


def _entry_key(entry: dict) -> tuple | None:
    paths = _media_paths(entry)
    if paths is None:
        return None
    return tuple(paths) + (_question_of(entry),)


def _read_list(path: str) -> list:
    if not os.path.isfile(path):
        return []
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        raise AnnotationError(f"读取标注文件失败: {exc}") from exc
    if not isinstance(data, list):
        raise AnnotationError("标注文件格式不正确（应为数组）")
    return data


def _write_list(path: str, data: list) -> None:
    try:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=4)
    except OSError as exc:
        raise AnnotationError(f"写入标注文件失败: {exc}") from exc


def load(save_path: str, media: str = "image") -> list:
    """Return the annotation list stored at ``save_path`` (``[]`` if absent)."""
    path = resolve_output_path(save_path, media)
    with _LOCK:
        return _read_list(path)


def save(save_path: str, annotations: list, media: str = "image") -> list:
    """Merge ``annotations`` into the file at ``save_path``.

    Entries whose ``(media_paths..., question)`` key already exists replace the
    old entry in place; new keys are appended. Returns the full merged list.
    """
    path = resolve_output_path(save_path, media)
    if not isinstance(annotations, list):
        raise AnnotationError("标注内容格式不正确")
    with _LOCK:
        existing = _read_list(path)
        index: dict[tuple, int] = {}
        for i, entry in enumerate(existing):
            if isinstance(entry, dict):
                key = _entry_key(entry)
                if key is not None:
                    index[key] = i
        for entry in annotations:
            if not isinstance(entry, dict):
                raise AnnotationError("标注条目格式不正确")
            key = _entry_key(entry)
            if key is None:
                raise AnnotationError("标注条目缺少 image/video 字段")
            if not _question_of(entry).strip():
                raise AnnotationError("问题不能为空")
            if not _answer_of(entry).strip():
                raise AnnotationError("标注结果不能为空")
            if key in index:
                existing[index[key]] = entry
            else:
                index[key] = len(existing)
                existing.append(entry)
        _write_list(path, existing)
        return existing
