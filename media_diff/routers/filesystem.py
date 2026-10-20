import os

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from media_diff.utils.filesystem import (
    MAX_RECURSIVE_ENTRIES,
    get_default_browse_path,
    get_roots,
    list_all_entries,
    list_images,
    list_json_files,
    list_subdirs,
    list_videos,
)
from media_diff.utils.security import ensure_within_access_root
from media_diff.utils.zip_jobs import (
    cancel_zip_job,
    schedule_release,
    start_zip_job,
    take_zip_file,
    zip_status,
)

router = APIRouter(prefix="/api/filesystem", tags=["filesystem"])


class BrowseRequest(BaseModel):
    path: str
    include_json: bool = False


class ImagesRequest(BaseModel):
    path: str
    recursive: bool = False


class VideosRequest(BaseModel):
    path: str
    recursive: bool = False


class PathRequest(BaseModel):
    path: str


class JobRequest(BaseModel):
    job_id: str


def _resolve_path(path: str) -> str:
    # Enforce the access root before touching the filesystem so an outside path
    # is always rejected (and its existence is never leaked).
    ensure_within_access_root(path)
    # Always resolve to an absolute path so every path handed back to the client
    # (tree nodes, listed media, ...) is a full absolute path even when the user
    # typed a relative one. Otherwise relative roots would produce relative
    # child paths that then flow into compared folders / watermark / results.
    normalized = os.path.abspath(path)
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
        images = list_images(normalized, recursive=req.recursive)
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限访问该路径")

    return {"images": images, "truncated": len(images) >= MAX_RECURSIVE_ENTRIES}


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


@router.api_route("/download", methods=["GET", "HEAD"])
def download_endpoint(path: str = Query(...)):
    """Download a single file with its original bytes.

    ``FileResponse`` sets ``Content-Disposition: attachment`` (via ``filename``)
    so the browser saves it instead of rendering inline.

    ``HEAD`` is registered explicitly so the client can cheaply validate a path
    before starting the download (FastAPI does not auto-add it here).
    """
    try:
        ensure_within_access_root(path)
        normalized = os.path.abspath(path)
        if not os.path.exists(normalized):
            raise HTTPException(status_code=404, detail="路径不存在")
        if not os.path.isfile(normalized):
            raise HTTPException(status_code=400, detail="路径不是文件")
    except HTTPException:
        raise
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限访问该路径")

    return FileResponse(normalized, filename=os.path.basename(normalized))


@router.post("/prepare-zip")
def prepare_zip_endpoint(req: PathRequest):
    """Start (or join) a background job that packs a folder into a zip.

    The archive preserves the original directory structure (entries under a
    top-level folder named after ``path``) and includes hidden entries and empty
    directories. The client polls ``/zip-status`` for progress (so it can show
    that the server is compressing) and then downloads via ``/download-zip``.

    Folders with more than ``MAX_DOWNLOAD_ENTRIES`` entries are refused and
    reported via ``{"too_many": true, "total": N}`` so the client can localize
    the message.
    """
    try:
        normalized = _resolve_path(req.path)
    except HTTPException:
        raise
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限访问该路径")

    try:
        _entries, total, too_many = list_all_entries(normalized)
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限访问该路径")

    if too_many:
        return {"too_many": True, "total": total}

    filename = f"{os.path.basename(os.path.normpath(normalized)) or 'download'}.zip"
    job_id = start_zip_job(normalized, filename, total)
    return {"too_many": False, "job_id": job_id, "total": total, "filename": filename}


@router.get("/zip-status")
def zip_status_endpoint(job_id: str = Query(...)):
    """Return the packing progress for a job started by ``/prepare-zip``."""
    status = zip_status(job_id)
    if status is None:
        raise HTTPException(status_code=404, detail="压缩任务不存在或已失效")
    return status


@router.post("/cancel-zip")
def cancel_zip_endpoint(req: JobRequest):
    """Cancel a packing job (best effort); its temp file is removed."""
    if not cancel_zip_job(req.job_id):
        raise HTTPException(status_code=404, detail="压缩任务不存在或已失效")
    return {"ok": True}


@router.get("/download-zip")
def download_zip_endpoint(job_id: str = Query(...)):
    """Download the zip produced by a finished packing job.

    The temp file is not deleted immediately: browsers may issue several Range
    requests for one download (and pause/resume). Deletion is deferred until a
    grace period after the last response, so a resume still finds the file.
    """
    prepared = take_zip_file(job_id)
    if prepared is None:
        raise HTTPException(status_code=409, detail="压缩尚未完成或已失效")
    zip_path, filename = prepared
    return FileResponse(
        zip_path,
        filename=filename,
        media_type="application/zip",
        background=BackgroundTask(schedule_release, job_id),
    )
