from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import Body, Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from .config import Settings, get_settings
from .models import TaskCreatePayload
from .task_runner import TaskManager, _safe_model_dump

BASE_MODELS = [
    "gpt-5",
    "gpt-5-mini",
    "gpt-5-nano",
]


def create_app() -> FastAPI:
    settings = get_settings()
    manager = TaskManager(settings)
    supported_models = sorted(set(BASE_MODELS + [settings.openai_model]))

    templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
    static_dir = Path(__file__).parent / "static"

    app = FastAPI(title="Browser Web AI", version="0.1.0")
    app.state.settings = settings
    app.state.manager = manager
    app.state.supported_models = supported_models

    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    @app.on_event("startup")
    async def startup() -> None:  # pragma: no cover - FastAPI hook
        await manager.startup()

    def get_ctx() -> tuple[TaskManager, Settings]:
        return app.state.manager, app.state.settings

    @app.get("/", response_class=HTMLResponse)
    async def index(request: Request, ctx: tuple[TaskManager, Settings] = Depends(get_ctx)):
        _, config = ctx
        return templates.TemplateResponse(
            "tasks.html",
            {
                "request": request,
                "refresh_seconds": config.frontend_refresh_seconds,
                "active_page": "tasks",
            },
        )

    @app.get("/tasks/new", response_class=HTMLResponse)
    async def new_task_page(request: Request, ctx: tuple[TaskManager, Settings] = Depends(get_ctx)):
        _, config = ctx
        return templates.TemplateResponse(
            "create_task.html",
            {
                "request": request,
                "refresh_seconds": 0,
                "active_page": "new",
            },
        )

    @app.get("/tasks/{task_id}", response_class=HTMLResponse)
    async def task_detail_page(
        task_id: str, request: Request, ctx: tuple[TaskManager, Settings] = Depends(get_ctx)
    ):
        _, config = ctx
        return templates.TemplateResponse(
            "task_detail.html",
            {
                "request": request,
                "refresh_seconds": config.frontend_refresh_seconds,
                "active_page": "detail",
                "task_id": task_id,
            },
        )

    @app.get("/healthz")
    async def healthcheck():
        return {"status": "ok"}

    @app.get("/api/config/defaults")
    async def config_defaults(ctx: tuple[TaskManager, Settings] = Depends(get_ctx)):
        _, config = ctx
        return {
            "model": config.openai_model,
            "temperature": config.openai_temperature,
            "max_steps": config.max_steps,
            "refreshSeconds": config.frontend_refresh_seconds,
            "supportedModels": app.state.supported_models,
            "openaiBaseUrl": config.openai_base_url,
            "leaveBrowserOpen": False,
            "reasoningEffortOptions": ["low", "medium", "high"],
        }

    @app.get("/api/tasks")
    async def list_tasks(ctx: tuple[TaskManager, Settings] = Depends(get_ctx)):
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
    ):
        manager, settings = ctx
        if payload.model not in app.state.supported_models:
            raise HTTPException(status_code=400, detail="Unsupported model requested.")
        detail = await manager.create_task(payload)
        return serialize_detail(detail)

    @app.get("/api/tasks/{task_id}")
    async def task_detail(task_id: str, ctx: tuple[TaskManager, Settings] = Depends(get_ctx)):
        manager, _ = ctx
        detail = manager.get_task_detail(task_id)
        if not detail:
            raise HTTPException(status_code=404, detail="Task not found")
        return serialize_detail(detail)

    class AssistPayload(BaseModel):
        message: str

    class ContinuePayload(BaseModel):
        instructions: str

    @app.post("/api/tasks/{task_id}/assist")
    async def provide_assistance(
        task_id: str,
        payload: AssistPayload,
        ctx: tuple[TaskManager, Settings] = Depends(get_ctx),
    ):
        manager, _ = ctx
        detail = await manager.submit_assistance(task_id, payload.message.strip())
        if not detail:
            raise HTTPException(status_code=404, detail="Task not awaiting assistance.")
        return serialize_detail(detail)

    @app.post("/api/tasks/{task_id}/continue")
    async def continue_task(
        task_id: str,
        payload: ContinuePayload,
        ctx: tuple[TaskManager, Settings] = Depends(get_ctx),
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

    @app.post("/api/tasks/{task_id}/close-browser")
    async def close_browser(
        task_id: str,
        ctx: tuple[TaskManager, Settings] = Depends(get_ctx),
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
    ):
        manager, _ = ctx
        detail = await manager.reopen_browser(task_id)
        if not detail:
            raise HTTPException(status_code=404, detail="Task not found")
        return serialize_detail(detail)

    @app.delete("/api/tasks/{task_id}", status_code=204)
    async def delete_task(task_id: str, ctx: tuple[TaskManager, Settings] = Depends(get_ctx)):
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

    return app


app = create_app()
