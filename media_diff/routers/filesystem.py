import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from media_diff.utils.filesystem import (
    MAX_RECURSIVE_ENTRIES,
    get_default_browse_path,
    get_roots,
    list_images,
    list_json_files,
    list_subdirs,
    list_videos,
)
from media_diff.utils.security import ensure_within_access_root

router = APIRouter(prefix="/api/filesystem", tags=["filesystem"])


class BrowseRequest(BaseModel):
    path: str
    include_json: bool = False


class ImagesRequest(BaseModel):
    path: str


class VideosRequest(BaseModel):
    path: str
    recursive: bool = False


def _resolve_path(path: str) -> str:
    # Enforce the access root before touching the filesystem so an outside path
    # is always rejected (and its existence is never leaked).
    ensure_within_access_root(path)
    normalized = os.path.normpath(path)
    if not os.path.exists(normalized):
        raise HTTPException(status_code=404, detail="路径不存在")
    if not os.path.isdir(normalized):
        raise HTTPException(status_code=400, detail="路径不是文件夹")
    return normalized


@router.get("/roots")
def get_roots_endpoint():
    return {"roots": get_roots()}


@router.get("/home")
def get_home_endpoint():
    """Default directory for the folder browser (home on Linux, Desktop on Windows)."""
    return {"path": get_default_browse_path()}


@router.post("/browse")
def browse(req: BrowseRequest):
    try:
        normalized = _resolve_path(req.path)
    except HTTPException:
        raise
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限访问该路径")

    try:
        subdirs = list_subdirs(normalized)
        images = list_images(normalized)
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限访问该路径")

    response = {
        "path": normalized,
        "subdirs": subdirs,
        "images": images,
    }

    try:
        videos = list_videos(normalized)
        if videos:
            response["videos"] = videos
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限访问该路径")

    if req.include_json:
        try:
            json_files = list_json_files(normalized)
        except PermissionError:
            raise HTTPException(status_code=403, detail="无权限访问该路径")
        response["json_files"] = json_files

    return response


@router.post("/images")
def list_images_endpoint(req: ImagesRequest):
    try:
        normalized = _resolve_path(req.path)
    except HTTPException:
        raise
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限访问该路径")

    try:
        images = list_images(normalized)
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限访问该路径")

    return {"images": images}


@router.post("/videos")
def list_videos_endpoint(req: VideosRequest):
    try:
        normalized = _resolve_path(req.path)
    except HTTPException:
        raise
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限访问该路径")

    try:
        videos = list_videos(normalized, recursive=req.recursive)
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限访问该路径")

    return {"videos": videos, "truncated": len(videos) >= MAX_RECURSIVE_ENTRIES}
