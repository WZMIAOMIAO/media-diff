import os


# 访问根目录（沙箱）：设置后仅允许浏览/读取该目录及其子目录，空值表示不限制。
# 由 CLI --root 或环境变量 MEDIA_DIFF_ROOT 设置。
ACCESS_ROOT = os.environ.get("MEDIA_DIFF_ROOT") or None


def _env_int(name: str, default: int) -> int:
    """Read a positive integer from the environment (fallback to default)."""
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value > 0 else default


IMAGE_EXTENSIONS: set[str] = {
    ".jpg",
    ".jpeg",
    ".png",
    ".bmp",
    ".tiff",
    ".tif",
    ".webp",
}

THUMBNAIL_DEFAULT_SIZE = 200
THUMBNAIL_CACHE_MAX = 500

# 视频相关配置
VIDEO_EXTENSIONS: set[str] = {
    ".mp4",
    ".mkv",
    ".avi",
    ".flv",
    ".mov",
    ".webm",
    ".wmv",
    ".m4v",
    ".mpg",
    ".mpeg",
    ".ts",
}

# 浏览器 <video> 原生可播放的格式（无需转码直接播放）
NATIVE_VIDEO_EXTENSIONS: set[str] = {".mp4", ".webm"}

VIDEO_THUMBNAIL_CACHE_MAX = 500
VIDEO_FRAME_CACHE_MAX = 1000
VIDEO_INFO_CACHE_MAX = 200

# ffmpeg 并发上限，按用途分开配置（环境变量可覆盖；CLI 参数会写入这些变量）。
# 抽帧：当前帧/预取的 ffmpeg 进程数上限。
EXTRACT_CONCURRENCY = _env_int("MEDIA_DIFF_EXTRACT_CONCURRENCY", 4)
# 转码：同时进行的转码数（不同视频可并行，同一视频内部串行）。
TRANSCODE_CONCURRENCY = _env_int("MEDIA_DIFF_TRANSCODE_CONCURRENCY", 1)
# 视频封面缩略图。
THUMBNAIL_CONCURRENCY = _env_int("MEDIA_DIFF_THUMBNAIL_CONCURRENCY", 2)
# 元信息探测（ffprobe / ffmpeg -i）。
PROBE_CONCURRENCY = _env_int("MEDIA_DIFF_PROBE_CONCURRENCY", 2)

VIDEO_TRANSCODE_CACHE_DIR = "_video_transcode_cache"

