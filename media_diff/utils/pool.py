"""Per-purpose bounded executors for ffmpeg work.

The video endpoints are ``async def`` but delegate the blocking ffmpeg calls to
these executors, so the event loop never blocks and the concurrency of each kind of
ffmpeg work is bounded independently (see ``media_diff.config``).

Using one executor per purpose instead of the shared AnyIO worker pool also means a
burst of frame extractions cannot starve other request types, and the limits can be
raised past AnyIO's default (40) for large servers.
"""

import atexit
import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, TypeVar

from media_diff import config

T = TypeVar("T")

# purpose -> (executor, worker count) created lazily on first use.
_PURPOSE_WORKERS: dict[str, int] = {
    "extract": config.EXTRACT_CONCURRENCY,
    "transcode": config.TRANSCODE_CONCURRENCY,
    "thumbnail": config.THUMBNAIL_CONCURRENCY,
    "probe": config.PROBE_CONCURRENCY,
}

_executors: dict[str, ThreadPoolExecutor] = {}


def executor_workers(purpose: str) -> int:
    """Configured worker count for a purpose (used by tests/diagnostics)."""
    return _PURPOSE_WORKERS.get(purpose, 1)


def get_executor(purpose: str) -> ThreadPoolExecutor:
    """Return the (lazily created) executor for ``purpose``."""
    executor = _executors.get(purpose)
    if executor is None:
        workers = max(1, _PURPOSE_WORKERS.get(purpose, 1))
        executor = ThreadPoolExecutor(
            max_workers=workers, thread_name_prefix=f"ffmpeg-{purpose}"
        )
        _executors[purpose] = executor
    return executor


async def run_ffmpeg(purpose: str, fn: Callable[[], T]) -> T:
    """Run a blocking ffmpeg helper in the executor for ``purpose``."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(get_executor(purpose), fn)


def shutdown() -> None:
    """Best-effort shutdown of all executors (called on process exit)."""
    for executor in _executors.values():
        executor.shutdown(wait=False)


atexit.register(shutdown)
