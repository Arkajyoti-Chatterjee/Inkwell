import aiosqlite
import uuid
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path("data/diagrams.db")


async def get_db():
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    try:
        yield db
    finally:
        await db.close()


async def init_db():
    Path("data/exports").mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS diagrams (
                id          TEXT PRIMARY KEY,
                title       TEXT NOT NULL,
                source      TEXT NOT NULL,
                svg_path    TEXT,
                png_path    TEXT,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            )
        """)
        await db.execute("""
            CREATE INDEX IF NOT EXISTS idx_diagrams_updated
            ON diagrams(updated_at DESC)
        """)
        await db.commit()


async def save_diagram(db, title: str, source: str, svg_path: str | None, png_path: str | None) -> str:
    diagram_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        "INSERT INTO diagrams (id, title, source, svg_path, png_path, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (diagram_id, title, source, svg_path, png_path, now, now),
    )
    await db.commit()
    return diagram_id


async def update_diagram(db, diagram_id: str, title: str, source: str, svg_path: str | None, png_path: str | None):
    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        "UPDATE diagrams SET title=?, source=?, svg_path=?, png_path=?, updated_at=? WHERE id=?",
        (title, source, svg_path, png_path, now, diagram_id),
    )
    await db.commit()


async def list_diagrams(db, limit: int = 50, offset: int = 0) -> list[dict]:
    cursor = await db.execute(
        "SELECT id, title, source, svg_path, png_path, created_at, updated_at "
        "FROM diagrams ORDER BY updated_at DESC LIMIT ? OFFSET ?",
        (limit, offset),
    )
    return [dict(row) for row in await cursor.fetchall()]


async def get_diagram(db, diagram_id: str) -> dict | None:
    cursor = await db.execute(
        "SELECT id, title, source, svg_path, png_path, created_at, updated_at "
        "FROM diagrams WHERE id = ?",
        (diagram_id,),
    )
    row = await cursor.fetchone()
    return dict(row) if row else None


async def delete_diagram(db, diagram_id: str):
    await db.execute("DELETE FROM diagrams WHERE id = ?", (diagram_id,))
    await db.commit()
