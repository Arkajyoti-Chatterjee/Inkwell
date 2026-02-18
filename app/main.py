from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.db import init_db
from app.routers import diagrams, pages


@asynccontextmanager
async def lifespan(app: FastAPI):
    Path("data/exports").mkdir(parents=True, exist_ok=True)
    await init_db()
    yield


app = FastAPI(title="Mermaid Tool", lifespan=lifespan)

app.mount("/static", StaticFiles(directory="app/static"), name="static")

app.include_router(pages.router)
app.include_router(diagrams.router, prefix="/api")


def run():
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)


if __name__ == "__main__":
    run()
