# Inkwell

Local Mermaid diagram viewer with auto-save and history. Render Mermaid diagrams in the browser, save them, and browse your diagram history.

## Setup

```bash
poetry install
```

## Run

This is an application, not an installable package. Run it with `poetry run` so dependencies from the Poetry venv are used:

```bash
poetry run uvicorn app.main:app --reload
```

Alternatively the following bash script would ensure the creation of venv , downloading packages and running the app

```bash
./run
```

Then open http://127.0.0.1:8000

## API

- `GET /` — Web UI
- `GET /api/diagrams` — List saved diagrams
- `POST /api/diagrams` — Create diagram
- `GET /api/diagrams/{id}` — Get diagram
- `PUT /api/diagrams/{id}` — Update diagram
- `DELETE /api/diagrams/{id}` — Delete diagram
