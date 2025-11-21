from __future__ import annotations

from typing import Any
from pathlib import Path

import httpx
from fastapi import Body, Depends, FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles

from .head_config import HeadNode, get_head_settings
from .security import TokenSigner, ensure_keypair, serialize_public_key


def create_head_app() -> FastAPI:
    settings = get_head_settings()
    private_key, public_key = ensure_keypair(settings.private_key_path, settings.public_key_path)
    signer = TokenSigner(
        private_key=private_key,
        audience=settings.token_audience,
        ttl_seconds=settings.token_ttl_seconds,
    )
    public_key_pem = serialize_public_key(public_key)
    http_client = httpx.AsyncClient(timeout=30)

    app = FastAPI(title="Browser Web AI Head", version="0.1.0")
    app.state.settings = settings
    app.state.signer = signer
    app.state.public_key_pem = public_key_pem
    app.state.http = http_client
    app.state.nodes = settings.nodes

    @app.on_event("shutdown")
    async def shutdown_client():  # pragma: no cover - FastAPI hook
        await http_client.aclose()

    if not settings.nodes:
        raise RuntimeError("HEAD_NODES is empty; configure at least one node.")

    def get_node(node_id: str | None, *, allow_default: bool = False) -> HeadNode:
        if node_id:
            for node in settings.nodes:
                if node.id == node_id:
                    return node
            raise HTTPException(status_code=404, detail="Unknown node")
        if settings.nodes:
            if len(settings.nodes) == 1 or allow_default:
                return settings.nodes[0]
        raise HTTPException(status_code=400, detail="node_id is required when multiple nodes are configured")

    def _node_url(node: HeadNode, path: str) -> str:
        base = str(node.url).rstrip("/")
        if not path.startswith("/"):
            path = "/" + path
        return f"{base}{path}"

    async def call_node(node: HeadNode, method: str, path: str, **kwargs) -> httpx.Response:
        token = signer.sign_for_node(node_id=node.id)
        headers = kwargs.pop("headers", {}) or {}
        headers["Authorization"] = f"Bearer {token}"
        url = _node_url(node, path)
        try:
            response = await http_client.request(method, url, headers=headers, **kwargs)
        except httpx.RequestError as exc:
            raise HTTPException(status_code=503, detail=str(exc))
        if response.status_code >= 400:
            try:
                detail = response.json().get("detail")
            except Exception:
                detail = response.text
            raise HTTPException(status_code=response.status_code, detail=detail)
        return response

    def _attach_vnc_host(node: HeadNode, payload: dict[str, Any]) -> dict[str, Any]:
        url = payload.get("vnc_launch_url")
        if url:
            base = str(node.url).rstrip("/")
            path = url if url.startswith("/") else f"/{url}"
            payload["vnc_launch_url"] = f"{base}{path}"
        return payload

    @app.post("/api/nodes/{node_id}/install-head-key")
    async def install_head_key(node_id: str):
        node = get_node(node_id)
        if not settings.enroll_token:
            raise HTTPException(status_code=400, detail="Enrollment token not configured")
        payload = {"public_key": public_key_pem, "token": settings.enroll_token}
        resp = await call_node(node, "POST", "/api/admin/head-key", json=payload)
        return resp.json()

    @app.get("/healthz")
    async def healthcheck():
        return {"status": "ok"}

    @app.get("/api/security/public-key")
    async def public_key():
        return {"public_key": public_key_pem}

    @app.get("/api/nodes")
    async def list_nodes():
        enriched: list[dict[str, Any]] = []
        for node in settings.nodes:
            node_data = node.model_dump()
            try:
                resp = await call_node(node, "GET", "/api/node/info")
                info = resp.json()
                node_data["ready"] = info.get("ready", False)
                node_data["issues"] = info.get("issues", [])
                node_data["reachable"] = True
                node_data["enrollment"] = info.get("enrollment", False)
            except HTTPException as exc:
                node_data["ready"] = False
                node_data["issues"] = [exc.detail if isinstance(exc.detail, str) else str(exc.detail)]
                node_data["reachable"] = False
                node_data["enrollment"] = False
            enriched.append(node_data)
        return {
            "nodes": enriched,
            "public_key": public_key_pem,
            "enroll_token": settings.enroll_token,
        }

    @app.get("/api/config/defaults")
    async def config_defaults():
        node = get_node(None, allow_default=True)
        resp = await call_node(node, "GET", "/api/config/defaults")
        data = resp.json()
        data["nodeId"] = node.id
        data["nodeName"] = node.name
        return data

    @app.get("/api/tasks")
    async def list_tasks():
        tasks: list[dict[str, Any]] = []
        errors: list[dict[str, str]] = []
        for node in settings.nodes:
            try:
                resp = await call_node(node, "GET", "/api/tasks")
                payload = resp.json()
                for item in payload:
                    item.setdefault("node_id", node.id)
                    tasks.append(item)
            except HTTPException as exc:
                detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
                errors.append({"node_id": node.id, "detail": detail})
                continue
        return {"tasks": tasks, "errors": errors}

    @app.post("/api/tasks", status_code=201)
    async def create_task(payload: dict = Body(...)):
        node_id = payload.pop("node_id", None) or payload.pop("nodeId", None)
        node = get_node(node_id)
        resp = await call_node(node, "POST", "/api/tasks", json=payload)
        data = resp.json()
        data = _attach_vnc_host(node, data)
        if isinstance(data, dict) and "record" in data:
            data["record"]["node_id"] = node.id
        return data

    @app.get("/api/tasks/{task_id}")
    async def task_detail(task_id: str, node_id: str = Query(None)):
        node = get_node(node_id)
        resp = await call_node(node, "GET", f"/api/tasks/{task_id}")
        data = _attach_vnc_host(node, resp.json())
        if isinstance(data, dict) and "record" in data:
            data["record"]["node_id"] = node.id
        return data

    @app.post("/api/tasks/{task_id}/assist")
    async def provide_assist(task_id: str, payload: dict = Body(...), node_id: str = Query(None)):
        node = get_node(node_id)
        resp = await call_node(node, "POST", f"/api/tasks/{task_id}/assist", json=payload)
        return _attach_vnc_host(node, resp.json())

    @app.post("/api/tasks/{task_id}/continue")
    async def continue_task(task_id: str, payload: dict = Body(...), node_id: str = Query(None)):
        node = get_node(node_id)
        resp = await call_node(node, "POST", f"/api/tasks/{task_id}/continue", json=payload)
        return _attach_vnc_host(node, resp.json())

    @app.post("/api/tasks/{task_id}/run-now")
    async def run_now(task_id: str, node_id: str = Query(None)):
        node = get_node(node_id)
        resp = await call_node(node, "POST", f"/api/tasks/{task_id}/run-now")
        return _attach_vnc_host(node, resp.json())

    @app.post("/api/tasks/{task_id}/schedule")
    async def schedule_task(task_id: str, payload: dict = Body(...), node_id: str = Query(None)):
        node = get_node(node_id)
        resp = await call_node(node, "POST", f"/api/tasks/{task_id}/schedule", json=payload)
        return _attach_vnc_host(node, resp.json())

    @app.post("/api/tasks/{task_id}/close-browser")
    async def close_browser(task_id: str, node_id: str = Query(None)):
        node = get_node(node_id)
        resp = await call_node(node, "POST", f"/api/tasks/{task_id}/close-browser")
        return _attach_vnc_host(node, resp.json())

    @app.post("/api/tasks/{task_id}/open-browser")
    async def open_browser(task_id: str, node_id: str = Query(None)):
        node = get_node(node_id)
        resp = await call_node(node, "POST", f"/api/tasks/{task_id}/open-browser")
        return _attach_vnc_host(node, resp.json())

    @app.delete("/api/tasks/{task_id}", status_code=204)
    async def delete_task(task_id: str, node_id: str = Query(None)):
        node = get_node(node_id)
        await call_node(node, "DELETE", f"/api/tasks/{task_id}")
        return None

    ROOT_DIR = Path(__file__).resolve().parents[2]
    FRONTEND_DIST = ROOT_DIR / "frontend" / "dist"
    if FRONTEND_DIST.exists():
        app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")
    return app


app = create_head_app()
