from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any
from datetime import datetime

from fastapi import Body, Depends, FastAPI, HTTPException, Response, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, field_validator

from .config import Settings, get_settings
from .models import TaskCreatePayload
from .task_runner import TaskManager, _safe_model_dump
from .security import TokenVerifier, load_public_keys
from .storage import TaskStorage

REASONING_EFFORT_OPTIONS = ["low", "medium", "high"]

MODEL_REASONING_EFFORTS: dict[str, list[str]] = {
    "gpt-5.2": REASONING_EFFORT_OPTIONS,
    "gpt-5.1": REASONING_EFFORT_OPTIONS,
    "gpt-5": REASONING_EFFORT_OPTIONS,
    "gpt-5-mini": REASONING_EFFORT_OPTIONS,
    "gpt-5-nano": REASONING_EFFORT_OPTIONS,
}

BASE_MODELS = list(MODEL_REASONING_EFFORTS.keys())


class AssistPayload(BaseModel):
    message: str


class ContinuePayload(BaseModel):
    instructions: str


class SchedulePayload(BaseModel):
    scheduled_for: datetime

    @field_validator("scheduled_for")
    @classmethod
    def _require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("scheduled_for must include timezone information.")
        return value

ROOT_DIR = Path(__file__).resolve().parents[2]
FRONTEND_DIST = ROOT_DIR / "frontend" / "dist"
FRONTEND_PLACEHOLDER = """
<html>
  <head>
    <title>Frontend missing</title>
  </head>
  <body>
    <h1>Frontend build not found</h1>
    <p>Please run <code>npm install</code> and <code>npm run build</code> inside the <code>frontend</code> directory.</p>
  </body>
</html>
"""


def create_app() -> FastAPI:
    settings = get_settings()
    manager = TaskManager(settings)
    supported_models = sorted(set(BASE_MODELS + [settings.openai_model]))
    reasoning_effort_options_by_model = dict(MODEL_REASONING_EFFORTS)
    if settings.openai_model not in reasoning_effort_options_by_model:
        reasoning_effort_options_by_model[settings.openai_model] = []

    verifier: TokenVerifier | None = None
    def _reload_verifier() -> TokenVerifier | None:
        if not settings.head_auth_required:
            return None
        public_keys = load_public_keys(settings.head_public_keys)
        if public_keys:
            return TokenVerifier(
                public_keys=public_keys,
                audience=settings.head_token_audience,
                algorithm=settings.head_jwt_algorithm,
            )
        return None

    verifier: TokenVerifier | None = _reload_verifier()

    app = FastAPI(title="Browser Web AI", version="0.1.0")
    app.state.settings = settings
    app.state.manager = manager
    app.state.supported_models = supported_models
    app.state.reasoning_effort_options_by_model = reasoning_effort_options_by_model
    app.state.verifier = verifier
    app.state.enroll_token = settings.enroll_token

    @app.on_event("startup")
    async def startup() -> None:  # pragma: no cover - FastAPI hook
        await manager.startup()

    @app.on_event("shutdown")
    async def shutdown() -> None:  # pragma: no cover - FastAPI hook
        await manager.shutdown()

    def get_ctx() -> tuple[TaskManager, Settings]:
        return app.state.manager, app.state.settings

    async def require_head_auth(request: Request):
        if not settings.head_auth_required:
            return
        verifier = app.state.verifier or _reload_verifier()
        app.state.verifier = verifier
        if verifier is None:
            raise HTTPException(status_code=503, detail="Trusted head keys not configured")
        auth_header = request.headers.get("authorization") or request.headers.get("Authorization")
        if not auth_header or not auth_header.lower().startswith("bearer "):
            raise HTTPException(status_code=401, detail="Missing authorization")
        token = auth_header.split(" ", 1)[1].strip()
        try:
            verifier.verify_for_node(token, node_id=settings.node_id)
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid token")

    def _health_status() -> dict[str, Any]:
        issues: list[str] = []
        ready = True
        if settings.head_auth_required:
            verifier = app.state.verifier or _reload_verifier()
            app.state.verifier = verifier
            if not verifier:
                ready = False
                issues.append("head_trust_missing")
        if not settings.openai_api_key:
            ready = False
            issues.append("openai_key_missing")
        return {"status": "ok", "ready": ready, "issues": issues}

    def _head_key_path() -> Path:
        """Pick a path where the trusted head key should be stored."""
        for candidate in settings.head_public_keys:
            if not candidate:
                continue
            # Inline PEM strings contain the BEGIN header; skip those when choosing a filesystem path.
            if "BEGIN PUBLIC KEY" in candidate:
                continue
            return Path(candidate).resolve()
        return (settings.base_data_dir / "head-keys" / "head_public.pem").resolve()

    async def _persist_head_key(pem: str, settings: Settings) -> Path:
        """Write the PEM to disk so trust survives restarts."""
        target = _head_key_path()
        target.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(target.write_text, pem, encoding="utf-8")
        return target

    @app.post("/api/admin/head-key")
    async def install_head_key(payload: dict = Body(...)):
        token = payload.get("token")
        pem = payload.get("public_key") or payload.get("publicKey")
        if settings.enroll_token:
            if token != settings.enroll_token:
                raise HTTPException(status_code=401, detail="Invalid enroll token")
        else:
            raise HTTPException(status_code=403, detail="Enrollment disabled")
        if not pem or not isinstance(pem, str):
            raise HTTPException(status_code=400, detail="public_key is required")
        try:
            keys = load_public_keys([pem])
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid public key")
        try:
            target = await _persist_head_key(pem, settings)
        except OSError as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to persist head public key: {exc!s}",
            )
        settings.head_public_keys = [str(target)]
        app.state.verifier = _reload_verifier()
        return {"status": "ok", "trusted_keys": len(keys), "path": str(target)}

    # Health endpoint for unauthenticated checks
    @app.get("/healthz")
    async def healthcheck():
        return _health_status()

    @app.get("/api/node/info")
    async def node_info(auth=Depends(require_head_auth)):
        status = _health_status()
        return {
            "id": settings.node_id,
            "name": settings.node_name,
            "ready": status["ready"],
            "issues": status["issues"],
            "enrollment": bool(settings.enroll_token),
        }

    @app.get("/api/config/defaults")
    async def config_defaults(
        ctx: tuple[TaskManager, Settings] = Depends(get_ctx),
        auth=Depends(require_head_auth),
    ):
        _, config = ctx
        return {
            "model": config.openai_model,
            "temperature": config.openai_temperature,
            "max_steps": config.max_steps,
            "refreshSeconds": config.frontend_refresh_seconds,
            "supportedModels": app.state.supported_models,
            "openaiBaseUrl": config.openai_base_url,
            "leaveBrowserOpen": False,
            "reasoningEffortOptions": app.state.reasoning_effort_options_by_model.get(
                config.openai_model,
                [],
            ),
            "reasoningEffortOptionsByModel": app.state.reasoning_effort_options_by_model,
            "schedulingEnabled": True,
            "scheduleCheckSeconds": config.schedule_check_interval_seconds,
            "nodeId": config.node_id,
            "nodeName": config.node_name,
        }

    @app.get("/api/tasks")
    async def list_tasks(
        ctx: tuple[TaskManager, Settings] = Depends(get_ctx),
        auth=Depends(require_head_auth),
    ):
        manager, _ = ctx
        return [summary.model_dump(mode="json") for summary in manager.list_tasks()]

    def serialize_detail(detail: "TaskDetail") -> dict[str, Any]:
        return {
            "record": _safe_model_dump(detail.record),
            "steps": [_safe_model_dump(step) for step in detail.steps],
            "chat_history": [_safe_model_dump(msg) for msg in detail.chat_history],
            "vnc_launch_url": detail.vnc_launch_url,
        }

    @app.post("/api/tasks", status_code=201)
    async def create_task(
        payload: TaskCreatePayload,
        ctx: tuple[TaskManager, Settings] = Depends(get_ctx),
        auth=Depends(require_head_auth),
    ):
        manager, settings = ctx
        try:
            detail = await manager.create_task(payload)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        return serialize_detail(detail)

    @app.get("/api/tasks/{task_id}")
    async def task_detail(
        task_id: str,
        ctx: tuple[TaskManager, Settings] = Depends(get_ctx),
        auth=Depends(require_head_auth),
    ):
        manager, _ = ctx
        detail = manager.get_task_detail(task_id)
        if not detail:
            raise HTTPException(status_code=404, detail="Task not found")
        return serialize_detail(detail)

    @app.post("/api/tasks/{task_id}/assist")
    async def provide_assistance(
        task_id: str,
        payload: AssistPayload = Body(...),
        ctx: tuple[TaskManager, Settings] = Depends(get_ctx),
        auth=Depends(require_head_auth),
    ):
        manager, _ = ctx
        detail = await manager.submit_assistance(task_id, payload.message.strip())
        if not detail:
            raise HTTPException(status_code=404, detail="Task not awaiting assistance.")
        return serialize_detail(detail)

    @app.post("/api/tasks/{task_id}/continue")
    async def continue_task(
        task_id: str,
        payload: ContinuePayload = Body(...),
        ctx: tuple[TaskManager, Settings] = Depends(get_ctx),
        auth=Depends(require_head_auth),
    ):
        manager, _ = ctx
        try:
            detail = await manager.continue_task(task_id, payload.instructions)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail=str(exc))
        if not detail:
            raise HTTPException(status_code=404, detail="Task not found")
        return serialize_detail(detail)

    @app.post("/api/tasks/{task_id}/run-now")
    async def run_scheduled_now(
        task_id: str,
        ctx: tuple[TaskManager, Settings] = Depends(get_ctx),
        auth=Depends(require_head_auth),
    ):
        manager, _ = ctx
        if not manager.get_task(task_id):
            raise HTTPException(status_code=404, detail="Task not found")
        detail = await manager.run_scheduled_now(task_id)
        if not detail:
            raise HTTPException(status_code=409, detail="Task is not scheduled or already starting.")
        return serialize_detail(detail)

    @app.post("/api/tasks/{task_id}/schedule")
    async def reschedule_task(
        task_id: str,
        payload: SchedulePayload = Body(...),
        ctx: tuple[TaskManager, Settings] = Depends(get_ctx),
        auth=Depends(require_head_auth),
    ):
        manager, _ = ctx
        if not manager.get_task(task_id):
            raise HTTPException(status_code=404, detail="Task not found")
        try:
            detail = await manager.reschedule_task(task_id, payload.scheduled_for)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        if not detail:
            raise HTTPException(status_code=409, detail="Task is not scheduled.")
        return serialize_detail(detail)

    @app.post("/api/tasks/{task_id}/close-browser")
    async def close_browser(
        task_id: str,
        ctx: tuple[TaskManager, Settings] = Depends(get_ctx),
        auth=Depends(require_head_auth),
    ):
        manager, _ = ctx
        detail = await manager.close_browser(task_id)
        if not detail:
            raise HTTPException(status_code=404, detail="Task not found")
        return serialize_detail(detail)

    @app.post("/api/tasks/{task_id}/open-browser")
    async def open_browser(
        task_id: str,
        ctx: tuple[TaskManager, Settings] = Depends(get_ctx),
        auth=Depends(require_head_auth),
    ):
        manager, _ = ctx
        detail = await manager.reopen_browser(task_id)
        if not detail:
            raise HTTPException(status_code=404, detail="Task not found")
        return serialize_detail(detail)

    @app.delete("/api/tasks/{task_id}", status_code=204)
    async def delete_task(
        task_id: str,
        ctx: tuple[TaskManager, Settings] = Depends(get_ctx),
        auth=Depends(require_head_auth),
    ):
        manager, _ = ctx
        deleted = await manager.delete_task(task_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Task not found")
        return Response(status_code=204)

    @app.get("/tasks/{task_id}/vnc", response_class=HTMLResponse)
    async def open_vnc(task_id: str, token: str, ctx: tuple[TaskManager, Settings] = Depends(get_ctx)):
        manager, config = ctx
        detail = manager.get_task_detail(task_id)
        if not detail or detail.record.vnc_token != token:
            raise HTTPException(status_code=403, detail="Invalid VNC token")
        await manager.ensure_vnc_token(detail.record.id, detail.record.vnc_token)

        novnc_url = (
            f"{config.vnc_scheme}://{config.vnc_public_host}:{config.vnc_http_port}/"
            f"vnc.html?path=websockify?token={token}"
        )
        html = f"""
        <html>
            <head>
                <title>VNC for task {task_id}</title>
                <meta http-equiv="refresh" content="0; url={novnc_url}">
            </head>
            <body>
                <p>Redirecting to secure VNC session...</p>
                <p>If you are not redirected, <a href="{novnc_url}">click here</a>.</p>
            </body>
        </html>
        """
        return HTMLResponse(content=html)

    if FRONTEND_DIST.exists():
        app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")
    else:
        @app.get("/{full_path:path}", include_in_schema=False)
        async def missing_frontend(full_path: str) -> HTMLResponse:
            return HTMLResponse(content=FRONTEND_PLACEHOLDER, status_code=503)

    return app


app = create_app()
