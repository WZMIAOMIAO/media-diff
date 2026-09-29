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
# Upper bound on concurrent ffmpeg frame extractions. Rapid A/D stepping can
# otherwise spawn hundreds of competing ffmpeg processes and starve the CPU.
VIDEO_EXTRACT_CONCURRENCY = 4
VIDEO_TRANSCODE_CACHE_DIR = "_video_transcode_cache"

