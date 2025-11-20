# Web-AI

The `web-ai` service exposes a FastAPI dashboard that manages Browser-Use automation tasks.

## Features

- Launch multiple OpenAI-powered Browser-Use tasks with per-task settings (model + reasoning effort).
- Persist step history, chat transcripts, screenshots, and browser data on disk.
- Assign each task a secure VNC token so that the embedded noVNC proxy can only be opened through the Web-AI UI.
- Keep finished browsers alive (one per task) and close them manually when no longer needed.
- Respond to `ask_human` actions directly from the task detail pane.
- Serve a modern React SPA (Material UI based) from `frontend/dist` so the dashboard is dynamic without frequent page reloads.

## Running locally

```bash
cp .env.webai.example .env.webai
# fill in OPENAI_API_KEY, adjust host/ports if needed
cd frontend
npm install
npm run build
cd ..

# install uv if you don't have it yet: https://docs.astral.sh/uv/getting-started/installation/
uv sync --all-groups
export PYTHONPATH=$(pwd)/src
uv run python webai.py
```

Access the UI at `http://localhost:7790` (configurable via `WEB_AI_PORT`).

`uv sync --all-groups` installs backend dev dependencies too, so you can run backend tests with `uv run pytest`.

- Supported OpenAI models exposed in the UI: `gpt-5`, `gpt-5-mini`, `gpt-5-nano`.
- Reasoning effort options: `low`, `medium`, `high`, or automatic (unset).
- Task data is stored inside the `webai_data` Docker volume (`/app/data` inside the container).
- VNC viewer is proxied through the Web-AI server; each task gets a unique token.
- Finished sessions stay available thanks to persisted JSON histories.

You can also build the full service via Docker Compose; the frontend build is executed inside the image:

```bash
docker compose -f docker-compose.webai.yml up -d --build
```

## Development

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api` to `http://localhost:7790`, so run the FastAPI app in parallel (see running locally above) and then open `http://localhost:5173` for the instant-refresh interface.
