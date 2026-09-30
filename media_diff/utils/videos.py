import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
from io import BytesIO
from typing import Optional

from PIL import Image

from media_diff.config import (
    EXTRACT_CONCURRENCY,
    NATIVE_VIDEO_EXTENSIONS,
    VIDEO_TRANSCODE_CACHE_DIR,
)
from media_diff.utils.images import calculate_histogram

# ffmpeg binary: prefer env var, then imageio-ffmpeg bundled binary,
# finally fall back to system PATH lookup.
try:
    import imageio_ffmpeg as _imageio_ffmpeg

    _BUNDLED_FFMPEG = _imageio_ffmpeg.get_ffmpeg_exe()
except Exception:
    _BUNDLED_FFMPEG = None

FFMPEG_BIN = os.environ.get("FFMPEG_BIN") or _BUNDLED_FFMPEG or shutil.which("ffmpeg") or "ffmpeg"
# ffprobe: imageio-ffmpeg does NOT bundle ffprobe, so we can only use a system
# install if present. When None, probe_video falls back to `ffmpeg -i` parsing.
FFPROBE_BIN = os.environ.get("FFPROBE_BIN") or shutil.which("ffprobe")


class FFmpegError(Exception):
    pass


# Serialize transcoding so concurrent requests for the same (or different)
# Per-source transcode locks: different videos may transcode in parallel (bounded
# by the transcode executor), while concurrent requests for the same video are
# serialized so they never write the same temp file at once.
_transcode_locks: dict[str, threading.Lock] = {}
_transcode_locks_guard = threading.Lock()

# Per-source transcode state, keyed by normcase(abspath). Lets the frontend
# poll progress while the transcode runs, and lets us coalesce concurrent requests
# for the same video.
_transcode_states: dict[str, dict] = {}
_transcode_futures: dict[str, "concurrent.futures.Future"] = {}
_transcode_states_lock = threading.Lock()


def _transcode_key(path: str) -> str:
    return os.path.normcase(os.path.abspath(path))


def _transcode_lock_for(path: str) -> threading.Lock:
    key = _transcode_key(path)
    with _transcode_locks_guard:
        lock = _transcode_locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _transcode_locks[key] = lock
        return lock


def _set_transcode_state(path: str, **fields) -> None:
    key = _transcode_key(path)
    with _transcode_states_lock:
        _transcode_states.setdefault(key, {}).update(fields)


def _get_transcode_state(path: str) -> dict:
    with _transcode_states_lock:
        return dict(_transcode_states.get(_transcode_key(path)) or {})



def _run(cmd: list[str], timeout: float = 60.0) -> bytes:
    """Run a subprocess and return stdout bytes. Raises FFmpegError on failure."""
    try:
        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError as exc:
        raise FFmpegError("ffmpeg/ffprobe 未安装或不在 PATH 中") from exc
    except subprocess.TimeoutExpired as exc:
        raise FFmpegError("ffmpeg/ffprobe 执行超时") from exc
    if proc.returncode != 0:
        stderr = proc.stderr.decode("utf-8", errors="ignore")[:500]
        raise FFmpegError(stderr or "ffmpeg/ffprobe 执行失败")
    return proc.stdout


def _run_transcode(
    cmd: list[str],
    duration: float,
    on_progress,
    timeout: float = 1800.0,
) -> None:
    """Run an ffmpeg transcode, reporting progress parsed from ``-progress``.

    ffmpeg is told to write machine-readable progress (``out_time_us=...``) to
    stdout. stderr is merged into the same pipe so it cannot deadlock and so we
    can surface the tail of the log if the process fails. ``on_progress`` is
    called with a 0.0–1.0 fraction.
    """
    try:
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT
        )
    except FileNotFoundError as exc:
        raise FFmpegError("ffmpeg/ffprobe 未安装或不在 PATH 中") from exc

    tail: list[str] = []
    try:
        assert proc.stdout is not None
        for raw in proc.stdout:
            line = raw.decode("utf-8", errors="ignore").strip()
            if not line:
                continue
            tail.append(line)
            if len(tail) > 40:
                del tail[0]
            if line.startswith(("out_time_us=", "out_time_ms=")):
                try:
                    micros = int(line.split("=", 1)[1])
                except ValueError:
                    continue
                if duration > 0:
                    on_progress(min(1.0, micros / 1_000_000 / duration))
            elif line == "progress=end":
                on_progress(1.0)
        returncode = proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        proc.kill()
        proc.wait()
        raise FFmpegError("ffmpeg/ffprobe 执行超时") from exc
    if returncode != 0:
        raise FFmpegError("\n".join(tail[-6:]) or "ffmpeg/ffprobe 执行失败")



def probe_video(path: str) -> dict:
    """Probe video metadata.

    Uses ffprobe when available (more accurate); otherwise falls back to
    parsing `ffmpeg -i` stderr output.

    Returns dict with: width, height, fps, frame_count, duration, codec,
    format, browser_playable.
    """
    if FFPROBE_BIN:
        info = _probe_via_ffprobe(path)
    else:
        info = _probe_via_ffmpeg(path)
    info["browser_playable"] = _codec_browser_safe(path, info.get("codec", ""))
    return info


def _probe_via_ffprobe(path: str) -> dict:
    cmd = [
        FFPROBE_BIN,
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries",
        "stream=width,height,r_frame_rate,nb_frames,codec_name:format=duration,format_name",
        "-of", "json",
        path,
    ]
    out = _run(cmd, timeout=30.0)
    data = json.loads(out.decode("utf-8", errors="ignore"))

    streams = data.get("streams") or []
    fmt = data.get("format") or {}
    stream = streams[0] if streams else {}

    width = int(stream.get("width") or 0)
    height = int(stream.get("height") or 0)
    codec = stream.get("codec_name") or ""
    format_name = fmt.get("format_name") or ""

    # fps: r_frame_rate like "30/1"
    fps = 0.0
    r_frame_rate = stream.get("r_frame_rate") or "0/1"
    if "/" in r_frame_rate:
        num, den = r_frame_rate.split("/", 1)
        try:
            num_f = float(num)
            den_f = float(den)
            fps = num_f / den_f if den_f else 0.0
        except ValueError:
            fps = 0.0

    duration = 0.0
    try:
        duration = float(fmt.get("duration") or 0.0)
    except ValueError:
        duration = 0.0

    # frame count: prefer nb_frames, fallback to duration*fps
    frame_count = 0
    nb_frames = stream.get("nb_frames")
    if nb_frames not in (None, "N/A"):
        try:
            frame_count = int(nb_frames)
        except ValueError:
            frame_count = 0
    if frame_count <= 0 and fps > 0 and duration > 0:
        frame_count = int(duration * fps + 0.999)

    return {
        "width": width,
        "height": height,
        "fps": round(fps, 3),
        "frame_count": frame_count,
        "duration": round(duration, 3),
        "codec": codec,
        "format": format_name,
    }


# Regex patterns for parsing `ffmpeg -i` stderr.
_RE_DURATION = re.compile(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)")
_RE_INPUT_FMT = re.compile(r"Input #0,\s*([^,]+),")
_RE_VIDEO_LINE = re.compile(r"Stream #.*Video:\s*(\w+)")
_RE_RESOLUTION = re.compile(r"(\d{2,})x(\d{2,})")
_RE_FPS = re.compile(r"(\d+(?:\.\d+)?)\s+fps")
_RE_TBR = re.compile(r"(\d+(?:\.\d+)?)\s+tbr")


def _probe_via_ffmpeg(path: str) -> dict:
    """Probe metadata by parsing `ffmpeg -i <path>` stderr.

    ffmpeg exits non-zero when no output is specified, but stderr contains
    the full input info. This is less accurate than ffprobe (no nb_frames,
    fps may be approximate) but works with the imageio-ffmpeg binary which
    does not bundle ffprobe.
    """
    if not FFMPEG_BIN:
        raise FFmpegError("ffmpeg 未安装（imageio-ffmpeg 不可用且系统无 ffmpeg）")
    try:
        proc = subprocess.run(
            [FFMPEG_BIN, "-i", path],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=30.0,
            check=False,
        )
    except FileNotFoundError as exc:
        raise FFmpegError("ffmpeg 未安装或不在 PATH 中") from exc
    except subprocess.TimeoutExpired as exc:
        raise FFmpegError("ffmpeg 执行超时") from exc

    # returncode != 0 is expected (no output specified). Parse stderr anyway.
    stderr = proc.stderr.decode("utf-8", errors="ignore")
    if not stderr:
        raise FFmpegError("无法解析视频信息（ffmpeg 无输出）")

    # duration: HH:MM:SS.xx -> seconds
    duration = 0.0
    m = _RE_DURATION.search(stderr)
    if m:
        h, mi, s = m.group(1), m.group(2), m.group(3)
        try:
            duration = int(h) * 3600 + int(mi) * 60 + float(s)
        except ValueError:
            duration = 0.0

    # format name (first Input #0 line)
    format_name = ""
    m = _RE_INPUT_FMT.search(stderr)
    if m:
        format_name = m.group(1).strip()

    # find the Video stream line, parse codec/resolution/fps from it
    codec = ""
    width = 0
    height = 0
    fps = 0.0
    video_line = ""
    for line in stderr.splitlines():
        if "Video:" in line:
            video_line = line
            break
    if video_line:
        m = _RE_VIDEO_LINE.search(video_line)
        if m:
            codec = m.group(1)
        m = _RE_RESOLUTION.search(video_line)
        if m:
            width = int(m.group(1))
            height = int(m.group(2))
        m = _RE_FPS.search(video_line)
        if m:
            try:
                fps = float(m.group(1))
            except ValueError:
                fps = 0.0
        if fps <= 0:
            m = _RE_TBR.search(video_line)
            if m:
                try:
                    fps = float(m.group(1))
                except ValueError:
                    fps = 0.0

    # frame_count: ffmpeg -i does not report nb_frames, estimate from duration*fps
    frame_count = 0
    if fps > 0 and duration > 0:
        frame_count = int(duration * fps + 0.999)

    return {
        "width": width,
        "height": height,
        "fps": round(fps, 3),
        "frame_count": frame_count,
        "duration": round(duration, 3),
        "codec": codec,
        "format": format_name,
    }


def get_video_info(path: str) -> dict:
    """Cached ffprobe info."""
    try:
        mtime = os.path.getmtime(path)
    except OSError as exc:
        raise FFmpegError(f"无法访问视频文件: {exc}") from exc

    from media_diff.utils.video_cache import video_info_cache

    cached = video_info_cache.get(path)
    if cached is not None:
        return cached["info"]

    info = probe_video(path)
    video_info_cache.put(path, info, mtime)
    return info


def is_native_video(path: str) -> bool:
    ext = os.path.splitext(path)[1].lower()
    return ext in NATIVE_VIDEO_EXTENSIONS


# Codecs the browser can actually decode for each native container. The
# <video> element picks a decoder from the codec, not the file extension, so an
# ``.mp4`` holding MPEG-4 Part 2 (``mpeg4``), HEVC, ProRes, etc. is served
# happily but renders as a black first frame. Such files must be transcoded.
_BROWSER_SAFE_CODECS: dict[str, set[str]] = {
    ".mp4": {"h264", "avc1", "avc"},
    ".webm": {"vp8", "vp9", "av1", "vp10"},
}


def is_browser_playable(path: str) -> bool:
    """Whether a native-extension video is likely playable by the browser.

    Returns ``True`` when the codec is in the safe set, or when it cannot be
    probed (optimistically serve the original rather than transcode blindly).
    Non-native extensions return ``False``.
    """
    if os.path.splitext(path)[1].lower() not in _BROWSER_SAFE_CODECS:
        return False
    try:
        info = get_video_info(path)
    except FFmpegError:
        return True
    return _codec_browser_safe(path, info.get("codec", ""))


def _codec_browser_safe(path: str, codec: str) -> bool:
    """Whether ``codec`` in the container implied by ``path`` is playable.

    A missing/unknown codec is treated as playable (optimistic).
    """
    safe = _BROWSER_SAFE_CODECS.get(os.path.splitext(path)[1].lower())
    if not safe:
        return False
    if not codec:
        return True
    return codec.lower() in safe


def browser_playable_cached(path: str) -> Optional[bool]:
    """Cached browser-playability decision, or ``None`` when not yet probed.

    Avoids running ffprobe/ffmpeg, so it can be called on the event loop.
    """
    from media_diff.utils.video_cache import video_info_cache

    cached = video_info_cache.get(path)
    if cached is None:
        return None
    return bool(cached["info"].get("browser_playable", True))


def extract_frame(path: str, frame_no: int, fps: Optional[float] = None) -> bytes:
    """Extract a single frame as JPEG bytes via ffmpeg.

    frame_no is 1-based. Uses -ss (fast seek) before -i for speed.
    The seek time is clamped to the video duration to avoid seeking past EOF
    (which returns empty output / 500 errors when frame_no exceeds the
    actual frame count of a given video).
    """
    info = get_video_info(path)
    if fps is None or fps <= 0:
        fps = info["fps"] or 30.0
    t = max(0.0, (frame_no - 1) / fps)
    # Clamp t within the valid range so that frame_no larger than the video's
    # actual frame count still yields the last frame instead of failing.
    duration = info.get("duration") or 0.0
    if duration > 0:
        t = min(t, max(0.0, duration - 0.05))
    cmd = [
        FFMPEG_BIN,
        "-y",
        "-ss", f"{t:.3f}",
        "-i", path,
        "-frames:v", "1",
        "-q:v", "2",
        "-f", "image2pipe",
        "-vcodec", "mjpeg",
        "pipe:1",
    ]
    out = _run(cmd, timeout=30.0)
    if not out:
        # Fallback: seek to mid-point if clamped seek returned nothing.
        mid_t = (duration / 2) if duration > 0 else 0.0
        cmd2 = [
            FFMPEG_BIN, "-y", "-ss", f"{mid_t:.3f}", "-i", path,
            "-frames:v", "1", "-q:v", "2",
            "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1",
        ]
        out = _run(cmd2, timeout=30.0)
        if not out:
            raise FFmpegError("抽帧返回空数据（视频可能损坏）")
    return out


# Bound concurrent ffmpeg frame extractions and de-duplicate identical
# (path, frame) requests. Without this, rapid stepping spawns a process per
# request and saturates the CPU, which then stalls the frame the user is on.
_extract_semaphore = threading.BoundedSemaphore(EXTRACT_CONCURRENCY)
_extract_inflight: dict[tuple[str, int], threading.Event] = {}
_extract_inflight_lock = threading.Lock()


def extract_frame_with_histogram(path: str, frame_no: int) -> tuple[bytes, str]:
    """Extract frame JPEG + base64-encoded histogram (computed on the frame).

    Mirrors the image thumbnail X-Histogram mechanism so the frontend can
    reuse its histogram cache/rendering logic. Concurrent requests for the same
    frame share one ffmpeg run, and the number of concurrent ffmpeg processes
    is capped by ``EXTRACT_CONCURRENCY`` (the ``extract`` executor).
    """
    from media_diff.utils.video_cache import video_frame_cache

    try:
        mtime = os.path.getmtime(path)
    except OSError as exc:
        raise FFmpegError(f"无法访问视频文件: {exc}") from exc

    cached = video_frame_cache.get(path, frame_no)
    if cached is not None:
        return cached["jpeg_bytes"], cached["histogram_b64"]

    key = (path, frame_no)
    with _extract_inflight_lock:
        event = _extract_inflight.get(key)
        leader = event is None
        if leader:
            event = threading.Event()
            _extract_inflight[key] = event

    if not leader:
        # Another request is already extracting this exact frame; wait for it
        # instead of spawning a duplicate ffmpeg process.
        event.wait(timeout=60)
        cached = video_frame_cache.get(path, frame_no)
        if cached is not None:
            return cached["jpeg_bytes"], cached["histogram_b64"]
        # Leader failed; fall through and do the work ourselves.

    try:
        with _extract_semaphore:
            cached = video_frame_cache.get(path, frame_no)
            if cached is not None:
                return cached["jpeg_bytes"], cached["histogram_b64"]

            jpeg_bytes = extract_frame(path, frame_no)

            with Image.open(BytesIO(jpeg_bytes)) as img:
                rgb = img.convert("RGB")
                histogram = calculate_histogram(rgb)

            histogram_b64 = base64.b64encode(
                json.dumps(histogram).encode("utf-8")
            ).decode("ascii")

            video_frame_cache.put(path, frame_no, jpeg_bytes, histogram_b64, mtime)
            return jpeg_bytes, histogram_b64
    finally:
        if leader:
            with _extract_inflight_lock:
                if _extract_inflight.get(key) is event:
                    _extract_inflight.pop(key, None)
            event.set()


def make_video_thumbnail(path: str, size: int = 200) -> tuple[bytes, str]:
    """Extract mid-keyframe as a thumbnail JPEG + base64 histogram."""
    from media_diff.utils.video_cache import video_thumbnail_cache

    try:
        mtime = os.path.getmtime(path)
    except OSError as exc:
        raise FFmpegError(f"无法访问视频文件: {exc}") from exc

    cached = video_thumbnail_cache.get(path, size)
    if cached is not None:
        return cached["jpeg_bytes"], cached["histogram_b64"]

    info = get_video_info(path)
    duration = info["duration"] or 0.0
    t = duration / 2 if duration > 0 else 0.0
    if duration > 0:
        t = min(t, max(0.0, duration - 0.05))

    cmd = [
        FFMPEG_BIN,
        "-y",
        "-ss", f"{t:.3f}",
        "-i", path,
        "-frames:v", "1",
        "-f", "image2pipe",
        "-vcodec", "mjpeg",
        "pipe:1",
    ]
    jpeg_bytes = _run(cmd, timeout=30.0)
    if not jpeg_bytes:
        # Fallback to the first frame if the mid-point seek yielded nothing.
        cmd0 = [
            FFMPEG_BIN, "-y", "-i", path,
            "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1",
        ]
        jpeg_bytes = _run(cmd0, timeout=30.0)
        if not jpeg_bytes:
            raise FFmpegError("无法生成视频封面（视频可能损坏）")

    with Image.open(BytesIO(jpeg_bytes)) as img:
        rgb = img.convert("RGB")
        max_edge = max(rgb.width, rgb.height)
        if max_edge > size:
            scale = size / max_edge
            new_w = max(1, int(round(rgb.width * scale)))
            new_h = max(1, int(round(rgb.height * scale)))
            thumb = rgb.resize((new_w, new_h), Image.NEAREST)
        else:
            thumb = rgb
        histogram = calculate_histogram(thumb)
        buf = BytesIO()
        thumb.save(buf, format="JPEG", quality=85)
        thumb_bytes = buf.getvalue()

    histogram_b64 = base64.b64encode(
        json.dumps(histogram).encode("utf-8")
    ).decode("ascii")

    video_thumbnail_cache.put(path, size, thumb_bytes, histogram_b64, mtime)
    return thumb_bytes, histogram_b64


def _transcode_cache_path(path: str) -> str:
    """Return a stable cache file path for a transcoded mp4 of the given video.

    The cache dir lives under the system temp directory. Files are keyed by a
    hash of the absolute path so the same video maps to one cache file.
    """
    cache_root = transcode_cache_dir()
    os.makedirs(cache_root, exist_ok=True)
    # normcase lower-cases on Windows (no-op on POSIX) so that the same file
    # with different drive-letter casing maps to one cache entry.
    key = os.path.normcase(os.path.abspath(path))
    h = hashlib.md5(key.encode("utf-8")).hexdigest()[:16]
    return os.path.join(cache_root, f"{h}.mp4")


def _transcode_cache_ready(path: str) -> bool:
    """Whether a valid cached transcode exists for ``path`` (mtime+size match)."""
    out_path = _transcode_cache_path(path)
    meta_path = out_path + ".meta"
    if not (os.path.exists(out_path) and os.path.exists(meta_path)):
        return False
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
        return (
            meta.get("mtime") == os.path.getmtime(path)
            and meta.get("size") == os.path.getsize(path)
        )
    except (ValueError, OSError):
        return False


def transcode_status(path: str) -> dict:
    """Return the transcode state for ``path``.

    States: ``none`` (not started), ``pending`` (queued), ``running``
    (in progress with a 0.0–1.0 ``progress``), ``done``, ``error``.
    """
    try:
        if _transcode_cache_ready(path):
            return {"state": "done", "progress": 1.0}
    except OSError:
        pass
    state = _get_transcode_state(path)
    if not state:
        return {"state": "none", "progress": 0.0}
    return {
        "state": state.get("state", "none"),
        "progress": round(float(state.get("progress", 0.0)), 4),
        "error": state.get("error"),
    }


def start_transcode_async(path: str) -> dict:
    """Start (or join) a background transcode for ``path``.

    Idempotent: concurrent calls for the same video share one job. The job runs on
    the bounded ``transcode`` executor, so the number of concurrent transcodes is
    capped by ``MEDIA_DIFF_TRANSCODE_CONCURRENCY``. Returns the current
    :func:`transcode_status`.
    """
    if _transcode_cache_ready(path):
        _set_transcode_state(path, state="done", progress=1.0, error=None)
        return {"state": "done", "progress": 1.0}

    from media_diff.utils import pool

    key = _transcode_key(path)
    with _transcode_states_lock:
        future = _transcode_futures.get(key)
        if future is not None and not future.done():
            return transcode_status(path)
        _transcode_states[key] = {"state": "pending", "progress": 0.0, "error": None}

    future = pool.get_executor("transcode").submit(_run_transcode_job, path)
    with _transcode_states_lock:
        _transcode_futures[key] = future
    return {"state": "pending", "progress": 0.0}


def _run_transcode_job(path: str) -> None:
    try:
        transcode_to_mp4(path)
    except Exception as exc:  # surfaced to the client via transcode_status
        _set_transcode_state(path, state="error", error=str(exc))


def transcode_to_mp4(path: str) -> str:
    """Transcode a video to a cached h264/aac mp4 file.

    Returns the path to the transcoded mp4 (which supports Range seeking).
    Reuses an existing cache file if it exists and mtime+size match (stored in
    a sidecar .meta json). Otherwise transcodes and caches, reporting progress
    through :func:`transcode_status`.
    """
    try:
        mtime = os.path.getmtime(path)
    except OSError as exc:
        raise FFmpegError(f"无法访问视频文件: {exc}") from exc

    out_path = _transcode_cache_path(path)
    meta_path = out_path + ".meta"

    with _transcode_lock_for(path):
        if _transcode_cache_ready(path):
            _set_transcode_state(path, state="done", progress=1.0, error=None)
            return out_path

        duration = 0.0
        try:
            duration = get_video_info(path).get("duration") or 0.0
        except FFmpegError:
            pass

        _set_transcode_state(path, state="running", progress=0.0, error=None)

        # Transcode to a normal (faststart) mp4. Use fast preset for speed.
        # The temp file ends in ".tmp", so the muxer must be forced explicitly
        # with -f mp4 (ffmpeg cannot infer it from the extension).
        tmp_path = out_path + f".{os.getpid()}.{threading.get_ident()}.tmp"
        cmd = [
            FFMPEG_BIN,
            "-y",
            "-i", path,
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "23",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", "128k",
            "-movflags", "+faststart",
            "-nostats",
            "-progress", "pipe:1",
            "-f", "mp4",
            tmp_path,
        ]

        def report(fraction: float) -> None:
            _set_transcode_state(path, state="running", progress=fraction)

        try:
            _run_transcode(cmd, duration, report, timeout=1800.0)
            os.replace(tmp_path, out_path)
            with open(meta_path, "w", encoding="utf-8") as f:
                json.dump({"mtime": mtime, "size": os.path.getsize(path)}, f)
            _set_transcode_state(path, state="done", progress=1.0, error=None)
        except Exception as exc:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass
            _set_transcode_state(path, state="error", error=str(exc))
            raise
    return out_path


def transcode_cache_dir() -> str:
    """Directory holding cached transcoded videos.

    Defaults to a folder under the system temp dir; override with the
    ``MEDIA_DIFF_TRANSCODE_CACHE_DIR`` environment variable.
    """
    override = os.environ.get("MEDIA_DIFF_TRANSCODE_CACHE_DIR")
    if override:
        return os.path.expanduser(override)
    return os.path.join(tempfile.gettempdir(), VIDEO_TRANSCODE_CACHE_DIR)


def transcode_cache_stats() -> tuple[int, int]:
    """Return ``(file_count, total_bytes)`` for the transcode cache."""
    cache_root = transcode_cache_dir()
    if not os.path.isdir(cache_root):
        return 0, 0
    count = 0
    total = 0
    try:
        for name in os.listdir(cache_root):
            p = os.path.join(cache_root, name)
            try:
                if os.path.isfile(p):
                    count += 1
                    total += os.path.getsize(p)
            except OSError:
                continue
    except OSError:
        pass
    return count, total


def clear_transcode_cache(dry_run: bool = False) -> tuple[int, int]:
    """Remove every cached transcoded video.

    Returns ``(removed_count, removed_bytes)``; with ``dry_run`` nothing is
    deleted and the current stats are returned instead.
    """
    cache_root = transcode_cache_dir()
    count, total = transcode_cache_stats()
    if dry_run or count == 0:
        return count, total
    removed = 0
    removed_bytes = 0
    try:
        names = os.listdir(cache_root)
    except OSError:
        return 0, 0
    for name in names:
        p = os.path.join(cache_root, name)
        try:
            if not os.path.isfile(p):
                continue
            size = os.path.getsize(p)
            os.remove(p)
            removed += 1
            removed_bytes += size
        except OSError:
            pass
    return removed, removed_bytes


def cleanup_transcode_cache(max_entries: int = 20) -> None:
    """Best-effort cleanup of old transcode cache files (by mtime)."""
    cache_root = transcode_cache_dir()
    if not os.path.isdir(cache_root):
        return
    try:
        entries = []
        for name in os.listdir(cache_root):
            p = os.path.join(cache_root, name)
            if os.path.isfile(p):
                entries.append((p, os.path.getmtime(p)))
        entries.sort(key=lambda x: x[1], reverse=True)
        for p, _ in entries[max_entries:]:
            try:
                os.remove(p)
            except OSError:
                pass
            meta = p + ".meta"
            if os.path.exists(meta):
                try:
                    os.remove(meta)
                except OSError:
                    pass
    except OSError:
        pass


def get_playable_path(path: str) -> str:
    """Return a playable file path for <video>.

    Native formats (mp4/webm) whose codec the browser supports return the
    original path directly. Every other video (non-native containers, or native
    containers holding a browser-unsupported codec such as MPEG-4 Part 2/HEVC)
    is transcoded to a cached h264 mp4.
    """
    if is_native_video(path) and is_browser_playable(path):
        return path
    # Verify ffmpeg is available before transcoding
    if shutil.which(FFMPEG_BIN) is None:
        raise FFmpegError("视频需要转码，但 ffmpeg 未安装")
    return transcode_to_mp4(path)


def get_playable_path_cached(path: str) -> Optional[str]:
    """Like :func:`get_playable_path` but using only cached state (no ffmpeg).

    Returns ``None`` when a probe or transcode would be required. The streaming
    endpoint uses this so that serving a range never occupies one of the bounded
    ffmpeg executors in the common case (already probed / already transcoded),
    which would otherwise serialize playback's parallel range requests.
    """
    if is_native_video(path):
        cached = browser_playable_cached(path)
        if cached is True:
            return path
        if cached is None:
            return None  # needs a probe before we can decide
    if _transcode_cache_ready(path):
        return _transcode_cache_path(path)
    return None
