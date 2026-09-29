import os

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, Response

from media_diff.config import THUMBNAIL_DEFAULT_SIZE, VIDEO_EXTENSIONS
from media_diff.utils.videos import (
    FFmpegError,
    extract_frame_with_histogram,
    get_playable_path,
    get_video_info,
    is_browser_playable,
    make_video_thumbnail,
    start_transcode_async,
    transcode_status,
)

router = APIRouter(prefix="/api/videos", tags=["videos"])

_NATIVE_EXTS = {".mp4", ".webm"}


def _validate_video_path(path: str) -> str:
    normalized = os.path.normpath(path)
    if not os.path.exists(normalized):
        raise HTTPException(status_code=404, detail="路径不存在")
    if not os.path.isfile(normalized):
        raise HTTPException(status_code=400, detail="路径不是文件")
    ext = os.path.splitext(normalized)[1].lower()

    if ext not in VIDEO_EXTENSIONS:
        raise HTTPException(status_code=400, detail="不支持的视频格式")
    return normalized


def _handle_ffmpeg_error(exc: FFmpegError) -> None:
    detail = str(exc)
    if "未安装" in detail:
        raise HTTPException(status_code=500, detail=detail)
    raise HTTPException(status_code=400, detail=f"视频处理失败: {detail}")


@router.get("/info")
def video_info(path: str = Query(..., description="视频文件绝对路径")):
    try:
        normalized = _validate_video_path(path)
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限访问该路径")

    try:
        info = get_video_info(normalized)
    except FFmpegError as exc:
        _handle_ffmpeg_error(exc)
        return  # unreachable
    return info


@router.get("/stream")
def video_stream(path: str = Query(..., description="视频文件绝对路径")):
    """Return a playable video file for <video>.

    Native formats (mp4/webm) are served directly with Range support via
    FileResponse. Non-native formats are transcoded to a cached mp4 first.
    """
    try:
        normalized = _validate_video_path(path)
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限访问该路径")

    try:
        playable = get_playable_path(normalized)
    except FFmpegError as exc:
        _handle_ffmpeg_error(exc)
        return  # unreachable

    ext = os.path.splitext(playable)[1].lower()
    media_type = "video/mp4" if ext == ".mp4" else "video/webm"
    try:
        # Do NOT pass filename= here: it would add
        # "Content-Disposition: attachment", which can interfere with inline
        # <video> playback. Range requests are still handled by FileResponse.
        return FileResponse(playable, media_type=media_type)
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限访问该路径")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"无法读取视频文件: {exc}")


@router.post("/transcode")
def start_transcode(path: str = Query(..., description="视频文件绝对路径")):
    """Kick off a background transcode for a browser-unsupported video.

    Returns immediately; poll ``GET /api/videos/transcode-status`` for progress.
    """
    try:
        normalized = _validate_video_path(path)
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限访问该路径")

    if is_browser_playable(normalized):
        return {"state": "not_needed", "progress": 1.0}
    return start_transcode_async(normalized)


@router.get("/transcode-status")
def get_transcode_status(path: str = Query(..., description="视频文件绝对路径")):
    """Return transcode progress for a video (``none``/``pending``/``running``/
    ``done``/``error``)."""
    try:
        normalized = _validate_video_path(path)
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限访问该路径")
    return transcode_status(normalized)


@router.get("/frame")
def video_frame(
    path: str = Query(..., description="视频文件绝对路径"),
    frame: int = Query(..., ge=1, description="帧号（1-based）"),
):
    """Extract a single frame as JPEG + X-Histogram response header.

    Only invoked on pause/step (not during playback).
    """
    try:
        normalized = _validate_video_path(path)
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限访问该路径")

    try:
        jpeg_bytes, histogram_b64 = extract_frame_with_histogram(normalized, frame)
    except FFmpegError as exc:
        _handle_ffmpeg_error(exc)
        return  # unreachable
    return Response(
        content=jpeg_bytes,
        media_type="image/jpeg",
        headers={"X-Histogram": histogram_b64},
    )


@router.get("/thumbnail")
def video_thumbnail(
    path: str = Query(..., description="视频文件绝对路径"),
    size: int = Query(
        THUMBNAIL_DEFAULT_SIZE, ge=1, le=4096, description="缩略图最大边像素数"
    ),
):
    try:
        normalized = _validate_video_path(path)
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限访问该路径")

    try:
        jpeg_bytes, histogram_b64 = make_video_thumbnail(normalized, size)
    except FFmpegError as exc:
        _handle_ffmpeg_error(exc)
        return  # unreachable
    return Response(
        content=jpeg_bytes,
        media_type="image/jpeg",
        headers={"X-Histogram": histogram_b64},
    )


@router.get("/histogram")
def video_frame_histogram(
    path: str = Query(..., description="视频文件绝对路径"),
    frame: int = Query(..., ge=1, description="帧号（1-based）"),
):
    """Fallback: return RGB histogram JSON for a single frame.

    Used by overlay compare when the histogram is not in the frame cache.
    """
    try:
        normalized = _validate_video_path(path)
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限访问该路径")

    try:
        _, histogram_b64 = extract_frame_with_histogram(normalized, frame)
    except FFmpegError as exc:
        _handle_ffmpeg_error(exc)
        return  # unreachable
    import base64
    import json

    histogram = json.loads(base64.b64decode(histogram_b64))
    return histogram
