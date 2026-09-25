import os
import threading
from collections import OrderedDict
from typing import Optional

from media_diff.config import THUMBNAIL_CACHE_MAX


class ThumbnailCache:
    """LRU cache for thumbnail JPEG bytes + base64-encoded histogram.

    Keyed by (path, size). Each entry stores the file mtime at computation
    time; on lookup, if the current mtime differs the entry is invalidated.
    """

    def __init__(self, max_size: int = THUMBNAIL_CACHE_MAX) -> None:
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


thumbnail_cache = ThumbnailCache()
