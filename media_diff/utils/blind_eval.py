"""Blind evaluation (盲评) helpers.

This module implements the server-side logic for the blind evaluation mode:

- Resolve the user supplied output path to a concrete JSON file.
- Compute the intersection of image file names across the compared folders.
- Shuffle / split the intersection into N parts and return the requested part.
- Generate per-image window display orders so each image is shown in a
  different order across the comparison windows.
- Maintain the voting result JSON file (``A_win_list`` / ``B_win_list`` ...).

All read/modify/write operations on the result file are guarded by a module
level :class:`threading.Lock` so concurrent requests cannot corrupt it.
"""

import json
import os
import random
import threading

from media_diff.utils.filesystem import list_images, list_videos
from media_diff.utils.security import AccessDeniedError, ensure_within_access_root

RESULT_FILENAME = "blind_review_results.json"
ALIASES = "ABCD"
WIN_LIST_SUFFIX = "_win_list"

_LOCK = threading.Lock()

_MEDIA_LISTERS = {
    "image": list_images,
    "video": list_videos,
}


class BlindEvalError(Exception):
    """Raised for user facing validation errors."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def resolve_output_path(raw: str) -> str:
    """Resolve a user supplied directory/file path to a JSON file path.

    - A path ending in ``.json`` is treated as the output file itself.
    - Any other path is treated as a directory and the default result file
      name is appended.
    """
    if not raw or not raw.strip():
        raise BlindEvalError("输出路径不能为空")
    try:
        ensure_within_access_root(raw)
    except AccessDeniedError as exc:
        raise BlindEvalError("输出路径超出允许访问的范围", status_code=403) from exc
    normalized = os.path.normpath(raw.strip())
    if normalized.lower().endswith(".json"):
        parent = os.path.dirname(normalized) or "."
        if not os.path.isdir(parent):
            raise BlindEvalError("输出目录不存在", status_code=404)
        return normalized
    if not os.path.isdir(normalized):
        raise BlindEvalError("输出目录不存在", status_code=404)
    return os.path.join(normalized, RESULT_FILENAME)


def _validate_folder(path: str) -> str:
    try:
        ensure_within_access_root(path)
    except AccessDeniedError as exc:
        raise BlindEvalError("对比目录超出允许访问的范围", status_code=403) from exc
    normalized = os.path.normpath(path)
    if not os.path.isdir(normalized):
        raise BlindEvalError(f"对比目录不存在: {path}", status_code=404)
    return normalized


def _names_in_folder(path: str, media: str = "image", recursive: bool = False) -> set[str]:
    """Return the pairing keys of the media files in a folder.

    When ``recursive`` is set the keys are paths relative to ``path`` (so a
    mirrored subfolder layout pairs file-for-file). Otherwise they are plain
    file names, matching the non-recursive comparison behaviour.
    """
    if recursive and media == "video":
        items = list_videos(path, recursive=True)
        return {item.get("rel", item["name"]) for item in items}
    lister = _MEDIA_LISTERS.get(media, list_images)
    return {item["name"] for item in lister(path)}


def common_file_names(
    paths: list[str], media: str = "image", recursive: bool = False
) -> list[str]:
    """Return the sorted intersection of pairing keys across all folders.

    Keys are file names by default, or folder-relative paths when ``recursive``
    is set (video only).
    """
    if recursive and media != "video":
        raise BlindEvalError("图片暂不支持递归盲评")
    per_folder = [_names_in_folder(p, media, recursive) for p in paths]
    common = set.intersection(*per_folder) if per_folder else set()
    return sorted(common)


def _split(names: list[str], total_parts: int, current_part: int) -> list[str]:
    total = len(names)
    if total_parts < 1:
        raise BlindEvalError("划分份数至少为1")
    if current_part < 1 or current_part > total_parts:
        raise BlindEvalError("当前评测份数超出范围")
    if total_parts > total:
        raise BlindEvalError(f"划分份数不能大于图片总数（当前共 {total} 张）")
    chunk = total // total_parts
    start = (current_part - 1) * chunk
    if current_part == total_parts:
        return names[start:]
    return names[start : start + chunk]


def _display_orders(shuffled: list[str], folder_count: int, seed: int) -> dict[str, list[int]]:
    """Per-image window arrangement: ``orders[name][visual_pos] = folder_index``."""
    orders: dict[str, list[int]] = {}
    for index, name in enumerate(shuffled):
        order = list(range(folder_count))
        random.Random(seed + index).shuffle(order)
        orders[name] = order
    return orders


def _read_json(path: str) -> dict:
    if not os.path.isfile(path):
        raise BlindEvalError("输出文件不存在", status_code=404)
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        raise BlindEvalError(f"读取输出文件失败: {exc}") from exc
    if not isinstance(data, dict):
        raise BlindEvalError("输出文件格式不正确")
    return data


def _write_json(path: str, data: dict) -> None:
    try:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=4)
    except OSError as exc:
        raise BlindEvalError(f"写入输出文件失败: {exc}") from exc


def _path_keys(data: dict) -> set[str]:
    """Keys that map a compared folder path to its alias (exclude win lists)."""
    return {k for k in data if not k.endswith(WIN_LIST_SUFFIX)}


def _win_lists(data: dict, aliases: list[str]) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    for alias in aliases:
        raw = data.get(f"{alias}{WIN_LIST_SUFFIX}", [])
        result[alias] = list(raw) if isinstance(raw, list) else []
    return result


def setup(
    paths: list[str],
    total_parts: int,
    current_part: int,
    seed: int,
    output_path: str,
    load_existing: bool = False,
    media: str = "image",
    recursive: bool = False,
) -> dict:
    """Prepare a blind evaluation session.

    ``media`` selects which file names are intersected (``"image"`` or
    ``"video"``); the rest of the flow is identical for both. When
    ``recursive`` is set (video only) the pairing keys are folder-relative
    paths so mirrored subfolder trees align file-for-file.
    """
    if len(paths) < 2:
        raise BlindEvalError("盲评模式需要至少2个对比文件夹")
    if len(paths) > 4:
        raise BlindEvalError("不支持超过4个文件夹")

    normalized = [_validate_folder(p) for p in paths]
    output = resolve_output_path(output_path)

    common = common_file_names(normalized, media, recursive)
    if not common:
        raise BlindEvalError("没有找到文件名相同的数据，无法进行盲评")

    shuffled = list(common)
    random.Random(seed).shuffle(shuffled)
    part_names = _split(shuffled, total_parts, current_part)
    orders = _display_orders(shuffled, len(normalized), seed)
    display_orders = {name: orders[name] for name in part_names}

    with _LOCK:
        exists = os.path.isfile(output)
        if exists and not load_existing:
            data = _read_json(output)
            if _path_keys(data) != set(normalized):
                raise BlindEvalError(
                    "文件已存在且与当前对比项不匹配，请更换保存文件",
                    status_code=409,
                )
            aliases = {p: ALIASES[i] for i, p in enumerate(normalized)}
            return {
                "existing_file_matched": True,
                "output_path": output,
                "aliases": aliases,
                "common_files": part_names,
                "display_orders": display_orders,
                "win_lists": _win_lists(data, list(aliases.values())),
            }

        if exists:
            data = _read_json(output)
            if _path_keys(data) != set(normalized):
                raise BlindEvalError(
                    "文件已存在且与当前对比项不匹配，请更换保存文件",
                    status_code=409,
                )
            aliases = {k: data[k] for k in _path_keys(data)}
        else:
            aliases = {p: ALIASES[i] for i, p in enumerate(normalized)}
            data = dict(aliases)
            for alias in aliases.values():
                data[f"{alias}{WIN_LIST_SUFFIX}"] = []
            _write_json(output, data)

        return {
            "existing_file_matched": False,
            "output_path": output,
            "aliases": aliases,
            "common_files": part_names,
            "display_orders": display_orders,
            "win_lists": _win_lists(data, list(aliases.values())),
        }


def vote(output_path: str, image_name: str, alias: str | None) -> dict:
    """Record (or clear) a vote for ``image_name`` in favor of ``alias``.

    The image name is first removed from every win list, then (when ``alias``
    is provided) added to the winning alias' list. Passing ``alias=None``
    clears the vote.
    """
    output = resolve_output_path(output_path)
    with _LOCK:
        data = _read_json(output)
        for key in list(data):
            if key.endswith(WIN_LIST_SUFFIX) and isinstance(data[key], list):
                data[key] = [n for n in data[key] if n != image_name]
        if alias:
            key = f"{alias}{WIN_LIST_SUFFIX}"
            values = data.get(key, [])
            if not isinstance(values, list):
                values = []
            values.append(image_name)
            data[key] = values
        _write_json(output, data)
        return data


def load(output_path: str) -> dict:
    output = resolve_output_path(output_path)
    with _LOCK:
        return _read_json(output)


def save(output_path: str, data: dict) -> dict:
    output = resolve_output_path(output_path)
    if not isinstance(data, dict):
        raise BlindEvalError("保存内容格式不正确")
    with _LOCK:
        _write_json(output, data)
        return data
