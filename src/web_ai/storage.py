from __future__ import annotations

import asyncio
import json
import shutil
from pathlib import Path
from typing import Iterable

from .models import PersistedTask, TaskRecord, TaskStep, ChatMessage


class TaskStorage:
    """On-disk persistence for task metadata, chat history, and steps."""

    def __init__(self, base_dir: Path):
        self.base_dir = base_dir
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _task_dir(self, task_id: str) -> Path:
        return self.base_dir / task_id

    def _task_file(self, task_id: str) -> Path:
        return self._task_dir(task_id) / "task.json"

    def save(self, task: PersistedTask) -> None:
        task_dir = self._task_dir(task.record.id)
        task_dir.mkdir(parents=True, exist_ok=True)

        payload = task.model_dump(mode="json")
        with self._task_file(task.record.id).open("w", encoding="utf-8") as fp:
            json.dump(payload, fp, indent=2, ensure_ascii=False)

    def load_all(self) -> list[PersistedTask]:
        persisted: list[PersistedTask] = []
        for entry in self.base_dir.iterdir():
            if not entry.is_dir():
                continue
            task_file = entry / "task.json"
            if not task_file.exists():
                continue
            try:
                with task_file.open("r", encoding="utf-8") as fp:
                    data = json.load(fp)
                record = TaskRecord.model_validate(data["record"])
                steps = [TaskStep.model_validate(step) for step in data.get("steps", [])]
                chat = [ChatMessage.model_validate(msg) for msg in data.get("chat_history", [])]
                persisted.append(PersistedTask(record=record, steps=steps, chat_history=chat))
            except Exception:
                continue
        return persisted

    def delete(self, task_id: str) -> None:
        task_dir = self._task_dir(task_id)
        if task_dir.exists():
            shutil.rmtree(task_dir)

    def iter_existing_ids(self) -> Iterable[str]:
        for entry in self.base_dir.iterdir():
            if entry.is_dir():
                yield entry.name

    async def save_async(self, task: PersistedTask) -> None:
        await asyncio.to_thread(self.save, task)

    async def load_all_async(self) -> list[PersistedTask]:
        return await asyncio.to_thread(self.load_all)

    async def delete_async(self, task_id: str) -> None:
        await asyncio.to_thread(self.delete, task_id)
