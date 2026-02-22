import base64
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.db import get_db, update_diagram, list_diagrams, get_diagram, delete_diagram

router = APIRouter(prefix="/diagrams", tags=["diagrams"])

EXPORTS_DIR = Path("data/exports")


class DiagramCreate(BaseModel):
    title: str
    source: str
    svg: str
    png_base64: Optional[str] = None


class DiagramUpdate(BaseModel):
    title: str
    source: str
    svg: str
    png_base64: Optional[str] = None


@router.get("")
async def list_all(limit: int = 50, offset: int = 0, db=Depends(get_db)):
    return await list_diagrams(db, limit=limit, offset=offset)


@router.get("/{diagram_id}")
async def get_one(diagram_id: str, db=Depends(get_db)):
    diagram = await get_diagram(db, diagram_id)
    if not diagram:
        raise HTTPException(status_code=404, detail="Diagram not found")
    return diagram


@router.post("", status_code=201)
async def create(data: DiagramCreate, db=Depends(get_db)):
    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)

    # Save SVG
    diagram_id_placeholder = None
    import uuid

    diagram_id = str(uuid.uuid4())
    svg_path = EXPORTS_DIR / f"{diagram_id}.svg"
    svg_path.write_text(data.svg, encoding="utf-8")

    # Save PNG if provided
    png_path_str = None
    if data.png_base64:
        png_path = EXPORTS_DIR / f"{diagram_id}.png"
        png_path.write_bytes(base64.b64decode(data.png_base64))
        png_path_str = str(png_path)

    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        "INSERT INTO diagrams (id, title, source, svg_path, png_path, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (diagram_id, data.title, data.source, str(svg_path), png_path_str, now, now),
    )
    await db.commit()

    return {"id": diagram_id, "status": "saved"}


@router.put("/{diagram_id}")
async def update(diagram_id: str, data: DiagramUpdate, db=Depends(get_db)):
    existing = await get_diagram(db, diagram_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Diagram not found")

    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)

    # Overwrite SVG
    svg_path = EXPORTS_DIR / f"{diagram_id}.svg"
    svg_path.write_text(data.svg, encoding="utf-8")

    # Overwrite PNG if provided
    png_path_str = existing.get("png_path")
    if data.png_base64:
        png_path = EXPORTS_DIR / f"{diagram_id}.png"
        png_path.write_bytes(base64.b64decode(data.png_base64))
        png_path_str = str(png_path)

    await update_diagram(
        db, diagram_id, data.title, data.source, str(svg_path), png_path_str
    )
    return {"id": diagram_id, "status": "updated"}


@router.delete("/{diagram_id}")
async def delete(diagram_id: str, db=Depends(get_db)):
    existing = await get_diagram(db, diagram_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Diagram not found")

    # Remove files
    if existing.get("svg_path"):
        Path(existing["svg_path"]).unlink(missing_ok=True)
    if existing.get("png_path"):
        Path(existing["png_path"]).unlink(missing_ok=True)

    await delete_diagram(db, diagram_id)
    return {"status": "deleted"}


@router.get("/{diagram_id}/svg")
async def get_svg(diagram_id: str, db=Depends(get_db)):
    existing = await get_diagram(db, diagram_id)
    if not existing or not existing.get("svg_path"):
        raise HTTPException(status_code=404, detail="SVG not found")
    svg_path = Path(existing["svg_path"])
    if not svg_path.exists():
        raise HTTPException(status_code=404, detail="SVG file missing")
    return FileResponse(svg_path, media_type="image/svg+xml")


@router.get("/{diagram_id}/png")
async def get_png(diagram_id: str, db=Depends(get_db)):
    existing = await get_diagram(db, diagram_id)
    if not existing or not existing.get("png_path"):
        raise HTTPException(status_code=404, detail="PNG not found")
    png_path = Path(existing["png_path"])
    if not png_path.exists():
        raise HTTPException(status_code=404, detail="PNG file missing")
    return FileResponse(png_path, media_type="image/png")
