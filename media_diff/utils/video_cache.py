import os
import threading
from collections import OrderedDict
from typing import Optional

from media_diff.config import (
    VIDEO_FRAME_CACHE_MAX,
    VIDEO_INFO_CACHE_MAX,
    VIDEO_THUMBNAIL_CACHE_MAX,
)


class VideoInfoCache:
    """LRU cache for ffprobe video info, keyed by path, mtime-invalidated."""

    def __init__(self, max_size: int = VIDEO_INFO_CACHE_MAX) -> None:
        self._cache: "OrderedDict[str, dict]" = OrderedDict()
        self._max = max_size
        self._lock = threading.Lock()

    def get(self, path: str) -> Optional[dict]:
        with self._lock:
            entry = self._cache.get(path)
            if entry is None:
                return None
            try:
                mtime = os.path.getmtime(path)
            except OSError:
                self._cache.pop(path, None)
                return None
            if mtime != entry["mtime"]:
                self._cache.pop(path, None)
                return None
            self._cache.move_to_end(path)
            return entry

    def put(self, path: str, info: dict, mtime: float) -> None:
        with self._lock:
            self._cache[path] = {"info": info, "mtime": mtime}
            self._cache.move_to_end(path)
            while len(self._cache) > self._max:
                self._cache.popitem(last=False)


class VideoFrameCache:
    """LRU cache for extracted video frames, keyed by (path, frameNo).

    Stores JPEG bytes + base64 histogram. mtime-invalidated.
    """

    def __init__(self, max_size: int = VIDEO_FRAME_CACHE_MAX) -> None:
        self._cache: "OrderedDict[tuple[str, int], dict]" = OrderedDict()
        self._max = max_size
        self._lock = threading.Lock()

    def get(self, path: str, frame: int) -> Optional[dict]:
        key = (path, frame)
        with self._lock:
            entry = self._cache.get(key)
            if entry is None:
                return None
            try:
                mtime = os.path.getmtime(path)
            except OSError:
                self._cache.pop(key, None)
                return None
            if mtime != entry["mtime"]:
                self._cache.pop(key, None)
                return None
            self._cache.move_to_end(key)
            return entry

    def put(
        self,
        path: str,
        frame: int,
        jpeg_bytes: bytes,
        histogram_b64: str,
        mtime: float,
    ) -> None:
        key = (path, frame)
        with self._lock:
            self._cache[key] = {
                "jpeg_bytes": jpeg_bytes,
                "histogram_b64": histogram_b64,
                "mtime": mtime,
            }
            self._cache.move_to_end(key)
            while len(self._cache) > self._max:
                self._cache.popitem(last=False)


class VideoThumbnailCache:
    """LRU cache for video cover thumbnails, keyed by (path, size).

    Stores JPEG bytes + base64 histogram. mtime-invalidated.
    """

    def __init__(self, max_size: int = VIDEO_THUMBNAIL_CACHE_MAX) -> None:
        self._cache: "OrderedDict[tuple[str, int], dict]" = OrderedDict()
        self._max = max_size
        self._lock = threading.Lock()

    def get(self, path: str, size: int) -> Optional[dict]:
        key = (path, size)
        with self._lock:
            entry = self._cache.get(key)
            if entry is None:
                return None
            try:
                mtime = os.path.getmtime(path)
            except OSError:
                self._cache.pop(key, None)
                return None
            if mtime != entry["mtime"]:
                self._cache.pop(key, None)
                return None
            self._cache.move_to_end(key)
            return entry

    def put(
        self,
        path: str,
        size: int,
        jpeg_bytes: bytes,
        histogram_b64: str,
        mtime: float,
    ) -> None:
        key = (path, size)
        with self._lock:
            self._cache[key] = {
                "jpeg_bytes": jpeg_bytes,
                "histogram_b64": histogram_b64,
                "mtime": mtime,
            }
            self._cache.move_to_end(key)
            while len(self._cache) > self._max:
                self._cache.popitem(last=False)


video_info_cache = VideoInfoCache()
video_frame_cache = VideoFrameCache()
video_thumbnail_cache = VideoThumbnailCache()
