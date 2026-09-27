from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from media_diff.utils import blind_eval

router = APIRouter(prefix="/api/blind-eval", tags=["blind-eval"])


class SetupRequest(BaseModel):
    paths: list[str]
    total_parts: int = Field(ge=1)
    current_part: int = Field(ge=1)
    seed: int = 1234
    output_path: str
    load_existing: bool = False
    media: str = "image"


class VoteRequest(BaseModel):
    output_path: str
    image_name: str
    alias: str | None = None


class LoadRequest(BaseModel):
    output_path: str


class SaveRequest(BaseModel):
    output_path: str
    data: dict


def _raise(exc: blind_eval.BlindEvalError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=str(exc))


@router.post("/setup")
def setup(req: SetupRequest):
    try:
        return blind_eval.setup(
            paths=req.paths,
            total_parts=req.total_parts,
            current_part=req.current_part,
            seed=req.seed,
            output_path=req.output_path,
            load_existing=req.load_existing,
            media=req.media,
        )
    except blind_eval.BlindEvalError as exc:
        _raise(exc)


@router.post("/vote")
def vote(req: VoteRequest):
    try:
        return {"data": blind_eval.vote(req.output_path, req.image_name, req.alias)}
    except blind_eval.BlindEvalError as exc:
        _raise(exc)


@router.post("/load")
def load(req: LoadRequest):
    try:
        return {"data": blind_eval.load(req.output_path)}
    except blind_eval.BlindEvalError as exc:
        _raise(exc)


@router.post("/save")
def save(req: SaveRequest):
    try:
        return {"data": blind_eval.save(req.output_path, req.data)}
    except blind_eval.BlindEvalError as exc:
        _raise(exc)
