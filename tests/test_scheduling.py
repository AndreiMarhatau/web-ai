import asyncio
import sys
from datetime import timedelta
from pathlib import Path

import pytest

ROOT_DIR = Path(__file__).resolve().parents[1]
sys.path.append(str(ROOT_DIR / "src"))

from web_ai.config import Settings
from web_ai.models import TaskCreatePayload, TaskStatus, utcnow
from web_ai.task_runner import TaskManager


@pytest.mark.asyncio
async def test_scheduled_task_runs_when_due(tmp_path, monkeypatch):
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

    started = asyncio.Event()

    async def fake_run(runtime):
        runtime.record.status = TaskStatus.running
        started.set()
        runtime.record.status = TaskStatus.completed

    monkeypatch.setattr(manager, "_run_task", fake_run)

    try:
        payload = TaskCreatePayload(
            title="Scheduled task",
            instructions="Do it later",
            model=settings.openai_model,
            max_steps=settings.max_steps,
            leave_browser_open=False,
            scheduled_for=utcnow() + timedelta(seconds=0.1),
        )

        detail = await manager.create_task(payload)
        assert detail.record.status == TaskStatus.scheduled

        await asyncio.wait_for(started.wait(), timeout=2)
    finally:
        await manager.shutdown()


@pytest.mark.asyncio
async def test_reschedule_and_run_now(tmp_path, monkeypatch):
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

    started = asyncio.Event()

    async def fake_run(runtime):
        runtime.record.status = TaskStatus.running
        started.set()
        runtime.record.status = TaskStatus.completed

    monkeypatch.setattr(manager, "_run_task", fake_run)

    try:
        initial_time = utcnow() + timedelta(minutes=30)
        payload = TaskCreatePayload(
            title="Movable schedule",
            instructions="Reschedule me",
            model=settings.openai_model,
            max_steps=settings.max_steps,
            leave_browser_open=False,
            scheduled_for=initial_time,
        )

        detail = await manager.create_task(payload)
        assert detail.record.scheduled_for == initial_time

        new_time = initial_time + timedelta(minutes=15)
        updated = await manager.reschedule_task(detail.record.id, new_time)
        assert updated is not None
        assert updated.record.scheduled_for == new_time

        with pytest.raises(ValueError):
            await manager.reschedule_task(detail.record.id, utcnow() - timedelta(minutes=1))

        run_detail = await manager.run_scheduled_now(detail.record.id)
        assert run_detail is not None
        await asyncio.wait_for(started.wait(), timeout=2)
        assert manager.get_task(detail.record.id).record.scheduled_for is None
    finally:
        await manager.shutdown()


@pytest.mark.asyncio
async def test_scheduler_survives_iteration_error(tmp_path, monkeypatch):
    monkeypatch.delenv("WEB_AI_BASE_DATA_DIR", raising=False)
    monkeypatch.delenv("BASE_DATA_DIR", raising=False)
    settings = Settings(
        base_data_dir=tmp_path,
        openai_api_key="test-key",
        openai_model="gpt-5",
        schedule_check_interval_seconds=0.01,
    )
    settings.base_data_dir = tmp_path
    settings.ensure_directories()
    manager = TaskManager(settings)
    call_count = 0
    resumed = asyncio.Event()

    async def flaky_start():
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise RuntimeError("boom")
        resumed.set()

    try:
        await manager.startup()
        monkeypatch.setattr(manager, "_start_due_scheduled_tasks", flaky_start)
        runner = manager._scheduler_task
        assert runner is not None
        await asyncio.wait_for(resumed.wait(), timeout=2)
        assert call_count >= 2
    finally:
        await manager.shutdown()


@pytest.mark.asyncio
async def test_deleted_scheduled_task_is_not_started(tmp_path, monkeypatch):
    monkeypatch.delenv("WEB_AI_BASE_DATA_DIR", raising=False)
    monkeypatch.delenv("BASE_DATA_DIR", raising=False)
    settings = Settings(
        base_data_dir=tmp_path,
        openai_api_key="test-key",
        openai_model="gpt-5",
        schedule_check_interval_seconds=0.01,
    )
    settings.base_data_dir = tmp_path
    settings.ensure_directories()
    manager = TaskManager(settings)
    await manager.startup()

    started = asyncio.Event()

    async def fake_run(runtime):
        started.set()

    monkeypatch.setattr(manager, "_run_task", fake_run)

    payload = TaskCreatePayload(
        title="Do not start",
        instructions="Should never run",
        model=settings.openai_model,
        max_steps=settings.max_steps,
        leave_browser_open=False,
        scheduled_for=utcnow() + timedelta(seconds=0.05),
    )

    detail = await manager.create_task(payload)
    await manager.delete_task(detail.record.id)

    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(started.wait(), timeout=0.2)

    await manager.shutdown()
