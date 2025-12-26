import asyncio
import sys
from pathlib import Path

import pytest

ROOT_DIR = Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT_DIR / "src"))

from web_ai.config import Settings
from web_ai.models import TaskCreatePayload, TaskStatus
from web_ai.task_runner import TaskManager


@pytest.mark.asyncio
async def test_vnc_link_and_token_activation(tmp_path, monkeypatch):
    monkeypatch.delenv("WEB_AI_BASE_DATA_DIR", raising=False)
    monkeypatch.delenv("BASE_DATA_DIR", raising=False)
    settings = Settings(
        base_data_dir=tmp_path,
        openai_api_key="test-key",
        openai_model="gpt-5",
        schedule_check_interval_seconds=0.05,
    )
    settings.base_data_dir = tmp_path
    settings.ensure_directories()
    manager = TaskManager(settings)
    await manager.startup()

    async def fake_enqueue(runtime, clear_schedule: bool = False):
        runtime.record.status = TaskStatus.pending

    monkeypatch.setattr(manager, "_enqueue_run", fake_enqueue)

    try:
        payload = TaskCreatePayload(
            title="Assist task",
            instructions="Need help soon",
            model=settings.openai_model,
            max_steps=settings.max_steps,
            leave_browser_open=False,
        )
        detail = await manager.create_task(payload)
        task_id = detail.record.id
        assert detail.vnc_launch_url is None
        assert manager.vnc_manager.lookup(task_id) is None

        runtime = manager.get_task(task_id)
        assert runtime is not None

        assist_task = asyncio.create_task(
            manager._handle_assistance_request(runtime, "Click the button")
        )

        async def wait_for_token():
            while runtime.assistance_event is None:
                await asyncio.sleep(0)
            while True:
                active_token = manager.vnc_manager.lookup(task_id)
                if active_token and runtime.record.vnc_token == active_token:
                    return
                await asyncio.sleep(0)

        await asyncio.wait_for(wait_for_token(), timeout=2)
        detail_waiting = manager.get_task_detail(task_id)
        assert detail_waiting is not None
        assert detail_waiting.vnc_launch_url == (
            f"/tasks/{task_id}/assist?token={runtime.record.vnc_token}"
        )
        assert manager.vnc_manager.lookup(task_id) == runtime.record.vnc_token

        await manager.submit_assistance(task_id, "done")
        await asyncio.wait_for(assist_task, timeout=2)
        assert manager.vnc_manager.lookup(task_id) is None
    finally:
        await manager.shutdown()
