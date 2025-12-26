# Web-AI

The `web-ai` stack is now split into a **head** (UI + security + routing) and one or more **nodes** (task runners that store browser data and schedules locally).

## Features

- Launch multiple OpenAI-powered Browser-Use tasks with per-task settings (model + reasoning effort).
- Persist step history, chat transcripts, screenshots, and browser data on disk.
- Assign each task a secure VNC token so that the embedded noVNC proxy can only be opened through the Web-AI UI.
- Keep finished browsers alive (one per task) and close them manually when no longer needed.
- Respond to `ask_human` actions directly from the task detail pane.
- Serve a modern React SPA (Material UI based) from `frontend/dist` so the dashboard is dynamic without frequent page reloads.
- Run multiple nodes; tasks stay on the node where they were created. The head never moves browser data between nodes.

## Running locally

```bash
# install uv if you don't have it yet: https://docs.astral.sh/uv/getting-started/installation/
uv sync --all-groups

# build the frontend for the UI served by the head
cd frontend
npm install
npm run build
cd ..

# run a node locally (stores tasks + browser data)
export PYTHONPATH=$(pwd)/src
APP_PORT=8001 NODE_ID=local NODE_REQUIRE_AUTH=false uv run python webai.py

# run the head locally (UI + routing)
HEAD_NODES=http://localhost:8001|local HEAD_PORT=7790 uv run python webai_head.py
```

Access the UI at `http://localhost:7790`. Tasks will run on the `local` node. For production, set `WEB_AI_HEAD_PUBLIC_KEYS` on nodes to the head public key and remove the insecure `disabled` placeholder.

`uv sync --all-groups` installs backend dev dependencies too, so you can run backend tests with `uv run pytest`.

- Supported OpenAI models exposed in the UI: `gpt-5.2`, `gpt-5.1`, `gpt-5`, `gpt-5-mini`, `gpt-5-nano` (plus custom entries).
- Reasoning effort options vary by model: `gpt-5.1` and `gpt-5` support configurable effort (`low`, `medium`, `high`, or automatic), while `gpt-5.2`, `gpt-5-mini`, and `gpt-5-nano` default to automatic unless a custom value is provided.
- Task data is stored inside the node volume (`/app/data` inside the node container).
- VNC viewer is served by the node; head returns node-specific VNC URLs secured by per-task tokens.
- Finished sessions stay available thanks to persisted JSON histories stored on each node.

You can also build the full service via Docker Compose (head + one node by default):

```bash
docker compose up -d --build
```

Compose notes:
- The head generates its keypair; nodes verify requests with the head public key. With the default auth-enabled setup, ensure the head writes `head_public.pem` to the shared `head_keys` volume before making authenticated calls. Nodes will reload trusted keys on demand, but secured APIs return 503 until the key exists.
- For quick local bring-up without the head key, set `NODE_REQUIRE_AUTH=false` on the node.
- Sample `.env.head` (create this file or set env vars) — see `.env.head.example`:

```
HEAD_NODES=http://node:8001|default
HEAD_PORT=7790
```

- Sample `.env` for nodes (see `.env.node.example`): set `OPENAI_API_KEY`, `HEAD_PUBLIC_KEYS` (path or PEM), and `NODE_ID`.

## Development

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api` to `http://localhost:7790`, so run the FastAPI app in parallel (see running locally above) and then open `http://localhost:5173` for the instant-refresh interface.
