import base64
import json
import os

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, Response
from PIL import Image

from media_diff.config import IMAGE_EXTENSIONS, THUMBNAIL_DEFAULT_SIZE
from media_diff.utils.cache import thumbnail_cache
from media_diff.utils.images import generate_thumbnail

router = APIRouter(prefix="/api/images", tags=["images"])


def _validate_image_path(path: str) -> str:
    """Validate path exists, is a file, and has a supported image extension."""
    normalized = os.path.normpath(path)
    if not os.path.exists(normalized):
        raise HTTPException(status_code=404, detail="路径不存在")
    if not os.path.isfile(normalized):
        raise HTTPException(status_code=400, detail="路径不是文件")
    ext = os.path.splitext(normalized)[1].lower()
    if ext not in IMAGE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="不支持的图片格式")
    return normalized


@router.get("/view")
def view_image(path: str = Query(..., description="图片文件的绝对路径")):
    """直接返回图片文件。"""
    try:
        normalized = _validate_image_path(path)
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限访问该路径")

    try:
        return FileResponse(normalized)
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限访问该路径")
    except Exception:
        raise HTTPException(status_code=400, detail="无法读取图片文件")


@router.get("/thumbnail")
def get_thumbnail(
    path: str = Query(..., description="图片文件的绝对路径"),
    size: int = Query(
        THUMBNAIL_DEFAULT_SIZE, ge=1, le=4096, description="缩略图最大边像素数"
    ),
):
    """返回缩略图 JPEG + X-Histogram 响应头（合并接口）。

    直方图基于缩略图（非原图）计算，减少计算量。结果经 LRU 缓存，
    以 (path, size) 为 key，命中时比对 mtime 失效重算。
    """
    try:
        normalized = _validate_image_path(path)
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限访问该路径")

    cached = thumbnail_cache.get(normalized, size)
    if cached is not None:
        return Response(
            content=cached["jpeg_bytes"],
            media_type="image/jpeg",
            headers={"X-Histogram": cached["histogram_b64"]},
        )

    try:
        mtime = os.path.getmtime(normalized)
        jpeg_bytes, histogram = generate_thumbnail(normalized, size)
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限访问该路径")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"无法生成缩略图: {exc}")

    histogram_b64 = base64.b64encode(
        json.dumps(histogram).encode("utf-8")
    ).decode("ascii")

    thumbnail_cache.put(normalized, size, jpeg_bytes, histogram_b64, mtime)

    return Response(
        content=jpeg_bytes,
        media_type="image/jpeg",
        headers={"X-Histogram": histogram_b64},
    )


@router.get("/histogram")
def get_histogram(path: str = Query(..., description="图片文件的绝对路径")):
    """返回 RGB 直方图 JSON（单独请求，缓存未命中时的 fallback）。

    为保持与 thumbnail 接口一致，直方图基于默认尺寸的缩略图计算，
    同时写入 LRU 缓存供后续 thumbnail 请求复用。
    """
    try:
        normalized = _validate_image_path(path)
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限访问该路径")

    cached = thumbnail_cache.get(normalized, THUMBNAIL_DEFAULT_SIZE)
    if cached is not None:
        histogram = json.loads(base64.b64decode(cached["histogram_b64"]))
        return histogram

    try:
        mtime = os.path.getmtime(normalized)
        _, histogram = generate_thumbnail(normalized, THUMBNAIL_DEFAULT_SIZE)
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限访问该路径")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"无法计算直方图: {exc}")

    histogram_b64 = base64.b64encode(
        json.dumps(histogram).encode("utf-8")
    ).decode("ascii")
    thumbnail_cache.put(
        normalized, THUMBNAIL_DEFAULT_SIZE, b"", histogram_b64, mtime
    )

    return histogram
