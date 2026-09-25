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

from media_diff.config import NATIVE_VIDEO_EXTENSIONS, VIDEO_TRANSCODE_CACHE_DIR
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
# non-native videos never write to the same temp file at once.
_transcode_lock = threading.Lock()


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


def probe_video(path: str) -> dict:
    """Probe video metadata.

    Uses ffprobe when available (more accurate); otherwise falls back to
    parsing `ffmpeg -i` stderr output.

    Returns dict with: width, height, fps, frame_count, duration, codec, format.
    """
    if FFPROBE_BIN:
        return _probe_via_ffprobe(path)
    return _probe_via_ffmpeg(path)


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


def extract_frame_with_histogram(path: str, frame_no: int) -> tuple[bytes, str]:
    """Extract frame JPEG + base64-encoded histogram (computed on the frame).

    Mirrors the image thumbnail X-Histogram mechanism so the frontend can
    reuse its histogram cache/rendering logic.
    """
    from media_diff.utils.video_cache import video_frame_cache

    try:
        mtime = os.path.getmtime(path)
    except OSError as exc:
        raise FFmpegError(f"无法访问视频文件: {exc}") from exc

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
    cache_root = os.path.join(tempfile.gettempdir(), VIDEO_TRANSCODE_CACHE_DIR)
    os.makedirs(cache_root, exist_ok=True)
    # normcase lower-cases on Windows (no-op on POSIX) so that the same file
    # with different drive-letter casing maps to one cache entry.
    key = os.path.normcase(os.path.abspath(path))
    h = hashlib.md5(key.encode("utf-8")).hexdigest()[:16]
    return os.path.join(cache_root, f"{h}.mp4")


def transcode_to_mp4(path: str) -> str:
    """Transcode a non-native video to a cached h264/aac mp4 file.

    Returns the path to the transcoded mp4 (which supports Range seeking).
    Reuses an existing cache file if it exists and mtime matches (stored in a
    sidecar .meta json). Otherwise transcodes and caches.
    """
    try:
        mtime = os.path.getmtime(path)
    except OSError as exc:
        raise FFmpegError(f"无法访问视频文件: {exc}") from exc

    out_path = _transcode_cache_path(path)
    meta_path = out_path + ".meta"

    with _transcode_lock:
        if os.path.exists(out_path) and os.path.exists(meta_path):
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                if meta.get("mtime") == mtime and meta.get("size") == os.path.getsize(path):
                    return out_path
            except (ValueError, OSError):
                pass

        # Transcode to a normal (faststart) mp4. Use fast preset for speed.
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
            tmp_path,
        ]
        try:
            _run(cmd, timeout=1800.0)
            os.replace(tmp_path, out_path)
            with open(meta_path, "w", encoding="utf-8") as f:
                json.dump({"mtime": mtime, "size": os.path.getsize(path)}, f)
        except Exception:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass
            raise
    return out_path


def cleanup_transcode_cache(max_entries: int = 20) -> None:
    """Best-effort cleanup of old transcode cache files (by mtime)."""
    cache_root = os.path.join(tempfile.gettempdir(), VIDEO_TRANSCODE_CACHE_DIR)
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

    Native formats (mp4/webm) return the original path directly. Non-native
    formats are transcoded to a cached mp4 (supports Range seeking).
    """
    if is_native_video(path):
        return path
    # Verify ffmpeg is available before transcoding
    if shutil.which(FFMPEG_BIN) is None:
        raise FFmpegError("非原生格式需要 ffmpeg 转码，但 ffmpeg 未安装")
    return transcode_to_mp4(path)
