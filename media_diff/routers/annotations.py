from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from media_diff.utils import annotations

router = APIRouter(prefix="/api/annotations", tags=["annotations"])


class CheckPathRequest(BaseModel):
    path: str
    media: str = "image"


class LoadRequest(BaseModel):
    save_path: str
    media: str = "image"


class SaveRequest(BaseModel):
    save_path: str
    annotations: list[dict]
    media: str = "image"


def _raise(exc: annotations.AnnotationError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=str(exc))


@router.post("/check-path")
def check_path(req: CheckPathRequest):
    try:
        return annotations.check_path(req.path, req.media)
    except annotations.AnnotationError as exc:
        _raise(exc)


@router.post("/load")
def load(req: LoadRequest):
    try:
        return {"data": annotations.load(req.save_path, req.media)}
    except annotations.AnnotationError as exc:
        _raise(exc)


@router.post("/save")
def save(req: SaveRequest):
    try:
        return {"data": annotations.save(req.save_path, req.annotations, req.media)}
    except annotations.AnnotationError as exc:
        _raise(exc)
