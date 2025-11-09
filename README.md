# Web-AI

The `web-ai` service exposes a FastAPI dashboard that manages Browser-Use automation tasks.

## Features

- Launch multiple OpenAI-powered Browser-Use tasks with per-task settings (model + reasoning effort).
- Persist step history, chat transcripts, screenshots, and browser data on disk.
- Assign each task a secure VNC token so that the embedded noVNC proxy can only be opened through the Web-AI UI.
- Keep finished browsers alive (one per task) and close them manually when no longer needed.
- Respond to `ask_human` actions directly from the task detail pane.

## Running locally

```bash
cp .env.webai.example .env.webai
# fill in OPENAI_API_KEY, adjust host/ports if needed
docker compose -f docker-compose.webai.yml up -d --build
```

The UI will be available on `http://localhost:7790` (configurable via `WEB_AI_PORT`).

- Supported OpenAI models exposed in the UI: `gpt-5`, `gpt-5-mini`, `gpt-5-nano`.
- Reasoning effort slider offers `low`, `medium`, `high`, or automatic (unset) to forward along OpenAI’s reasoning settings.

- Task data is stored inside the `webai_data` Docker volume (`/app/data` inside the container).
- VNC viewer is proxied through the Web-AI server; every task gets a unique token.
- When the container stops, tasks remain accessible thanks to the persisted JSON history.

## Development

```bash
cd web-ai
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export PYTHONPATH=$(pwd)/src:../web-ui/src
python webai.py
```

Then open `http://localhost:7790`.
